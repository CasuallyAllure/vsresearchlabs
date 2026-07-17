# DEPLOY PLAN — remediation integration, morning of 2026-07-17

**What ships:** branch `integration/remediation-2026-07-16` — the 2026-07-16
remediation work (five P0 money fixes, observability, CI, data integrity, a11y)
integrated, verified green (`tsc -b`, `deno check supabase/functions/`,
143 unit tests, `eslint` 0 errors, `npm run build`), and adversarially
re-reviewed (all five P0s confirmed closed; the one MEDIUM finding it raised
is fixed on the branch — see `docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md`). Production currently runs `main@9e4e3d0` — the vulnerable
pre-remediation state. Nothing below has been executed; this is the plan.

**The one rule that matters: DB migrations FIRST, then place-order, then the
frontend.** Migration `063` adds `product_variant_stock.wholesale_eligible`;
the new `place-order` selects that column. Deployed against a database without
it, the promo read errors and every order silently proceeds at full retail —
safe direction, but a real outage of the wholesale offer. (Header of
`supabase/migrations/063_wholesale_eligible.sql` and
`docs/PRICING_P0_NOTES.md` §1 say the same.)

---

## 0. Pre-flight (2 min)

```sh
cd ~/Documents/GitHub/vsresearchlabs        # repo ROOT — never a worktree
git checkout main && git merge --ff-only integration/remediation-2026-07-16 || git merge integration/remediation-2026-07-16
git push origin main
supabase migration list                     # confirm pending = 059, 061, 063
```

- Prod DB is at **055 confirmed applied** (scan verified live); 056–058 are
  very likely applied (their commit messages claim prod verification). If
  `supabase migration list` shows 056–058 pending too, that's fine — all five
  are additive and idempotent; push them together.
- Numbers 060 and 062 were reserved in the blueprint and never used. The gap
  is intentional; do not "fix" it.

## 1. Database — `supabase db push` (FIRST)

Applies, in order:

| Migration | What it does | Risk |
|---|---|---|
| `059_buyer_contact_index.sql` | functional index on `lower(btrim(buyer_contact))` — fraud-gate lookups stop full-scanning `orders` | none (index, `if not exists`) |
| `061_inquiry_lines_priced.sql` | `create_order_from_inquiry` now resolves real variant prices or raises — no more NULL-priced lines from the admin button | admin inquiry→order conversion now REFUSES unpriceable lines (correct, but new) |
| `063_wholesale_eligible.sql` | adds + seeds `product_variant_stock.wholesale_eligible` (63 compounds true; lab equipment, BAC water, syringes, acetic acid false) | **must precede place-order deploy** |

## 2. Edge functions (SECOND)

```sh
supabase functions deploy place-order send-receipt send-processing-notification send-delivered-notification send-shipment-notification mark-payment-claimed report-error
```

- `place-order` — fail-closed price authority, server wholesale gate,
  monotonic promo re-arbitration, JWT membership, telemetry.
- 4 notifiers — `requireAdmin` gating (closes the IDOR, P0-2).
- `mark-payment-claimed` — telemetry wiring; its `verify_jwt = false` is
  already pinned in `supabase/config.toml` and the deploy re-applies it.
- `report-error` — NEW function (client error sink). Default `verify_jwt` is
  correct: the client calls it with the anon key, which is a valid JWT.

**Secrets:** no new required secrets. Telemetry alerts reuse `RESEND_API_KEY`
and default the destination to `inquiries@vsresearchlabs.com`. Optional
overrides: `ALERT_TO_EMAIL`, `ALERTS_ENABLED=0` (kill switch),
`RESEND_FROM_EMAIL` — see `docs/SUPABASE_SECRETS.md`.

## 3. Frontend (THIRD)

```sh
npm ci && npm run build && npx wrangler deploy    # from the repo ROOT
```

(Worktrees lack `.env.local` → Supabase keys not baked in → prod outage.
This has happened before; see README.)

## 4. Post-deploy verification (5 min)

