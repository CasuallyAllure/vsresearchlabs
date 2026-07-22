-- 068_fulfill_from_variant_stock.sql
-- ---------------------------------------------------------------------------
-- Fulfillment/restock deducted from the LEGACY per-SKU `product_stock` table,
-- but the whole app (catalog, cart, admin inventory, importer, inventory CLI)
-- tracks stock per-dose in `product_variant_stock`. The two tables drifted:
-- an admin could hold 20 of a dose in product_variant_stock while the legacy
-- product_stock row read 0, so "Mark hand-delivered" false-blocked with
--   "Not enough stock for Bacteriostatic Water — 10 mL (VSR-RS-BAC-030):
--    need 1, have 0"
-- even though inventory was full. It also meant every fulfillment decremented
-- the wrong table, so catalog counts never dropped when an order shipped —
-- an overselling risk.
--
-- Root cause is worse for shared SKUs: VSR-RS-BAC-030 is BOTH the 10 mL and
-- 30 mL Bacteriostatic Water, so the per-SKU legacy table can't even tell the
-- two doses apart.
--
-- Fix: the three order-driven stock functions now resolve each order line to
-- its (sku, dose) variant and move `product_variant_stock`. The legacy
-- `product_stock` path is reserved strictly for sku-only items (lab equipment)
-- that have no variant rows at all. Dose is resolved from the server-snapshot
-- `order_lines.product_name` by longest-squashed-dose match, using the canonical
-- `squash_dose_text` (061) so it normalises identically to the checkout price
-- check (same anti-evasion whitespace/control/zero-width stripping). If a sku
-- HAS variant rows but its line name resolves to no dose, the helper raises a
-- clear, actionable error rather than silently falling back to a 0-seeded
-- legacy row (which would reproduce this very "have 0" false-block). Validated
-- read-only against all live order lines (every one resolved to its correct
-- dose, none ambiguous).
--
-- Definitive bodies rewritten here (only the stock loops change; reward-ledger
-- and audit logic is carried over verbatim):
--   • confirm_order_fulfilled  (prev definitive body: 026)
--   • cancel_order             (prev definitive body: 044)
--   • revert_order_status      (prev definitive body: 044)
--
-- No schema change. Additive helpers only. Deploy: `supabase db push`.
--
-- Rollback: re-apply the 026 body of confirm_order_fulfilled and the 044
-- bodies of cancel_order / revert_order_status, then drop the two helpers.
-- ---------------------------------------------------------------------------

