-- =============================================================================
-- VS Research Labs — Inventory & Order Operations (S2)
-- =============================================================================
-- Operational backend for inventory, orders, invoicing, fulfillment, and
-- stock auditing. Builds on 001 (products / supplier links) and 002
-- (inquiries / inquiry_items).
--
-- Architectural invariants:
--   - Stock moves ONLY on confirm_order_fulfilled (or on a manual adjust /
--     restock). Inquiry submission, invoice send, and payment receipt do
--     NOT touch product_stock.
--   - All mutations on operational tables flow through SECURITY DEFINER
--     RPCs that check is_admin(). Direct INSERT/UPDATE/DELETE from the
--     client is blocked by RLS.
--   - stock_movements is append-only and snapshots on_hand_after every
--     change. Reconstruction of any historical state is by replay.
-- =============================================================================

-- ── Admin role + helper ────────────────────────────────────────────────────

create table admin_users (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  email        text        not null,
  display_name text,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

alter table admin_users enable row level security;

-- Tightly scoped helper. SECURITY DEFINER so RLS policies can call it
-- without granting the policy evaluator access to admin_users itself.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and active = true
  );
$$;

grant execute on function is_admin() to authenticated;

create policy "Admins can read admin_users"
  on admin_users for select
  using (is_admin());

-- ── Stock ─────────────────────────────────────────────────────────────────
-- SKU is the join key. No FK to a products table — the canonical catalog
-- lives in src/data/products.json today. If/when products migrate to
-- Postgres, add a FK + index in a follow-up migration.

create table product_stock (
  sku          text        primary key,
  on_hand      integer     not null default 0 check (on_hand >= 0),
  reorder_at   integer,
  last_counted timestamptz,
  notes        text,
  updated_at   timestamptz not null default now()
);

create index product_stock_updated_at_idx on product_stock (updated_at desc);

alter table product_stock enable row level security;

create policy "Admins can read product_stock"
  on product_stock for select
  using (is_admin());

-- ── Orders ────────────────────────────────────────────────────────────────

create type order_status as enum (
  'pending_invoice',
  'invoice_sent',
  'paid',
  'fulfilled',
  'cancelled',
  'refunded'
);

create table orders (
  id                   uuid         primary key default gen_random_uuid(),
  order_number         text         unique not null,
  inquiry_id           uuid         references inquiries(id) on delete set null,
  status               order_status not null default 'pending_invoice',

  -- Buyer snapshot at order creation (insulates from inquiry edits)
  buyer_name           text         not null,
  buyer_contact        text         not null,
  buyer_organization   text,
  notes                text,

  -- Invoice + payment metadata
  invoice_url          text,
  invoice_amount_cents integer,
  payment_method       text,
  invoiced_at          timestamptz,
  paid_at              timestamptz,

  -- Fulfillment + termination
  tracking_number      text,
  fulfilled_at         timestamptz,
  cancelled_at         timestamptz,
  cancellation_reason  text,

  created_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id),
  updated_at           timestamptz not null default now()
);

create index orders_status_idx     on orders (status);
create index orders_created_at_idx on orders (created_at desc);
create index orders_inquiry_id_idx on orders (inquiry_id);

alter table orders enable row level security;

create policy "Admins can read orders"
  on orders for select
  using (is_admin());

-- ── Order lines ───────────────────────────────────────────────────────────
-- Snapshot of the items at order creation. Quantity here is what gets
-- decremented from product_stock on fulfillment.

create table order_lines (
  id               uuid    primary key default gen_random_uuid(),
  order_id         uuid    not null references orders(id) on delete cascade,
  sku              text    not null,
  product_name     text    not null,
  quantity         integer not null check (quantity > 0 and quantity <= 9999),
  unit_price_cents integer,
  item_note        text
);

create index order_lines_order_id_idx on order_lines (order_id);
create index order_lines_sku_idx      on order_lines (sku);

alter table order_lines enable row level security;

create policy "Admins can read order_lines"
  on order_lines for select
  using (is_admin());

-- ── Stock movements (append-only audit log) ───────────────────────────────

create type stock_movement_reason as enum (
  'initial_seed',                     -- inserted at first time a SKU is stocked
  'manual_adjustment',                -- admin tweak via UI
  'physical_count',                   -- inventory recount reconciliation
  'restock_received',                 -- new supply arrived
  'damage_loss',                      -- write-off / spoilage
  'order_fulfilled',                  -- decrement from confirm_order_fulfilled
  'order_cancelled_after_fulfill'     -- restock from cancel_order on a fulfilled order
);

create table stock_movements (
  id            uuid                  primary key default gen_random_uuid(),
  sku           text                  not null,
  delta         integer               not null,
  reason        stock_movement_reason not null,
  notes         text,
  order_id      uuid                  references orders(id) on delete set null,
  admin_id      uuid                  references auth.users(id),
  on_hand_after integer               not null check (on_hand_after >= 0),
  created_at    timestamptz           not null default now()
);

