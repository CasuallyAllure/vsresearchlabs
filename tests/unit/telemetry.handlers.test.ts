// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/telemetry.ts — installGlobalErrorHandlers(), in a DOM.
 *
 * The node-env suite (telemetry.test.ts) pins the pure pieces and the send
 * path; this file pins the browser wiring the boundary structurally cannot
 * cover: the window 'error' and 'unhandledrejection' listeners, the
 * install-once guard, and buildErrorEvent picking up the real
 * location/userAgent. addEventListener is spied with a no-op implementation —
 * handlers are captured and invoked directly, so nothing real is registered
 * on the shared happy-dom window.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Telemetry = typeof import('../../src/lib/telemetry');
type Listener = (event: unknown) => void;

let telemetry: Telemetry;
let fetchMock: ReturnType<typeof vi.fn>;
let addListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 202 })));
  vi.stubGlobal('fetch', fetchMock);
  addListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  telemetry = await import('../../src/lib/telemetry');
  telemetry.__resetTelemetryForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installedHandlers(): Record<string, Listener> {
  telemetry.installGlobalErrorHandlers();
  return Object.fromEntries(
    addListenerSpy.mock.calls.map(([type, fn]: [unknown, unknown]) => [
      type as string,
      fn as Listener,
    ]),
  );
}

describe('installGlobalErrorHandlers', () => {
  test('registers exactly one error and one unhandledrejection listener, once', () => {
    // Act — install twice; the second call must be a no-op.
    telemetry.installGlobalErrorHandlers();
    telemetry.installGlobalErrorHandlers();

    // Assert
    expect(addListenerSpy).toHaveBeenCalledTimes(2);
    const types = addListenerSpy.mock.calls.map(([type]: [unknown]) => type);
    expect(types).toEqual(['error', 'unhandledrejection']);
  });

  test('an uncaught window error is reported with source=window and the route path', () => {
    // Arrange
    const handlers = installedHandlers();

    // Act — what the browser dispatches for an uncaught throw.
    handlers.error({ error: new Error('uncaught in handler'), message: 'ignored' });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ source: 'window', message: 'uncaught in handler' });
    // In a DOM env the event carries the real route + UA, not the '' fallbacks.
    expect(body.path).toBe(window.location.pathname);
    expect(body.userAgent).toBe(navigator.userAgent);
  });

  test('falls back to the event message when the error object is absent', () => {
    // Arrange — cross-origin scripts surface as message-only error events.
    const handlers = installedHandlers();

    // Act
    handlers.error({ error: undefined, message: 'Script error.' });

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'window',
      message: 'Script error.',
    });
  });

  test('an unhandled promise rejection is reported with source=rejection', () => {
    // Arrange — where a failing checkout fetch would land.
    const handlers = installedHandlers();

    // Act
    handlers.unhandledrejection({ reason: new Error('payment fetch failed') });

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'rejection',
      message: 'payment fetch failed',
    });
  });
});
