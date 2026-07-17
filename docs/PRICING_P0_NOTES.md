# Pricing P0 fixes — operator notes

Branch `fix/pricing-p0-autonomous-2026-07-16`. Closes P0-1, P0-3, P0-4, P0-5 from
`docs/REVIEW_2026-07-16.md` in code. Nothing here is deployed and no migration has
been applied — this is code + one staged migration for review.

---

## 1. Deploy order is not optional

```
1. apply migration 063_wholesale_eligible.sql
2. deploy place-order
3. deploy the frontend
```

**Migration 063 must land before place-order.** The function selects
`wholesale_eligible` from `product_variant_stock`; against a database without that
column the promo read errors, and every order then proceeds at full retail — no
wholesale for anyone, silently, until the migration lands. It fails in the safe
direction (nobody is overcharged past their quote), but it is a real outage of the
wholesale offer.

Frontend after the function is the normal rule; the only client change here is a
contact-field prefill, so the window is harmless in either order.

## 2. What changes for buyers the moment place-order deploys

**Checkout now refuses orders it cannot verify.** Until now every line price was
taken from the client verbatim. These refusals are all correct, but they are new,
and support should know they exist:

| Situation | Before | Now |
|---|---|---|
| Price changed while the cart sat open | billed the stale price | refused: "The price of X changed… refresh your cart" |
| Catalog read fails | billed whatever the client sent | refused, 503, retry |
| Line price ≠ admin price | billed as sent | refused |
| Client sends a $0 line | billed $0 | refused |

**HGH becomes un-orderable.** `VSR-RS-HGH` 24IU and 36IU are visible ("sourced")
and have no price. Their dose carries no `mg`, so the client's formula returns
null and `cartActions.lineUnitCents`'s `?? 0` bills them at **$0** — that is live
today. Checkout now refuses them instead of shipping them free. The Add button
still appears until PAR-H2a lands, so a buyer can reach a refusal: **price HGH or
hide it.**

> The review's list of six $0 doses is out of date — checked against the live
> database: HCG 1000/5000/10000iu and Lemon Bottle 10ml have since been priced.
> Of that list only HCG 2000iu and Lipo-C 10ml are still unpriced, and both are
> hidden, so neither is reachable. HGH is the one that matters.

## 3. The residual gap, and the one-line way to close it

A dose with **no admin price** but a *formula* price above $0 cannot be verified —
the client makes the number up and the server has nothing to compare against.
Those lines are allowed through and reported (⚠ on the business email + an
`order_events` note), never billed silently.

Three live doses are in this state (verified against the live database):

| SKU | Dose | Client bills | Note |
|---|---|---|---|
| `VSR-RS-TB4-005` | 5mg | $60 | **8 on hand, ships 24hr** — a real, active buy path |
| `VSR-RS-KISS` | 5mg | $55 | sourced; the sku's 10mg IS priced |
| `VSR-RS-TA1` | 5mg | $75 | sourced; the sku's 10mg IS priced |

Until they are priced, a buyer can name their own price on those three doses.
**This needs no code — import a price for each and the gap closes.** They were
left allowed rather than refused precisely because TB-500 5mg is in stock and
selling: refusing it would have taken a live product off the shelf to close a
$60 exposure.

## 4. Wholesale eligibility is now a database fact

`product_variant_stock.wholesale_eligible`, seeded by migration 063 from the same
category the storefront gates on: 63 compounds eligible; the 5 `VSR-LE-*`
instruments plus bacteriostatic water, syringes and acetic acid not.

**Default is `false`.** A new SKU imported later will not sell at pack pricing
until someone enables it:

```sql
update product_variant_stock set wholesale_eligible = true where sku = 'VSR-RS-NEW';
```

There is deliberately no admin UI for this yet — see the note at the bottom of the
migration. If new compounds get added often, wiring `wholesale_eligible` into
`import_inventory` is the follow-on worth doing.

## 5. B2G1 is still off, and that is intentional

`promo_settings.b2g1_enabled` is untouched. P0-4 (the +$240 cliff at qty 10 — in
fact from qty 5) is fixed in code and locked by a property test across qty 1..20,
so the promo is now **safe to re-enable** — but flipping it is an operator decision
that belongs after this deploys, per OPS-1/SER-A5.

## 6. Known-good behaviour that looks like a bug

A member pays **$600 for 14** vials and **$579 for 15**: the 15th completes a half
kit (27% off 5). That is a tier boundary in the advertised offer, not the P0-4
cliff — the buyer wins, and forcing it to be monotone would mean charging more
than the published pack price. There is a test pinning it so it does not get
"fixed" later.
