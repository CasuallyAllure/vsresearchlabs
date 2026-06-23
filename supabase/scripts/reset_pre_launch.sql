-- reset_pre_launch.sql
--
-- One-time pre-launch cleanup. Wipes ALL test transactional data and zeroes
-- inventory so the store opens from a clean, real baseline. Operator-authorized
-- (wipe = everything; inventory = zero then import real counts from Excel).
--
-- Keeps: product_stock ROWS (the catalog SKU map) — only their on_hand is
-- zeroed. Keeps: catalog/products, admin users, audit_log.
-- Deletes: all orders + lines + events, all inquiries + items, all customers,
-- and the entire stock-movement history.
--
-- Wrapped in a single transaction: it all applies or none of it does.

begin;

-- Order graph (children first to respect FKs).
delete from order_events;
delete from order_lines;
delete from stock_movements;
delete from orders;

-- Inquiry graph.
delete from inquiry_items;
delete from inquiries;

-- Customer directory (test contacts).
delete from customers;

-- Inventory back to a real opening baseline of zero on every SKU.
update product_stock set on_hand = 0, updated_at = now();

commit;

-- Verification (post-commit counts; everything transactional should be 0).
select 'orders' as tbl, count(*) from orders
union all select 'order_lines', count(*) from order_lines
union all select 'order_events', count(*) from order_events
union all select 'stock_movements', count(*) from stock_movements
union all select 'inquiries', count(*) from inquiries
union all select 'inquiry_items', count(*) from inquiry_items
union all select 'customers', count(*) from customers
union all select 'product_stock rows', count(*) from product_stock
union all select 'product_stock on_hand>0', count(*) from product_stock where on_hand > 0;
