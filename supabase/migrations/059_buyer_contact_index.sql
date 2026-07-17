-- 059_buyer_contact_index.sql
-- ---------------------------------------------------------------------------
-- Functional indexes for the contact-keyed lookups. Every one of them
-- currently full-scans: `orders` has eight indexes and not one is on
-- buyer_contact, and `coupon_redemptions` has none on it either. The scans are
-- cheap today and stop being cheap silently.
--
-- Indexed by MEASURED call sites, not by the remediation blueprint's list —
-- the blueprint's nine cited sites were re-checked against source and seven
-- were wrong: four are on coupon_redemptions rather than orders, and five are
-- dead definitions superseded by later migrations. The live set is:
--
--   orders, lower(btrim(buyer_contact))
--     · 004:234  view customer_with_history — last_order_at subquery
--       (Postgres parses trim(x) to btrim(x), so 004's `trim` form is this
--        same expression and is served by this index.)
--   orders, lower(buyer_contact)                        -- no btrim
--     · 053:69   claim_reward_on_signup — back-fills user_id by email
--   coupon_redemptions, lower(btrim(coalesce(buyer_contact, '')))
--     · 031:262  validate_coupon  — once_per_contact gate
--     · 057:157  validate_coupon  — once_per_contact gate (current definition)
--
-- Three expressions, three indexes. lower(x) and lower(btrim(x)) are NOT
-- interchangeable to the planner — it matches an expression index
-- structurally — so one index cannot serve both orders predicates. The honest
-- fix is to normalize 053:69 to the btrim form and keep a single index, but
-- that edits a live reward/identity function and is out of scope here; the
-- second index buys the performance without touching that behavior. Filed as
-- debt in the PR rather than smuggled into an index migration.
--
-- The coalesce is load-bearing only on coupon_redemptions (buyer_contact is
-- nullable there, 031:85); on orders the column is NOT NULL (003:95), so the
-- orders expressions carry no coalesce and must not grow one — that would be a
-- different expression and would not match the predicates above.
--
-- Plain (non-concurrent) CREATE INDEX: migrations run inside a transaction and
-- CREATE INDEX CONCURRENTLY cannot. These tables are small at launch scale, so
-- the brief write lock is a non-event. Revisit if orders grows large.
--
-- Requires 057. Additive. Re-runnable.
-- Rollback: drop index idx_orders_buyer_contact_norm,
--                      idx_orders_buyer_contact_lower,
--                      idx_coupon_redemptions_buyer_contact_norm;
-- ---------------------------------------------------------------------------

-- ── 1. orders — lower(btrim(buyer_contact)) ─────────────────────────────────
-- Serves the customer_with_history view's last_order_at correlated subquery,
-- which runs once per customer row: the full scan is per-customer, so this is
-- the index with the worst growth curve of the three.
create index if not exists idx_orders_buyer_contact_norm
  on orders ((lower(btrim(buyer_contact))));

-- ── 2. orders — lower(buyer_contact) ────────────────────────────────────────
-- Serves claim_reward_on_signup (053). Deliberately un-btrimmed to match that
-- function's predicate verbatim. If 053 is ever normalized to btrim, drop this
-- index — index 1 will cover it.
create index if not exists idx_orders_buyer_contact_lower
  on orders ((lower(buyer_contact)));

-- ── 3. coupon_redemptions — lower(btrim(coalesce(buyer_contact, ''))) ───────
-- Serves the once_per_contact abuse gate in validate_coupon. This is the
-- lookup the blueprint called "the coupon-abuse lookup" while pointing the
-- index at the wrong table.
create index if not exists idx_coupon_redemptions_buyer_contact_norm
  on coupon_redemptions ((lower(btrim(coalesce(buyer_contact, '')))));
