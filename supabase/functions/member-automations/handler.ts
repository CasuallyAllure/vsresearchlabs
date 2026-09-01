// supabase/functions/member-automations/handler.ts
// Membership automation runner — the whole orchestration, Deno-free.
//
// Same shim/handler split as reconcile: index.ts reads env once at cold start,
// wires the real fetch + telemetry, and mounts the handler this factory
// returns under Deno.serve. NOTHING in this file may reference Deno globals
// or jsr:/npm: imports — vitest drives every decision path directly
// (tests/unit/memberAutomationsHandler.test.ts).
//
// Auth posture — STRICTER than reconcile, because this function can email
// customers: the caller must present x-automations-secret matching the
// AUTOMATIONS_CRON_SECRET env. Fail closed: an unset secret returns 503 "not
// configured" and the function NEVER runs without it. verify_jwt is off in
// config.toml (the GitHub cron sends no Supabase JWT); this header gate is
// the real authorization.
//
// Send discipline — insert-then-send: every candidate is claimed FIRST by
// inserting into email_log, whose UNIQUE (recipient, kind, period_key) is the
// idempotency contract (075). Insert 201 → send; 409 conflict → skip
// silently, no send. A crash between claim and send costs at most one missed
// email — it can never double-send. dry_run evaluates candidates and claims
// NOTHING (safe smoke-testing; the admin view uses it later).
//
// Kind eligibility lives in SQL (automation_candidates, 075) next to the
// tables it reads; this handler owns settings → claim → compose → send.

import {
  AUTOMATION_KINDS,
  buildAutomationEmail,
  type AutomationCandidate,
  type AutomationKind,
} from "./templates.ts";

/** Env-derived configuration — index.ts reads Deno.env once at cold start. */
export interface MemberAutomationsConfig {
  supabaseUrl: string;
  serviceKey: string;
  /** Shared secret the scheduled workflow presents. Empty = not configured
   *  = the function refuses to run (503). */
  cronSecret: string;
  resendApiKey: string;
  fromEmail: string;
}

/** Runtime seams (`fetch` deliberately shadows the global in the factory). */
export interface MemberAutomationsDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** settle_referral_conversions() (090) — banks qualifying referral orders and
   *  mints each referrer's bonus code. Runs BEFORE the kinds are evaluated so
   *  the referral_bonus notice finds the codes minted this run. Optional: a
   *  project without 090 applied simply skips it. */
  settleReferrals?: () => Promise<number>;
  logEvent: (
    severity: "info" | "warn" | "error" | "fatal",
    fn: string,
    message: string,
    ctx?: Record<string, unknown>,
  ) => void;
}

interface KindSetting {
  kind: string;
  enabled: boolean;
}

interface KindReport {
  enabled: boolean;
  candidates: number;
  sent: number;
  skippedClaimed: number;
  failed: number;
  error?: string;
}

const RPC_TIMEOUT_MS = 10_000;

