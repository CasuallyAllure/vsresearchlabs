# Supabase Edge Function Secrets

This is the canonical list of secrets that need to live in the Supabase
Edge Functions secrets vault. Set them at:

**Supabase Dashboard → Edge Functions → Manage secrets**

Or via the CLI from your laptop:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set RESEND_FROM_EMAIL='VS Research Labs <inquiries@vsresearchlabs.com>'
supabase secrets set INQUIRY_TO_EMAIL=inquiries@vsresearchlabs.com
supabase secrets set ALLOWED_ORIGIN=https://vsresearchlabs.com
```

## Required for all email-sending functions

| Name | Example | Used by |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx` | inquiry · invoice · shipment |
| `RESEND_FROM_EMAIL` | `VS Research Labs <inquiries@vsresearchlabs.com>` | inquiry · invoice · shipment |
| `ALLOWED_ORIGIN` | `https://vsresearchlabs.com` | all (CORS lockdown) |

## Required for `send-inquiry` only

| Name | Example |
|---|---|
| `INQUIRY_TO_EMAIL` | `inquiries@vsresearchlabs.com` |

## Optional — failure alerting (`_shared/telemetry.ts`)

Both have working defaults; set them only to override.

| Name | Default | Notes |
|---|---|---|
| `ALERT_TO_EMAIL` | falls back to `INQUIRY_TO_EMAIL` | Where order-path failure alerts land. Point it at a pager/on-call address to separate alerts from order mail. |
| `ALERTS_ENABLED` | `1` | Set to `0` to silence alert emails (structured logs continue regardless). |

Alerts reuse `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — no new vendor, no new key.
Note the dependency: if Resend itself is down, the alert email cannot send, and
the structured log line in the function logs is the record of last resort.

## Auto-injected by Supabase runtime — DO NOT set manually

| Name | Notes |
|---|---|
| `SUPABASE_URL` | Same as your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — keep server-side only |

## Verifying secrets are set

```bash
supabase secrets list
```

## Verifying functions can read secrets

After deploying, invoke a function with a no-op payload and check the
function logs:

```bash
supabase functions logs send-inquiry
```

If you see "Email service not configured" → `RESEND_API_KEY` is missing.
If you see "Database service not configured" → not possible (auto-injected),
but indicates the function wasn't deployed correctly.
