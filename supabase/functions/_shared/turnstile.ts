// Shared Cloudflare Turnstile verification for edge functions.
//
// Gated on the TURNSTILE_SECRET env var: if it isn't set, verification now
// fails CLOSED — requests are rejected — so the order / inquiry / contact
// endpoints can't be silently left unprotected by a missing secret.
//
// TURNSTILE_ALLOW_UNSET is a local-dev-only escape hatch that restores the
// old no-op behavior. It must NEVER be set to "true" in production.
//
// Once TURNSTILE_SECRET is set, a missing/invalid token is rejected —
// blocking scripted abuse of the order / inquiry / contact endpoints.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = Deno.env.get("TURNSTILE_SECRET") ?? "";
  if (!secret) {
    // Explicit local-dev escape hatch ONLY. Never set this in production —
    // it disables bot/abuse protection on this endpoint entirely.
    if (Deno.env.get("TURNSTILE_ALLOW_UNSET") === "true") return { ok: true };
    // Not configured → fail closed rather than silently allowing all traffic.
    return { ok: false, reason: "Verification is not configured." };
  }

  if (!token || typeof token !== "string") {
    return { ok: false, reason: "Missing verification token." };
  }

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    if (data.success) return { ok: true };
    return { ok: false, reason: "Verification failed. Please try again." };
  } catch {
    // Network blip talking to Cloudflare — fail closed (it's configured).
    return { ok: false, reason: "Could not verify request. Please try again." };
  }
}

/** Best-effort client IP from the request headers. */
export function clientIp(req: Request): string | null {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}
