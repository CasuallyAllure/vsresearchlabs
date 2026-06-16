-- =============================================================================
-- VS Research Labs — Order receipt + status revert
-- =============================================================================
-- 1. Receipt: when an order is completed (delivered/paid), the buyer gets a
--    branded PAID receipt. The receipt is regenerable from the order, so we
--    only store the fact we sent it (receipt_sent_at, receipt_count). The admin
--    can preview or resend it anytime.
--
-- 2. Revert: if a payment turns out to be funny (reversed, compromised, etc.)
--    the admin can step an order BACK one stage. Reverting out of 'fulfilled'
--    restocks every line (mirrors cancel_order). The reason is stamped on the
--    order as flag_note + flagged_at so the order visibly carries a "reverted /
--    compromised" record, and every revert writes an audit row.
--
-- Additive. Re-runnable.
-- =============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='receipt_sent_at') then
    alter table orders add column receipt_sent_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='receipt_count') then
    alter table orders add column receipt_count integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='flag_note') then
    alter table orders add column flag_note text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='flagged_at') then
    alter table orders add column flagged_at timestamptz;
  end if;
end $$;

-- ── mark_receipt_sent — atomic stamp + increment ────────────────────────────

create or replace function mark_receipt_sent(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Callable by the service-role edge function; also admin-safe.
  if auth.uid() is not null and not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  update orders
    set receipt_sent_at = now(),
        receipt_count   = coalesce(receipt_count, 0) + 1,
        updated_at      = now()
    where id = p_order_id;
end;
$$;

grant execute on function mark_receipt_sent(uuid) to authenticated, service_role;

-- ── revert_order_status — step back one stage, restock if needed ────────────

create or replace function revert_order_status(
  p_order_id uuid,
  p_reason   text
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin     uuid;
  v_status    order_status;
  v_delivered timestamptz;
  v_line      record;
  v_on_hand   integer;
  v_new       text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  select status, delivered_at into v_status, v_delivered
    from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if v_status = 'fulfilled' and v_delivered is not null then
    -- Delivered → un-deliver (back to shipped). No stock change.
    update orders set delivered_at = null where id = p_order_id;
    v_new := 'fulfilled';

  elsif v_status = 'fulfilled' then
    -- Shipped → paid. Restock every line (reverse the fulfillment).
    for v_line in select * from order_lines where order_id = p_order_id loop
      update product_stock
        set on_hand = on_hand + v_line.quantity, updated_at = now()
        where sku = v_line.sku
        returning on_hand into v_on_hand;
      insert into stock_movements (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
        values (v_line.sku, v_line.quantity, 'order_cancelled_after_fulfill',
                p_order_id, v_admin, v_on_hand, 'Restock from reverted order');
    end loop;
    update orders
      set status = 'paid', fulfilled_at = null, shipped_at = null,
          tracking_number = null, carrier = null
      where id = p_order_id;
    v_new := 'paid';

  elsif v_status = 'paid' then
    update orders set status = 'invoice_sent', paid_at = null where id = p_order_id;
    v_new := 'invoice_sent';

  elsif v_status = 'invoice_sent' then
    update orders set status = 'pending_invoice', invoiced_at = null where id = p_order_id;
    v_new := 'pending_invoice';

  elsif v_status in ('cancelled', 'refunded') then
    -- Revive a cancelled/refunded order back to the start of the pipeline.
    update orders
      set status = 'pending_invoice', cancelled_at = null, cancellation_reason = null
      where id = p_order_id;
    v_new := 'pending_invoice';

  else
    raise exception 'Order is already at the earliest stage; nothing to revert';
  end if;

  -- Stamp the flag/record on the order + audit it.
  update orders
    set flag_note  = nullif(btrim(p_reason), ''),
        flagged_at = now(),
        updated_at = now()
    where id = p_order_id;

  perform log_audit(
    'order.reverted', 'order', p_order_id::text,
    format('Reverted %s → %s%s', v_status, v_new,
           case when nullif(btrim(p_reason), '') is null then '' else ': ' || p_reason end),
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', v_new, 'reason', p_reason),
    null
  );

  return v_new;
end;
$$;

grant execute on function revert_order_status(uuid, text) to authenticated;

-- ── clear_order_flag — dismiss the reverted/compromised marker ──────────────

create or replace function clear_order_flag(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  update orders set flag_note = null, flagged_at = null, updated_at = now()
    where id = p_order_id;
  perform log_audit('order.flag_cleared', 'order', p_order_id::text, 'Cleared order flag', null, null, null);
end;
$$;

grant execute on function clear_order_flag(uuid) to authenticated;
