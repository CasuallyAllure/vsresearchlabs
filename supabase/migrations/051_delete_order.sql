-- =============================================================================
-- VS Research Labs — Permanent order deletion (admin-only)
-- =============================================================================
-- Deleting a row from `orders` is safe by construction: order_lines,
-- order_events, and order_coupons are ON DELETE CASCADE; stock_movements,
-- coupon_redemptions, reward_ledger, and reward_vouchers are ON DELETE SET
-- NULL (those ledgers survive the order they reference). No new FK clauses
-- are needed — this migration only adds the admin-gated deletion path.
--
-- delete_order() is:
--   • Admin-gated — is_admin() check, same as every other admin RPC.
--   • Status-guarded — only 'pending_invoice' or 'cancelled' orders may be
--     deleted. A paid/invoiced/fulfilled order must go through cancel_order
--     first (which reverses stock and reward points); this prevents a
--     live/fulfilled order from disappearing without that reversal.
--   • Audit-snapshotted — the full order row + its order_lines are captured
--     as jsonb into audit_log.before_value BEFORE the row is deleted, so the
--     append-only audit trail retains a complete record of what existed.
--
-- Additive. Re-runnable (create or replace).
-- =============================================================================

create or replace function delete_order(
  p_order_id uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order    orders%rowtype;
  v_snapshot jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status not in ('pending_invoice', 'cancelled') then
    raise exception 'Cancel the order before deleting it (status: %)', v_order.status;
  end if;

  v_snapshot := jsonb_build_object(
    'order', to_jsonb(v_order),
    'lines', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
        from order_lines l
       where l.order_id = p_order_id
    )
  );

  perform log_audit(
    'order.deleted', 'order', p_order_id::text,
    format('Permanently deleted %s — %s',
      v_order.order_number, coalesce(p_reason, 'no reason given')),
    v_snapshot,
    null,
    null
  );

  delete from orders where id = p_order_id;
end;
$$;

grant execute on function delete_order(uuid, text) to authenticated;
