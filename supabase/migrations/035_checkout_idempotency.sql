-- 035_checkout_idempotency.sql
-- Duplicate-order protection for the public checkout (place-order).
--
-- The client generates a UUID per checkout attempt and re-sends the SAME key
-- when retrying after a timeout/network failure. place-order returns the
-- already-created order for a seen key instead of creating (and re-emailing)
-- a duplicate. Admin-created orders don't send a key — column stays null.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the updated place-order
-- function (the function inserts into this column).

alter table orders add column if not exists idempotency_key uuid;

-- Partial unique index: enforces one order per key while letting the
-- (historic + admin) null rows through.
create unique index if not exists orders_idempotency_key_uidx
  on orders (idempotency_key)
  where idempotency_key is not null;

comment on column orders.idempotency_key is
  'Client-generated UUID for checkout dedupe; null for admin-created orders.';
