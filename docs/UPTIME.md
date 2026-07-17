# Uptime monitoring

Two probes cover the two things that can go down independently: the frontend
Worker and the Supabase edge/database stack.

## Endpoints

| Probe | URL | Healthy signal |
|---|---|---|
| Frontend | `https://vsresearchlabs.com/` | HTTP 200 + keyword `VS Research` in the body |
| Edge + DB | `https://ufaajzfuppohbxebftwp.supabase.co/functions/v1/health` | HTTP 200 + keyword `"ok":true` |

The `health` edge function (public, `verify_jwt = false` in
`supabase/config.toml`) performs a 1-row service-role read of `promo_settings`
with a 5s timeout and returns `200 {ok:true, db:true, ts}` when the database
answers, `503 {ok:false}` when it doesn't. It exposes no secrets or order
data. A monitor on this single URL therefore alerts on BOTH an edge-gateway
outage (timeout / non-2xx from the platform) and a database outage (503).

Verify from any shell:

```sh
curl -s https://ufaajzfuppohbxebftwp.supabase.co/functions/v1/health
# → {"ok":true,"db":true,"ts":"…"}
```

## External monitor setup (UptimeRobot free tier — or any equivalent)

1. Create account at https://uptimerobot.com (free tier: 50 monitors, 5-min
   interval — fine for this).
2. **Monitor 1 — frontend**: type *HTTP(s)*, URL `https://vsresearchlabs.com/`,
   interval 5 min.
3. **Monitor 2 — edge/DB**: type *Keyword*, URL
   `https://ufaajzfuppohbxebftwp.supabase.co/functions/v1/health`, keyword
   `"ok":true`, alert **when keyword is absent**, interval 5 min. (Keyword mode
   catches the 503-with-body case as well as gateway timeouts.)
4. Point alert contacts at the operator email (and optionally the
   `alertOperator` Telegram/webhook channel already used by place-order money
   alerts, so all pages land in one place).

Any other monitor (Better Stack, Pingdom, healthchecks.io self-ping from cron)
works identically — the contract is just: GET the two URLs above, alert on
non-200 or missing keyword.

## Operational notes

- The health function deploys like any other: `supabase functions deploy
  health` (it ships automatically with `scripts/deploy.sh` only when deployed
  explicitly — it is intentionally not coupled to the place-order deploy).
- A `503` from the health URL with the site still up means the DATABASE is the
  problem — check Supabase status + the dashboard before touching the Worker.
- The probe reads `promo_settings` (single row, id=1). If that table is ever
  dropped, update the function — a permanently-503 probe trains everyone to
  ignore the pager.
