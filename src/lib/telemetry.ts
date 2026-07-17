/**
 * Client error tracking.
 *
 * Collects render crashes, unhandled exceptions and unhandled promise
 * rejections, and ships them to the `report-error` edge function, which
 * writes one structured line into the Supabase function logs. That log is
 * the sink of record — there is no third-party tracker, no SDK, and no
 * bundle cost beyond this file.
 *
 * Rules this module lives by:
 *   - Never throw. A telemetry failure must not become a second error on
 *     top of the one it is reporting; failures degrade to a console warning.
 *   - Never block. Reports are fire-and-forget; nothing awaits them.
 *   - Never flood. Identical errors are reported once, and a session is
 *     capped, so a render loop cannot spam the sink or the network.
 *   - No PII. We send the error, the route, and the user agent. Not form
 *     contents, not cart contents, not the contact string.
 */

const REPORT_PATH = '/functions/v1/report-error';

const MAX_EVENTS_PER_SESSION = 20;
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 3000;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Where an error came from — kept coarse so it groups usefully. */
export type ErrorSource = 'boundary' | 'window' | 'rejection' | 'manual';

export interface ErrorEvent {
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  /** Route path only — never the full URL, which can carry query params. */
  path: string;
  userAgent: string;
  at: string;
  context?: Record<string, unknown>;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[+${s.length - max} chars]`;
}

/** Normalize anything thrown — including non-Errors — into name/message/stack. */
export function describeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: truncate(err.message || String(err), MAX_MESSAGE_CHARS),
      stack: err.stack ? truncate(err.stack, MAX_STACK_CHARS) : undefined,
    };
  }
  if (typeof err === 'string') return { name: 'Error', message: truncate(err, MAX_MESSAGE_CHARS) };
  try {
    return { name: typeof err, message: truncate(JSON.stringify(err) ?? String(err), MAX_MESSAGE_CHARS) };
  } catch {
    return { name: typeof err, message: truncate(String(err), MAX_MESSAGE_CHARS) };
  }
}

/**
 * Grouping key. Deliberately excludes the stack's line/column noise so the
 * same bug from the same place dedupes to one report per session.
 */
export function errorSignature(e: Pick<ErrorEvent, 'source' | 'name' | 'message' | 'path'>): string {
  return `${e.source}|${e.name}|${e.message}|${e.path}`;
}

export function buildErrorEvent(
  err: unknown,
  source: ErrorSource,
  context?: Record<string, unknown>,
  now: Date = new Date(),
): ErrorEvent {
  const d = describeError(err);
  return {
    source,
    name: d.name,
    message: d.message,
    ...(d.stack ? { stack: d.stack } : {}),
    path: typeof window === 'undefined' ? '' : window.location.pathname,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    at: now.toISOString(),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
}

const seen = new Set<string>();
let sentCount = 0;

/** Test seam — reset the per-session dedup/cap state. */
export function __resetTelemetryForTests(): void {
  seen.clear();
  sentCount = 0;
}

/**
 * Decide whether an event should go to the network. Pure, so the flood
 * guard is testable without a fetch mock.
 */
export function shouldReport(signature: string): boolean {
  if (sentCount >= MAX_EVENTS_PER_SESSION) return false;
  if (seen.has(signature)) return false;
  return true;
}

function markReported(signature: string): void {
  seen.add(signature);
  sentCount += 1;
}

const isConfigured = (): boolean =>
  typeof supabaseUrl === 'string' &&
  supabaseUrl.startsWith('http') &&
  typeof supabaseAnonKey === 'string' &&
  supabaseAnonKey.length > 0;

/**
 * Report an error. Fire-and-forget: returns immediately, never rejects.
 * Safe to call from a React error boundary or any catch block.
 */
export function captureError(
  err: unknown,
  source: ErrorSource = 'manual',
  context?: Record<string, unknown>,
): void {
  let event: ErrorEvent;
  try {
    event = buildErrorEvent(err, source, context);
  } catch {
    return; // Nothing sensible to report.
  }

  // Local visibility first — this works with or without a backend.
  console.error(`[telemetry:${source}]`, event.name, event.message, err);

  const signature = errorSignature(event);
  if (!shouldReport(signature)) return;
  if (!isConfigured()) return; // Dev without env, or backend not configured.
  markReported(signature);

  try {
    const url = `${(supabaseUrl as string).replace(/\/$/, '')}${REPORT_PATH}`;
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey as string,
        Authorization: `Bearer ${supabaseAnonKey as string}`,
      },
      body: JSON.stringify(event),
      // Survive a report fired during pagehide/navigation.
      keepalive: true,
    }).catch((sendErr) => {
      console.warn('[telemetry] report failed to send:', sendErr);
    });
  } catch (sendErr) {
    console.warn('[telemetry] report threw:', sendErr);
  }
}

let handlersInstalled = false;

/**
 * Catch what the React error boundary structurally cannot: errors thrown
 * outside render (event handlers, timers, async work) and unhandled promise
 * rejections — which is where a failing checkout fetch would land.
 *
 * Installing is two listener registrations and no network, so it is safe on
 * the critical shell path.
 */
export function installGlobalErrorHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;

  window.addEventListener('error', (event) => {
    captureError(event.error ?? event.message, 'window');
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason, 'rejection');
  });
}