1. **Price authority live:** POST an order with `unitPriceCents: 1` on a
   priced SKU (or just watch the first real order) → expect a **409 refusal**
   ("The price of X changed…"), not an order at $0.01.
2. **IDOR closed:** signed-in **non-admin** JWT calling `send-receipt` with a
   valid foreign `order_id` → 401/403, not HTML.
3. **Checkout happy path:** place one real test order end-to-end (drawer →
   invoice email arrives, totals match the drawer).
4. **Telemetry:** `report-error` returns 2xx from the deployed site (throw a
   test error from the console) and no alert storm arrives.
5. **Wholesale:** signed-in cart, 10× an eligible biopeptide → pack pricing
   appears on the invoice; 10× lab equipment → full retail.

## 5. Operator-only decisions (human, not deploy)

These are **yours**; the code deliberately does not decide them:

1. **HGH — price it or it stays effectively hidden.** `VSR-RS-HGH` 24IU/36IU
   are visible with no price; the new checkout **refuses** them (before, they
   were billable at $0). Either import a price for both doses or hide the SKU.
   Until then a buyer can click Add and hit a refusal at checkout.
   (`docs/PRICING_P0_NOTES.md` §2.)
2. **Price the three formula-priced doses** — `VSR-RS-TB4-005 5mg` ($60,
   in stock, actively selling), `VSR-RS-KISS 5mg`, `VSR-RS-TA1 5mg`. These are
   the residual "buyer names their own price" gap: unverifiable lines are
   allowed + flagged (⚠ email, `order_events`), never refused, because
   refusing would take a live product off the shelf. **Importing a price
   closes the gap with no code.** (`docs/PRICING_P0_NOTES.md` §3.)
3. **B2G1 flag** — `promo_settings.b2g1_enabled`. P0-4 (the +$240 guest
   cliff) is fixed and pinned by a monotonicity property test, and the dose
   matcher is longest-match hardened (the IGF-1 LR3 0.1mg/1mg collision and
   the `note` spoof are dead). The promo is now **safe to enable** whenever
   you want it live — your call, after the deploy verifies.
4. **GitHub branch protection on `main`** — enable **after** `ci.yml` has run
   once on the pushed main (it must exist as a check before it can be
   required). Exact settings + the one-shot `gh api` command:
   `docs/ROLLBACK.md` § "Operator: branch protection on `main`" (required
   check = `checks`, approvals 0, no force-push).
5. **Optional:** set `ALERT_TO_EMAIL` if failed-order alerts should go
   somewhere other than `inquiries@`.

## 6. Rollback (if anything goes wrong)

Full runbook: `docs/ROLLBACK.md`. Short form:

| Target | Reverse |
|---|---|
| Frontend | `wrangler versions list` → `wrangler rollback <version-id> -m "reason"` (instant, config+assets) |
| Edge functions | no rollback verb — redeploy the last-good source **forward**: `git checkout 9e4e3d0 -- supabase/functions/place-order && supabase functions deploy place-order` (repeat per function), then `git checkout main -- supabase/functions` to restore the tree. NOTE: rolling place-order back past 063 is safe — the old function never reads `wholesale_eligible`. |
| Database | forward-fix only. 059/061/063 are additive; nothing needs un-applying. To neutralize 061 in an emergency, re-apply the 027 version of `create_order_from_inquiry` as a new migration. |
| Flags | `promo_settings.b2g1_enabled = false` remains the universal B2G1 kill switch; `ALERTS_ENABLED=0` silences telemetry email. |

## The morning tap, in one block

```sh
cd ~/Documents/GitHub/vsresearchlabs
git checkout main && git merge integration/remediation-2026-07-16 && git push origin main
supabase db push
supabase functions deploy place-order send-receipt send-processing-notification send-delivered-notification send-shipment-notification mark-payment-claimed report-error
npm ci && npm run build && npx wrangler deploy
```

Then: verification probes (§4), branch protection (§5.4), and the HGH /
three-dose pricing decisions (§5.1–5.2) at your leisure.
