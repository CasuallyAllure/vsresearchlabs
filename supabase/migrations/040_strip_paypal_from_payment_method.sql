-- 039_strip_paypal_from_payment_method.sql
-- ---------------------------------------------------------------------------
-- Zelle-only: older orders placed through checkout stored payment_method as
-- "Zelle (…) or PayPal (…)". The admin invoice preview and /track doc render
-- that stored string, so PayPal still shows on those orders. Strip the
-- "… or PayPal …" tail, leaving just the Zelle handle. Idempotent + targeted.
-- ---------------------------------------------------------------------------
update orders
   set payment_method = btrim(regexp_replace(payment_method, '\s*or\s+PayPal.*$', '', 'i'))
 where payment_method ilike '%PayPal%';
