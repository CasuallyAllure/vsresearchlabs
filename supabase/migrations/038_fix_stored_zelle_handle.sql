-- 038_fix_stored_zelle_handle.sql
-- ---------------------------------------------------------------------------
-- One-time data correction: earlier invoices stored the wrong Zelle handle
-- ("ops@vsresearchlabs.com") in orders.payment_method, so the admin editor and
-- the /track invoice doc still display it until the order is re-sent. Rewrite
-- the stored value on any already-invoiced order to the correct handle.
-- Idempotent + targeted (only rows containing the old handle).
-- ---------------------------------------------------------------------------
update orders
   set payment_method = replace(payment_method, 'ops@vsresearchlabs.com', 'info@velariss.co')
 where payment_method like '%ops@vsresearchlabs.com%';