create index stock_movements_sku_idx        on stock_movements (sku, created_at desc);
create index stock_movements_order_idx      on stock_movements (order_id);
create index stock_movements_created_at_idx on stock_movements (created_at desc);

alter table stock_movements enable row level security;

create policy "Admins can read stock_movements"
  on stock_movements for select
  using (is_admin());

-- ── Tighten existing inquiry policies to admin-only ───────────────────────
-- 002 used `auth.role() = 'authenticated'` which would expose inquiries to
-- ANY logged-in Supabase user. With admin_users now in place, narrow to
-- admin-only and grant admins UPDATE on inquiry status as well.

drop policy if exists "Inquiries readable by admin" on inquiries;
drop policy if exists "Inquiry items readable by admin" on inquiry_items;

create policy "Admins can read inquiries"
  on inquiries for select
  using (is_admin());

create policy "Admins can update inquiries"
  on inquiries for update
  using (is_admin())
  with check (is_admin());

create policy "Admins can read inquiry_items"
  on inquiry_items for select
  using (is_admin());

-- ============================================================================
-- RPCs — every state-changing operation runs SECURITY DEFINER with admin check
-- ============================================================================

-- ── seed_stock_row ────────────────────────────────────────────────────────
-- Idempotent: creates a stock row at p_initial if absent. Logs only on
-- first creation. Used by the admin Dashboard "Seed catalog stock" button.

create or replace function seed_stock_row(
  p_sku     text,
  p_initial integer
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inserted boolean := false;
  v_admin    uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_initial < 0 then
    raise exception 'Initial stock must be non-negative';
  end if;

  v_admin := auth.uid();

  insert into product_stock (sku, on_hand, last_counted)
    values (p_sku, p_initial, now())
    on conflict (sku) do nothing
    returning true into v_inserted;

  if v_inserted then
    insert into stock_movements (sku, delta, reason, admin_id, on_hand_after, notes)
      values (p_sku, p_initial, 'initial_seed', v_admin, p_initial,
              'Seeded from catalog');
  end if;

  return coalesce(v_inserted, false);
end;
$$;

grant execute on function seed_stock_row(text, integer) to authenticated;

-- ── adjust_stock ──────────────────────────────────────────────────────────
-- Apply a delta (+/-) with reason. Auto-creates the stock row at 0 if it
-- doesn't exist (so admins can "add 50" to a freshly cataloged SKU
-- without seeding first). Always logs to stock_movements.

