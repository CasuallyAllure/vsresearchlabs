-- 020_order_flow_rewrite.sql
--
-- Rewires the order flow to the model the user actually runs:
--
--   pending_review   — NEW. Buyer placed the order; admin has not yet
--                      confirmed pricing/lines. No invoice email yet.
--   pending_invoice  — Existing. Admin reviewed; ready to send invoice.
--                      (Kept for legacy orders; new orders skip past this
--                      directly into invoice_sent when the admin chooses
--                      "Send invoice" on save.)
--   invoice_sent     — Existing. Branded invoice has been emailed.
--   payment_claimed  — NEW. Buyer clicked the "I've sent payment" link in
--                      the invoice email. Admin gets notified to verify
--                      the deposit. Status is buyer-asserted, not verified.
--   paid             — Existing. Admin confirmed payment landed.
--   fulfilled        — Existing. Shipped + tracking captured.
--   cancelled / refunded — Existing terminal states.
--
-- Also lands:
--   • save_order_lines RPC — atomically replaces lines + recomputes subtotal,
--     so the order's amount math never drifts from its line items.
--   • mark_payment_claimed RPC — used by the "I've sent payment" Edge
--     Function to advance the order without admin intervention.
--   • Allow the `hand_delivered` carrier value through set_order_tracking /
--     confirm_order_fulfilled (no tracking required when hand-delivered).
--     We don't enforce an enum here — carrier is free-form text. UI
--     surfaces the option in src/lib/tracking.ts.

-- ── 1. New enum values ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'order_status'::regtype and enumlabel = 'pending_review'
  ) then
    alter type order_status add value 'pending_review' before 'pending_invoice';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'order_status'::regtype and enumlabel = 'payment_claimed'
  ) then
    alter type order_status add value 'payment_claimed' before 'paid';
  end if;
end $$;

-- ── 2. save_order_lines RPC ─────────────────────────────────────────────────
-- Atomically replaces the lines for an order and recomputes the order's
-- subtotal_cents from the new lines. Replaces the existing N separate
-- order_lines insert/update/delete trips that AdminOrderDetail was doing;
-- removes the bug where the order header's subtotal_cents went stale after
-- a line edit.
--
-- p_lines is a JSONB array:
--   [{ sku: "VSR-RS-…", product_name: "…", quantity: 1, unit_price_cents: 7500,
--      item_note: null }, …]
--
-- The function deletes all existing lines and re-inserts from the payload.
-- That's simpler than a 3-way diff and matches the UI: every save is a full
-- replacement of the visible row list.

create or replace function save_order_lines(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin    uuid;
  v_line     jsonb;
  v_sku      text;
  v_name     text;
  v_qty      integer;
  v_unit     integer;
  v_subtotal integer := 0;
  v_count    integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  -- Validate each row before mutating anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku  := nullif(btrim(v_line->>'sku'), '');
    v_name := nullif(btrim(v_line->>'product_name'), '');
    v_qty  := nullif(v_line->>'quantity', '')::int;
    v_unit := nullif(v_line->>'unit_price_cents', '')::int;
    if v_sku is null or v_name is null then
      raise exception 'Every line needs sku and product_name';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'Quantity must be 1-9999 (got: %)', v_qty;
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'unit_price_cents must be a non-negative integer';
    end if;
    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_count    := v_count + 1;
  end loop;

  -- Replace lines wholesale.
  delete from order_lines where order_id = p_order_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note)
    values (
      p_order_id,
      btrim(v_line->>'sku'),
      btrim(v_line->>'product_name'),
      (v_line->>'quantity')::int,
      (v_line->>'unit_price_cents')::int,
      nullif(btrim(v_line->>'item_note'), '')
    );
  end loop;

  -- Recompute the order header's subtotal so the invoice math is always in
  -- sync with the lines. shipping_cents and invoice_amount_cents stay where
  -- the admin set them — they're independent decisions.
  update orders
    set subtotal_cents = v_subtotal,
        updated_at     = now()
    where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.lines_saved', 'order', p_order_id::text,
    format('Lines saved (%s item%s, subtotal %s)',
      v_count, case when v_count = 1 then '' else 's' end,
      to_char(v_subtotal::numeric / 100, 'FM999,999,999.00')),
    null, null,
    jsonb_build_object('line_count', v_count, 'subtotal_cents', v_subtotal)
  );

  return jsonb_build_object(
    'line_count',     v_count,
    'subtotal_cents', v_subtotal
  );
end;
$$;

grant execute on function save_order_lines(uuid, jsonb) to authenticated;

-- ── 3. mark_payment_claimed RPC ─────────────────────────────────────────────
-- Buyer-asserted "I've sent payment" link. Advances the status from
-- invoice_sent → payment_claimed and stamps when the click happened. The
-- token-gated Edge Function (`mark-payment-claimed`) is what calls this; the
-- function itself is open to authenticated (admin) callers too in case an
-- admin needs to flip the flag manually.

alter table orders
  add column if not exists payment_claimed_at timestamptz;

create or replace function mark_payment_claimed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing  order_status;
begin
  -- Anyone with the order ID can call this (token-gated via Edge Function);
  -- we don't gate on is_admin() because the buyer-clicked link is the
  -- canonical caller. The RPC IS guarded against double-application: idempotent
  -- if the order is already past invoice_sent.

  select status into v_existing from orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  -- Only advance from invoice_sent. If the admin has already marked paid /
  -- fulfilled, the click is a no-op (still records the timestamp for audit).
  if v_existing = 'invoice_sent' then
    update orders
      set status              = 'payment_claimed',
          payment_claimed_at  = now(),
          updated_at          = now()
      where id = p_order_id;
  else
    update orders
      set payment_claimed_at = coalesce(payment_claimed_at, now()),
          updated_at         = now()
      where id = p_order_id;
  end if;

  perform log_audit(
    'order.payment_claimed', 'order', p_order_id::text,
    'Buyer clicked "I''ve sent payment"',
    null, null, jsonb_build_object('previous_status', v_existing)
  );
end;
$$;

-- Critically: anon must be able to call this so the Edge Function can hit it
-- without an authenticated session. The function itself enforces idempotency.
grant execute on function mark_payment_claimed(uuid) to authenticated, anon;
