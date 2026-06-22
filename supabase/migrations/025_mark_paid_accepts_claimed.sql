-- 025_mark_paid_accepts_claimed.sql
--
-- Fix: mark_order_paid (004) only advanced an order from 'invoice_sent'. But
-- migration 020 added the 'payment_claimed' stage — the buyer clicks "I've
-- sent payment" and the order moves invoice_sent → payment_claimed BEFORE the
-- admin confirms the deposit. The admin's "Payment received" button then hit
-- the old guard and failed with "Order must be invoice_sent to mark paid".
--
-- Accept BOTH invoice_sent and payment_claimed as valid prior states. The
-- buyer-claimed timestamp is preserved; we only advance the status to paid.

create or replace function mark_order_paid(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order_no text;
  v_prev     order_status;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select status into v_prev from orders where id = p_order_id;

  update orders
    set status     = 'paid',
        paid_at    = now(),
        updated_at = now()
    where id = p_order_id
      and status in ('invoice_sent', 'payment_claimed')
    returning order_number into v_order_no;

  if v_order_no is null then
    raise exception 'Order must be invoice_sent or payment_claimed to mark paid (got %)', v_prev;
  end if;

  perform log_audit(
    'order.paid', 'order', p_order_id::text,
    format('Payment confirmed for %s', v_order_no),
    jsonb_build_object('status', v_prev),
    jsonb_build_object('status', 'paid'),
    null
  );
end;
$$;