create or replace function adjust_stock(
  p_sku    text,
  p_delta  integer,
  p_reason stock_movement_reason,
  p_notes  text default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin   uuid;
  v_on_hand integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_reason in ('order_fulfilled', 'order_cancelled_after_fulfill') then
    raise exception 'Use confirm_order_fulfilled / cancel_order for order-driven movements';
  end if;

  v_admin := auth.uid();

  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;

  update product_stock
    set on_hand    = on_hand + p_delta,
        updated_at = now()
    where sku = p_sku
    returning on_hand into v_on_hand;

  if v_on_hand < 0 then
    raise exception 'Stock cannot go negative for SKU %', p_sku;
  end if;

  insert into stock_movements (sku, delta, reason, notes, admin_id, on_hand_after)
    values (p_sku, p_delta, p_reason, p_notes, v_admin, v_on_hand);

  return v_on_hand;
end;
$$;

grant execute on function adjust_stock(text, integer, stock_movement_reason, text)
  to authenticated;

-- ── create_order_from_inquiry ─────────────────────────────────────────────
-- Promotes an inquiry to an order with status 'pending_invoice'. Copies
-- inquiry_items → order_lines. Marks the inquiry REVIEWING. Returns the
-- new order id.

create or replace function create_order_from_inquiry(
  p_inquiry_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inq      inquiries%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_admin    uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_admin := auth.uid();

  select * into v_inq from inquiries where id = p_inquiry_id;
  if not found then
    raise exception 'Inquiry not found';
  end if;

  -- VSR-ORD-YYMMDD-NNN (centisecond bucket mod 1000)
  v_order_no := 'VSR-ORD-' ||
                to_char(now() at time zone 'utc', 'YYMMDD') ||
                '-' ||
                lpad((floor(extract(epoch from clock_timestamp()) * 10)::bigint % 1000)::text,
                     3, '0');

  insert into orders (
    order_number, inquiry_id, status,
    buyer_name, buyer_contact, buyer_organization, notes,
    created_by
  )
  values (
    v_order_no, p_inquiry_id, 'pending_invoice',
    v_inq.name, v_inq.contact, v_inq.organization, v_inq.notes,
    v_admin
  )
  returning id into v_order_id;

  insert into order_lines (order_id, sku, product_name, quantity, item_note)
  select v_order_id, sku, product_name, quantity, item_note
  from inquiry_items
  where inquiry_id = p_inquiry_id;

  update inquiries
    set status = 'REVIEWING'
    where id = p_inquiry_id
      and status = 'OPEN';

  return v_order_id;
end;
$$;

grant execute on function create_order_from_inquiry(uuid) to authenticated;

-- ── mark_order_invoiced ───────────────────────────────────────────────────
-- Records invoice metadata and flips status pending_invoice → invoice_sent.
-- Does NOT send the actual invoice email; the client-side flow calls a
-- separate Edge Function for that and then calls this RPC on success.

create or replace function mark_order_invoiced(
  p_order_id            uuid,
  p_invoice_url         text,
  p_invoice_amount_cents integer,
  p_payment_method      text default 'PayPal Friends & Family or Zelle'
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_invoice_amount_cents is not null and p_invoice_amount_cents < 0 then
    raise exception 'Invoice amount cannot be negative';
  end if;

  update orders
    set status               = 'invoice_sent',
        invoice_url          = p_invoice_url,
        invoice_amount_cents = p_invoice_amount_cents,
        payment_method       = p_payment_method,
        invoiced_at          = now(),
        updated_at           = now()
    where id = p_order_id
      and status = 'pending_invoice';

  if not found then
    raise exception 'Order must be pending_invoice to mark invoiced';
  end if;
end;
$$;

grant execute on function mark_order_invoiced(uuid, text, integer, text)
  to authenticated;

-- ── mark_order_paid ───────────────────────────────────────────────────────
-- invoice_sent → paid. Admin's signal that payment was received and verified.
-- Still does NOT decrement stock.

create or replace function mark_order_paid(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update orders
    set status     = 'paid',
        paid_at    = now(),
        updated_at = now()
    where id = p_order_id
      and status = 'invoice_sent';

  if not found then
    raise exception 'Order must be invoice_sent to mark paid';
  end if;
end;
$$;

grant execute on function mark_order_paid(uuid) to authenticated;

-- ── confirm_order_fulfilled ───────────────────────────────────────────────
-- THE stock-moving operation. paid → fulfilled with atomic stock decrement
-- and movement log per line. If any SKU's stock would go negative the
-- whole transaction rolls back.

create or replace function confirm_order_fulfilled(
  p_order_id        uuid,
  p_tracking_number text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin    uuid;
  v_line     record;
  v_on_hand  integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_admin := auth.uid();

  -- Lock the order row to prevent concurrent fulfillment
  perform 1 from orders where id = p_order_id and status = 'paid' for update;
  if not found then
    raise exception 'Order must be paid to mark fulfilled';
  end if;

  for v_line in
    select * from order_lines where order_id = p_order_id
  loop
    -- Auto-seed stock row if missing so the decrement check is meaningful
    insert into product_stock (sku, on_hand) values (v_line.sku, 0)
      on conflict (sku) do nothing;

    update product_stock
      set on_hand    = on_hand - v_line.quantity,
          updated_at = now()
      where sku = v_line.sku
      returning on_hand into v_on_hand;

    if v_on_hand < 0 then
      raise exception 'Insufficient stock for SKU % (line quantity %)',
        v_line.sku, v_line.quantity;
    end if;

    insert into stock_movements
      (sku, delta, reason, order_id, admin_id, on_hand_after)
    values
      (v_line.sku, -v_line.quantity, 'order_fulfilled',
       p_order_id, v_admin, v_on_hand);
  end loop;

  update orders
    set status          = 'fulfilled',
        tracking_number = coalesce(p_tracking_number, tracking_number),
        fulfilled_at    = now(),
        updated_at      = now()
    where id = p_order_id;
end;
$$;

grant execute on function confirm_order_fulfilled(uuid, text) to authenticated;

-- ── cancel_order ──────────────────────────────────────────────────────────
-- Terminal cancellation. If the order was already fulfilled, restocks every
-- line + logs a movement per line. Otherwise just transitions status.

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
  v_admin   uuid;
  v_status  order_status;
  v_line    record;
  v_on_hand integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_admin := auth.uid();

  select status into v_status from orders where id = p_order_id for update;
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
      update product_stock
        set on_hand    = on_hand + v_line.quantity,
            updated_at = now()
        where sku = v_line.sku
        returning on_hand into v_on_hand;

      insert into stock_movements
        (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
      values
        (v_line.sku, v_line.quantity, 'order_cancelled_after_fulfill',
         p_order_id, v_admin, v_on_hand,
         'Restock from cancelled fulfilled order');
    end loop;
  end if;

  update orders
    set status              = 'cancelled',
        cancelled_at        = now(),
        cancellation_reason = p_reason,
        updated_at          = now()
    where id = p_order_id;
end;
$$;

grant execute on function cancel_order(uuid, text) to authenticated;