-- ── Internal helper 1: resolve an order line to its variant dose ─────────────
-- Returns the dose whose squashed text is the LONGEST one contained in the
-- squashed product name, among this sku's variant rows. Returns NULL when the
-- sku has no variant rows, when nothing matches, or when the matches are
-- ambiguous (a matched dose that is not nested inside the winner). Reuses the
-- canonical squash_dose_text (061) so it normalises identically to the checkout
-- price check — the same anti-evasion whitespace/control/zero-width stripping.
-- Not order-guarded, so it must never be callable directly (execute revoked).
create or replace function _resolve_line_dose(p_sku text, p_product_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_name_sq text;
  v_row     record;
  v_best    text := null;
  v_best_sq text := '';
  v_matched text[] := '{}';
begin
  v_name_sq := squash_dose_text(p_product_name);
  if v_name_sq = '' then
    return null;
  end if;

  for v_row in
    select dose, squash_dose_text(dose) as sq
      from product_variant_stock
     where sku = p_sku
       and btrim(dose) <> ''
  loop
    if v_row.sq <> '' and position(v_row.sq in v_name_sq) > 0 then
      v_matched := array_append(v_matched, v_row.sq);
      if length(v_row.sq) > length(v_best_sq) then
        v_best_sq := v_row.sq;
        v_best    := v_row.dose;
      end if;
    end if;
  end loop;

  if v_best is null then
    return null;                       -- sku has no variant rows, or none matched
  end if;

  -- Ambiguous when a matched dose is NOT nested inside the winner: the name
  -- would be naming two distinct doses, which a real order line never does.
  -- Be safe and fall back to legacy in that case.
  for v_row in select unnest(v_matched) as sq loop
    if position(v_row.sq in v_best_sq) = 0 then
      return null;
    end if;
  end loop;

  return v_best;
end;
$$;

revoke execute on function _resolve_line_dose(text, text) from public;

-- ── Internal helper 2: apply one order line's stock movement ─────────────────
-- Deducts (p_deduct=true) or restocks (false) p_quantity for a line, choosing
-- the right table: product_variant_stock when the line resolves to a variant
-- dose, else the legacy product_stock. Raises the friendly, product-named
-- shortage error on deduct. Not order-guarded — execute revoked below.
create or replace function _apply_order_stock(
  p_sku          text,
  p_product_name text,
  p_quantity     integer,
  p_deduct       boolean,
  p_reason       stock_movement_reason,
  p_order_id     uuid,
  p_admin        uuid,
  p_notes        text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_dose        text;
  v_on_hand     integer;
  v_delta       integer;
  v_label       text;
  v_has_variant boolean;
begin
  v_dose  := _resolve_line_dose(p_sku, p_product_name);
  v_delta := case when p_deduct then -p_quantity else p_quantity end;
  v_label := coalesce(nullif(btrim(p_product_name), ''), p_sku);

  -- A variant-tracked sku whose dose could NOT be resolved must NOT silently
  -- fall through to the legacy per-sku table — that path seeds a 0 row and
  -- reproduces the exact "have 0" false-block this migration fixes. Raise a
  -- clear, actionable error instead. The legacy path is reserved strictly for
  -- sku-only items (lab equipment) that have no variant rows at all.
  if v_dose is null then
    select exists (select 1 from product_variant_stock where sku = p_sku)
      into v_has_variant;
    if v_has_variant then
      raise exception
        'Could not match a dose for % (%) to inventory — the line name does not name one of this product''s stocked doses. Fix the product name or the dose rows, then retry.',
        v_label, p_sku
        using errcode = 'P0001';
    end if;
  end if;

  if v_dose is not null then
    -- Variant-tracked line: move the per-dose row the catalog actually reads.
    select on_hand into v_on_hand
      from product_variant_stock
      where sku = p_sku and dose = v_dose
      for update;

    if p_deduct and coalesce(v_on_hand, 0) < p_quantity then
      raise exception 'Not enough stock for % — % (%): need %, have %',
        v_label, v_dose, p_sku, p_quantity, coalesce(v_on_hand, 0)
        using errcode = 'P0001';
    end if;

    update product_variant_stock
      set on_hand    = on_hand + v_delta,
          updated_at = now()
      where sku = p_sku and dose = v_dose
      returning on_hand into v_on_hand;

    insert into stock_movements
      (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
    values
      (p_sku, v_delta, p_reason, p_order_id, p_admin, v_on_hand,
       btrim(coalesce(p_notes, '') || ' [dose ' || v_dose || ']'));
  else
    -- Legacy sku-only line (no variant rows at all — e.g. lab equipment):
    -- move the per-sku product_stock table.
    insert into product_stock (sku, on_hand) values (p_sku, 0)
      on conflict (sku) do nothing;

    select on_hand into v_on_hand
      from product_stock where sku = p_sku for update;

    if p_deduct and coalesce(v_on_hand, 0) < p_quantity then
      raise exception 'Not enough stock for % (%): need %, have %',
        v_label, p_sku, p_quantity, coalesce(v_on_hand, 0)
        using errcode = 'P0001';
    end if;

    update product_stock
      set on_hand    = on_hand + v_delta,
          updated_at = now()
      where sku = p_sku
      returning on_hand into v_on_hand;

    insert into stock_movements
      (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
    values
      (p_sku, v_delta, p_reason, p_order_id, p_admin, v_on_hand, p_notes);
  end if;
end;
$$;

revoke execute on function _apply_order_stock(text, text, integer, boolean,
  stock_movement_reason, uuid, uuid, text) from public;

-- ── confirm_order_fulfilled — deduct from variant stock ─────────────────────
create or replace function confirm_order_fulfilled(
  p_order_id        uuid,
  p_tracking_number text default null,
  p_carrier         text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin uuid;
  v_line  record;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_admin := auth.uid();

  perform 1 from orders where id = p_order_id and status = 'paid' for update;
  if not found then
    raise exception 'Order must be paid to mark fulfilled';
  end if;

  for v_line in
    select * from order_lines where order_id = p_order_id
  loop
    perform _apply_order_stock(
      v_line.sku, v_line.product_name, v_line.quantity, true,
      'order_fulfilled', p_order_id, v_admin, null);
  end loop;

  update orders
    set status          = 'fulfilled',
        tracking_number = coalesce(p_tracking_number, tracking_number),
        carrier         = coalesce(nullif(btrim(p_carrier), ''), carrier),
        shipped_at      = coalesce(shipped_at, now()),
        fulfilled_at    = now(),
        updated_at      = now()
    where id = p_order_id;
end;
$$;

grant execute on function confirm_order_fulfilled(uuid, text, text) to authenticated;

-- ── cancel_order — restock variant stock on cancel-after-fulfill ────────────
-- 044 body preserved verbatim except the fulfilled-branch stock loop.
create or replace function cancel_order(
  p_order_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin     uuid;
  v_status    order_status;
  v_order_no  text;
  v_line      record;
  v_restocked integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  select status, order_number into v_status, v_order_no
    from orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status in ('cancelled', 'refunded') then
    raise exception 'Order already terminal';
  end if;

  if v_status = 'fulfilled' then
    for v_line in
      select * from order_lines where order_id = p_order_id
    loop
      perform _apply_order_stock(
        v_line.sku, v_line.product_name, v_line.quantity, false,
        'order_cancelled_after_fulfill', p_order_id, v_admin,
        'Restock from cancelled fulfilled order');

      v_restocked := v_restocked + 1;
    end loop;
  end if;

  update orders
    set status              = 'cancelled',
        cancelled_at        = now(),
        cancellation_reason = p_reason,
        updated_at          = now()
    where id = p_order_id;

  -- 044: append the compensating reward reversal (once) on cancellation.
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
  select rl.user_id, rl.order_id, 'reversal', -rl.points,
         format('Reversed on cancellation of %s', v_order_no), v_admin
    from reward_ledger rl
   where rl.order_id = p_order_id
     and rl.kind = 'earn'
     and not exists (
       select 1 from reward_ledger r2
        where r2.order_id = p_order_id and r2.kind = 'reversal'
     )
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  perform log_audit(
    'order.cancelled', 'order', p_order_id::text,
    format('Cancelled %s%s — %s',
      v_order_no,
      case when v_restocked > 0 then format(' (restocked %s lines)', v_restocked) else '' end,
      p_reason),
    jsonb_build_object('status', v_status),
    jsonb_build_object(
      'status', 'cancelled',
      'reason', p_reason,
      'restocked_lines', v_restocked
    ),
    null
  );
end;
$$;

grant execute on function cancel_order(uuid, text) to authenticated;

-- ── revert_order_status — restock variant stock on shipped → paid ───────────
-- 044 body preserved verbatim except the shipped→paid branch stock loop.
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
      perform _apply_order_stock(
        v_line.sku, v_line.product_name, v_line.quantity, false,
        'order_cancelled_after_fulfill', p_order_id, v_admin,
        'Restock from reverted order');
    end loop;
    update orders
      set status = 'paid', fulfilled_at = null, shipped_at = null,
          tracking_number = null, carrier = null
      where id = p_order_id;
    v_new := 'paid';

  elsif v_status = 'paid' then
    update orders set status = 'invoice_sent', paid_at = null where id = p_order_id;
    v_new := 'invoice_sent';

    -- 044: leaving paid territory — append the compensating reward reversal.
    insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
    select rl.user_id, rl.order_id, 'reversal', -rl.points,
           'Reversed on payment revert', v_admin
      from reward_ledger rl
     where rl.order_id = p_order_id
       and rl.kind = 'earn'
       and not exists (
         select 1 from reward_ledger r2
          where r2.order_id = p_order_id and r2.kind = 'reversal'
       )
    on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

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
