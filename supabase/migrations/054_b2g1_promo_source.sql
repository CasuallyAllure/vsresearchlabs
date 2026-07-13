-- 054_b2g1_promo_source.sql
-- ---------------------------------------------------------------------------
-- Buy-2-Get-1-Free automatic promo on slow-ship (7–10 business day) items.
--
-- place-order computes the promo at checkout — for every 3 units of a
-- qualifying slow-ship line the cheapest is free — and materializes it as a
-- synthetic order_coupons row: kind='fixed', source='promo', amount = the
-- freed units' value. recompute_order_totals already treats any fixed row as
-- a flat pre-percent reduction (so no percent code discounts the freed units,
-- and admin line edits recompute consistently). The ONLY schema change needed
-- is to allow 'promo' in the order_coupons.source check.
--
-- Requires 045 (order_coupons.source) / 050 ('reward' source). Additive.
-- Rollback: restore source check to ('code','account','reward').
-- ---------------------------------------------------------------------------

alter table order_coupons drop constraint if exists order_coupons_source_check;
alter table order_coupons add constraint order_coupons_source_check
  check (source in ('code', 'account', 'reward', 'promo'));
