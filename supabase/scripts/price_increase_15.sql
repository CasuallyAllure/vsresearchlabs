-- VS Research Labs — one-time price increase: +$15.00 (1500¢) on every REAL price.
--
-- Canonical live prices live in Postgres, NOT in src/data/products.json.
-- The catalog resolves a price via effectiveTierPriceCents → variantPriceCents,
-- which reads these two tables first; the JSON/formula is only a fallback that
-- is never reached for a priced SKU. So this is the correct (and only) lever
-- that moves live prices:
--   • product_variant_stock.price_cents   — per-dose prices (peptides + consumables)
--   • product_stock.price_cents_override  — product-level prices (lab equipment)
--
-- Only non-null prices are touched. null (unpriced / "hidden until priced")
-- rows are left unchanged. The two tables hold disjoint effective prices, so
-- no product is increased twice.
--
-- Expected: 92 variant rows + 5 product rows = 97 rows updated.
-- Reversible: rerun with (price - 1500) to undo.

begin;

update product_variant_stock
   set price_cents = price_cents + 1500
 where price_cents is not null;

update product_stock
   set price_cents_override = price_cents_override + 1500
 where price_cents_override is not null;

commit;
