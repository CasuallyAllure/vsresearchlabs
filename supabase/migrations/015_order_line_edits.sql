-- 015_order_line_edits.sql
-- Let admins edit an order's itemized lines after creation (add / change /
-- remove items when a buyer adjusts their order). order_lines already has an
-- admin SELECT policy (003); this adds the write side, admin-only via is_admin().

create policy "Admins can insert order_lines"
  on order_lines for insert
  with check (is_admin());

create policy "Admins can update order_lines"
  on order_lines for update
  using (is_admin()) with check (is_admin());

create policy "Admins can delete order_lines"
  on order_lines for delete
  using (is_admin());
