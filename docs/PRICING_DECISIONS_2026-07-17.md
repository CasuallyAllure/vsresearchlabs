# Pricing decisions — 2026-07-17 (operator to-do closeout)

Closes DEPLOY_PLAN §5.1–5.2: the four unpriced SKUs that survived the P0
remediation. Applied **live** on 2026-07-17 via the same admin RPCs the admin
UI uses (`import_inventory` for prices, `set_variant_hidden` for hides) —
data-only, no code, no migration, no redeploy. Every number below is
correctable in the admin Inventory page at any time.

## The three priced doses

| SKU | Dose | Price set | Basis |
|---|---|---|---|
| `VSR-RS-TB4-005` (TB-500) | 5mg | **$60.00** (6000¢) | The documented catalog formula (`src/lib/pricing.ts:28-36`: $20 base + $8/mg for this compound id) — which is **exactly the price the storefront has displayed and billed for this dose all along**. 8 on hand, actively selling at this number. |
| `VSR-RS-KISS` (Kisspeptin-10) | 5mg | **$55.00** (5500¢) | Same formula ($20 + $7/mg) = the live displayed/billed price. |
| `VSR-RS-TA1` (Thymosin α-1) | 5mg | **$75.00** (7500¢) | Same formula ($20 + $11/mg) = the live displayed/billed price. |

**Why the formula price and not a per-mg scale-down of the 10mg sibling:**
pinning the number buyers already see makes the change invisible (no price
move, no revenue change) while converting the price from "client-computed,
server-unverifiable" to "server-authoritative, fail-closed". This is exactly
the closure `docs/PRICING_P0_NOTES.md` §3 prescribed. A pure per-mg derivation
from the siblings would have *cut* live prices by $20–35 — a revenue decision
that belongs to the operator, not to this closeout.

**⚠ Ladder note for Ray (review at leisure):** your 10mg DB prices are
aggressive relative to these 5mg prices — the step from 5mg to 10mg is small:

| Compound | 5mg (now pinned) | 10mg (your DB price) | Δ to double the dose |
|---|---|---|---|
| TB-500 | $60 | $71 | +$11 |
| Kisspeptin | $55 | $80 | +$25 |
| Thymosin α-1 | $75 | $81 | +$6 |

If you want a smoother ladder, lower the 5mg prices in the admin Inventory
page — checkout enforces whatever is in `product_variant_stock.price_cents`.

## HGH — hidden, not priced

`VSR-RS-HGH` 24IU and 36IU: **`hidden = true`** set on both variant rows
(via `set_variant_hidden`, audit-logged). With both doses hidden the product
drops out of the public grids entirely (`isProductPublic`).

**Why hidden:** there is no defensible basis to derive a price — zero priced
HGH variants exist, the doses are IU-based so the mg formula yields nothing
(this is why HGH billed at $0 pre-remediation), and no comparable IU-priced
sibling exists in the catalog. Per the standing rule ("price HGH or hide it",
`PRICING_P0_NOTES.md` §2), hiding beats inventing a number. **To relist:**
set a real price for each dose in the admin Inventory page (or CSV import),
then un-hide the doses — the price alone makes them visible again.

## Verification (live, post-apply)

`product_variant_stock` re-read after the writes:
TB4-005 5mg = 6000¢ (on_hand 8 untouched) · KISS 5mg = 5500¢ ·
TA1 5mg = 7500¢ · HGH 24IU/36IU hidden=true, price null. Stock, inbound,
lead-days, and `wholesale_eligible` values unchanged on every row.

Also verified in the same pass: `promo_settings` row 1 = `b2g1_enabled: true`,
`b2g1_ends_at: null`, no exclusions — B2G1 is live (DEPLOY_PLAN §5.3 satisfied;
the flag was already on, seeded by migration 055 on 2026-07-13).