export function createMemberAutomationsHandler(
  cfg: MemberAutomationsConfig,
  deps: MemberAutomationsDeps,
): (req: Request) => Promise<Response> {
  const FN = "member-automations";
  const { fetch, logEvent } = deps;

  const serviceHeaders = {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    "Content-Type": "application/json",
  };

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  async function loadSettings(): Promise<KindSetting[]> {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/automation_settings?select=kind,enabled`,
      { headers: serviceHeaders, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`settings load failed: PostgREST status ${res.status}`);
    return (await res.json()) as KindSetting[];
  }

  async function loadCandidates(kind: AutomationKind): Promise<AutomationCandidate[]> {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/automation_candidates`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ p_kind: kind }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`candidates failed: PostgREST status ${res.status}`);
    const data = (await res.json()) as AutomationCandidate[] | null;
    return Array.isArray(data) ? data : [];
  }

  /** The idempotency claim. "claimed" = we own this (recipient, kind,
   *  period_key) and may send; "conflict" = already sent some earlier run. */
  async function claim(
    kind: AutomationKind,
    c: AutomationCandidate,
  ): Promise<"claimed" | "conflict"> {
    // `token` is a bearer secret (the review link's order lookup_token). It
    // goes in the EMAIL, never into email_log.metadata.
    const { userId, recipient, periodKey, token: _token, ...metadata } = c;
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/email_log`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        recipient,
        kind,
        period_key: periodKey,
        metadata,
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (res.status === 409) return "conflict";
    if (!res.ok) throw new Error(`claim failed: PostgREST status ${res.status}`);
    return "claimed";
  }

  async function send(kind: AutomationKind, c: AutomationCandidate): Promise<void> {
    const email = buildAutomationEmail(kind, c);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.fromEmail,
        to: c.recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend status ${res.status}`);
  }

  async function runKind(
    kind: AutomationKind,
    enabled: boolean,
    dryRun: boolean,
  ): Promise<KindReport> {
    const report: KindReport = { enabled, candidates: 0, sent: 0, skippedClaimed: 0, failed: 0 };
    if (!enabled) return report;

    let candidates: AutomationCandidate[];
    try {
      candidates = await loadCandidates(kind);
    } catch (err) {
      // Surface it in the body: the workflow greps for "error" and pages.
      const message = err instanceof Error ? err.message : String(err);
      logEvent("error", FN, `candidate evaluation failed for ${kind}`, { message });
      return { ...report, error: "candidate evaluation failed" };
    }

    report.candidates = candidates.length;
    if (dryRun) return report;

    for (const c of candidates) {
      try {
        // Insert-then-send: the claim MUST land before the send is attempted.
        if ((await claim(kind, c)) === "conflict") {
          report.skippedClaimed += 1;
          continue;
        }
        await send(kind, c);
        report.sent += 1;
      } catch (err) {
        // Claimed-but-unsent (or claim error): logged, never retried blindly —
        // the email_log row is the audit trail an operator inspects.
        const message = err instanceof Error ? err.message : String(err);
        logEvent("error", FN, `send failed for ${kind}`, { periodKey: c.periodKey, message });
        report.failed += 1;
      }
    }
    return report;
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    // Fail closed: no secret configured → the function must never run.
    if (!cfg.cronSecret || !cfg.supabaseUrl || !cfg.serviceKey) {
      return json({ error: "not configured" }, 503);
    }
    if (req.headers.get("x-automations-secret") !== cfg.cronSecret) {
      return json({ error: "unauthorized" }, 401);
    }

    let dryRun = false;
    try {
      const body = (await req.json()) as { dry_run?: unknown };
      dryRun = body?.dry_run === true;
    } catch {
      // Empty/absent body → a normal live run.
    }

    // A live run cannot send without Resend; refuse rather than half-run
    // (dry_run stays available for smoke tests on an unconfigured project).
    if (!dryRun && !cfg.resendApiKey) {
      return json({ error: "not configured" }, 503);
    }

    let settings: KindSetting[];
    try {
      settings = await loadSettings();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent("error", FN, "settings load failed", { message });
      return json({ ok: false, error: "settings unavailable" }, 502);
    }

    // Settle referrals first: a conversion that qualifies this run should get
    // its notice this run, not next one. A settlement failure is logged and
    // never blocks the sends — the next run retries it (the verb is idempotent).
    let referralsGranted = 0;
    if (!dryRun && deps.settleReferrals) {
      try {
        referralsGranted = await deps.settleReferrals();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logEvent("error", FN, "referral settlement failed", { message });
      }
    }

    const enabledByKind = new Map(settings.map((s) => [s.kind, s.enabled]));
    const kinds: Record<string, KindReport> = {};
    for (const kind of AUTOMATION_KINDS) {
      kinds[kind] = await runKind(kind, enabledByKind.get(kind) === true, dryRun);
    }

    const totals = Object.values(kinds).reduce(
      (acc, r) => ({ sent: acc.sent + r.sent, candidates: acc.candidates + r.candidates }),
      { sent: 0, candidates: 0 },
    );
    logEvent("info", FN, `run complete${dryRun ? " (dry run)" : ""}`, { ...totals, kinds, referralsGranted });

    return json({ ok: true, dryRun, referralsGranted, kinds, ts: new Date().toISOString() });
  };
}
