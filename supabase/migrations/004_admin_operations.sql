-- =============================================================================
-- VS Research Labs — Admin Operations Foundation (S3)
-- =============================================================================
-- Adds the audit log + customers dedupe + admin role distinction. Strictly
-- additive — existing tables, RPCs, and frontends continue to work.
--
-- Architectural invariants:
--   - audit_log is append-only. No UPDATE, no DELETE.
--   - log_audit() is the single helper every RPC calls to record an event.
--   - customers are auto-upserted by trigger on inquiries INSERT, keyed by
--     lowercase(contact). Manual edits are admin-only via RPC (future).
--   - Adding columns is fine; renaming existing columns is forbidden until
--     a coordinated frontend ship.
-- =============================================================================


-- ── admin_users: add role distinction ──────────────────────────────────────
-- Existing rows default to 'admin'. Future delegation can promote one to
-- 'owner' or demote to 'staff'.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'admin_users' and column_name = 'role'
  ) then
    alter table admin_users
      add column role text not null default 'admin'
      check (role in ('owner', 'admin', 'staff'));
  end if;
end $$;


-- ── audit_log: append-only event store ─────────────────────────────────────

create table if not exists audit_log (
  id            uuid        primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  actor_id      uuid        references auth.users(id) on delete set null,
  actor_email   text,                          -- snapshot at log time
  action        text        not null,          -- e.g. 'order.invoiced'
  entity_type   text        not null,          -- 'order' | 'inquiry' | 'stock' | 'customer' | 'admin_user' | 'system'
  entity_id     text,                          -- uuid or sku string, depending on type
  summary       text,                          -- 1-line human-readable description
  before_value  jsonb,                         -- prior state (optional)
  after_value   jsonb,                         -- new state (optional)
  context       jsonb                          -- request_id, ip, etc. (optional)
);

create index if not exists audit_log_occurred_at_idx on audit_log (occurred_at desc);
create index if not exists audit_log_actor_idx       on audit_log (actor_id);
create index if not exists audit_log_action_idx      on audit_log (action);
create index if not exists audit_log_entity_idx      on audit_log (entity_type, entity_id);

alter table audit_log enable row level security;

drop policy if exists "Admins can read audit_log" on audit_log;
create policy "Admins can read audit_log"
  on audit_log for select
  using (is_admin());

-- Explicitly block client INSERT/UPDATE/DELETE. Only SECURITY DEFINER RPCs
-- (which bypass RLS by privilege) can write.
revoke insert, update, delete on audit_log from anon, authenticated;


-- ── log_audit(): the helper every RPC calls ────────────────────────────────

create or replace function log_audit(
  p_action       text,
  p_entity_type  text,
  p_entity_id    text         default null,
  p_summary      text         default null,
  p_before_value jsonb        default null,
  p_after_value  jsonb        default null,
  p_context      jsonb        default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id    uuid;
  v_email text;
begin
  -- Snapshot the actor's email at write time so reading back doesn't
  -- depend on auth.users (which may have been rotated).
  select email into v_email from auth.users where id = auth.uid();

  insert into audit_log
    (actor_id, actor_email, action, entity_type, entity_id, summary,
     before_value, after_value, context)
  values
    (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_summary,
     p_before_value, p_after_value, p_context)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function log_audit(text, text, text, text, jsonb, jsonb, jsonb)
  to authenticated;


-- ── customers: dedupe by lowercase(contact) ────────────────────────────────

create table if not exists customers (
  id              uuid        primary key default gen_random_uuid(),
  contact_key     text        unique not null,  -- lower(trim(contact))
  display_name    text        not null,         -- most recent name seen
  contact         text        not null,         -- most recent contact seen
  organization    text,                         -- most recent org seen
  phone           text,                         -- future field
  notes           text,                         -- admin-only notes
  status          text        not null default 'active'
                              check (status in ('active', 'inactive', 'blocked')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  inquiry_count   integer     not null default 0,
  order_count     integer     not null default 0
);

create index if not exists customers_last_seen_idx on customers (last_seen_at desc);
create index if not exists customers_status_idx    on customers (status);

alter table customers enable row level security;

drop policy if exists "Admins can read customers"   on customers;
drop policy if exists "Admins can update customers" on customers;

create policy "Admins can read customers"
  on customers for select
  using (is_admin());

create policy "Admins can update customers"
  on customers for update
  using (is_admin())
  with check (is_admin());

revoke insert, delete on customers from anon, authenticated;


-- ── Auto-upsert customer when an inquiry is created ────────────────────────

create or replace function upsert_customer_from_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  v_key := lower(trim(new.contact));

  insert into customers (contact_key, display_name, contact, organization,
                         first_seen_at, last_seen_at, inquiry_count)
    values (v_key, new.name, new.contact, new.organization,
            new.created_at, new.created_at, 1)
    on conflict (contact_key) do update
      set display_name  = excluded.display_name,
          contact       = excluded.contact,
          organization  = coalesce(excluded.organization, customers.organization),
          last_seen_at  = greatest(customers.last_seen_at, excluded.last_seen_at),
          inquiry_count = customers.inquiry_count + 1;

  return new;
end;
$$;

drop trigger if exists trg_upsert_customer_on_inquiry on inquiries;
create trigger trg_upsert_customer_on_inquiry
  after insert on inquiries
  for each row
  execute function upsert_customer_from_inquiry();


-- ── Backfill customers from existing inquiries (idempotent) ────────────────
-- One-shot replay. Uses lower(trim(contact)) so reruns are no-ops.

with grouped as (
  select
    lower(trim(contact))                       as contact_key,
    (array_agg(name         order by created_at desc))[1]                  as display_name,
    (array_agg(contact      order by created_at desc))[1]                  as contact,
    (array_agg(organization order by created_at desc) filter (where organization is not null))[1] as organization,
    min(created_at)                            as first_seen_at,
    max(created_at)                            as last_seen_at,
    count(*)                                   as inquiry_count
  from inquiries
  group by lower(trim(contact))
)
insert into customers
  (contact_key, display_name, contact, organization, first_seen_at, last_seen_at, inquiry_count)
select contact_key, display_name, contact, organization, first_seen_at, last_seen_at, inquiry_count
from grouped
on conflict (contact_key) do nothing;


-- ── Maintain customers.order_count when an order is created ────────────────

create or replace function bump_customer_order_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update customers
    set order_count  = order_count + 1,
        last_seen_at = greatest(last_seen_at, new.created_at)
    where contact_key = lower(trim(new.buyer_contact));
  return new;
end;
$$;

drop trigger if exists trg_bump_customer_order_count on orders;
create trigger trg_bump_customer_order_count
  after insert on orders
  for each row
  execute function bump_customer_order_count();


-- ── Helper view: customer_with_history ─────────────────────────────────────
-- Convenience read-side join so the Customers admin page doesn't need to
-- run three queries per row.

create or replace view customer_with_history as
select
  c.*,
  (select max(created_at) from inquiries where lower(trim(contact))      = c.contact_key) as last_inquiry_at,
  (select max(created_at) from orders     where lower(trim(buyer_contact)) = c.contact_key) as last_order_at
from customers c;


-- ── 'quoted' status: add to order_status enum ──────────────────────────────
-- Postgres requires this at top level (cannot be in DO block). Wrap in
-- conditional via plpgsql to make migration re-runnable.

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'order_status'::regtype
      and enumlabel = 'quoted'
  ) then
    alter type order_status add value 'quoted' before 'invoice_sent';
  end if;
end $$;


-- ── Wire audit_log into existing state-changing RPCs ───────────────────────
-- Each RPC now records a row to audit_log on success. Behaviour otherwise
-- identical to migration 003 — drop-in replacement.

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
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_initial < 0 then
    raise exception 'Initial stock must be non-negative';
  end if;

  insert into product_stock (sku, on_hand, last_counted)
    values (p_sku, p_initial, now())
    on conflict (sku) do nothing
    returning true into v_inserted;

  if v_inserted then
    insert into stock_movements (sku, delta, reason, admin_id, on_hand_after, notes)
      values (p_sku, p_initial, 'initial_seed', auth.uid(), p_initial,
              'Seeded from catalog');
    perform log_audit(
      'stock.seeded', 'stock', p_sku,
      format('Seeded %s at %s', p_sku, p_initial),
      null, jsonb_build_object('on_hand', p_initial), null
    );
  end if;

  return coalesce(v_inserted, false);
end;
$$;


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
  v_before  integer;
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

  select on_hand into v_before from product_stock where sku = p_sku;

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

  perform log_audit(
    'stock.adjusted', 'stock', p_sku,
    format('%s %s%s by %s (%s)',
      p_sku, case when p_delta >= 0 then '+' else '' end, p_delta,
      p_reason, coalesce(p_notes, '')),
    jsonb_build_object('on_hand', v_before),
    jsonb_build_object('on_hand', v_on_hand, 'reason', p_reason),
    jsonb_build_object('notes', p_notes)
  );

  return v_on_hand;
end;
$$;


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

  perform log_audit(
    'order.created', 'order', v_order_id::text,
    format('Created %s from inquiry %s', v_order_no, v_inq.reference_id),
    null,
    jsonb_build_object(
      'order_number', v_order_no,
      'inquiry_id',   p_inquiry_id,
      'buyer',        v_inq.name,
      'contact',      v_inq.contact
    ),
    null
  );

  return v_order_id;
end;
$$;


create or replace function mark_order_invoiced(
  p_order_id             uuid,
  p_invoice_url          text,
  p_invoice_amount_cents integer,
  p_payment_method       text default 'PayPal Friends & Family or Zelle'
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order_no text;
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
      and status = 'pending_invoice'
    returning order_number into v_order_no;

  if v_order_no is null then
    raise exception 'Order must be pending_invoice to mark invoiced';
  end if;

  perform log_audit(
    'order.invoiced', 'order', p_order_id::text,
    format('Invoice sent for %s ($%s)', v_order_no, (p_invoice_amount_cents/100.0)::numeric(10,2)),
    jsonb_build_object('status', 'pending_invoice'),
    jsonb_build_object(
      'status',       'invoice_sent',
      'invoice_url',  p_invoice_url,
      'amount_cents', p_invoice_amount_cents,
      'payment_method', p_payment_method
    ),
    null
  );
end;
$$;


create or replace function mark_order_paid(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order_no text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update orders
    set status     = 'paid',
        paid_at    = now(),
        updated_at = now()
    where id = p_order_id and status = 'invoice_sent'
    returning order_number into v_order_no;

  if v_order_no is null then
    raise exception 'Order must be invoice_sent to mark paid';
  end if;

  perform log_audit(
    'order.paid', 'order', p_order_id::text,
    format('Payment confirmed for %s', v_order_no),
    jsonb_build_object('status', 'invoice_sent'),
    jsonb_build_object('status', 'paid'),
    null
  );
end;
$$;


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
  v_order_no text;
  v_line     record;
  v_on_hand  integer;
  v_lines_count integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  perform 1 from orders where id = p_order_id and status = 'paid' for update;
  if not found then
    raise exception 'Order must be paid to mark fulfilled';
  end if;

  v_lines_count := 0;
  for v_line in
    select * from order_lines where order_id = p_order_id
  loop
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

    v_lines_count := v_lines_count + 1;
  end loop;

  update orders
    set status          = 'fulfilled',
        tracking_number = coalesce(p_tracking_number, tracking_number),
        fulfilled_at    = now(),
        updated_at      = now()
    where id = p_order_id
    returning order_number into v_order_no;

  perform log_audit(
    'order.fulfilled', 'order', p_order_id::text,
    format('Fulfilled %s (%s line(s); tracking %s)',
      v_order_no, v_lines_count, coalesce(p_tracking_number, '—')),
    jsonb_build_object('status', 'paid'),
    jsonb_build_object(
      'status',          'fulfilled',
      'tracking_number', p_tracking_number,
      'lines_count',     v_lines_count
    ),
    null
  );
end;
$$;


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
  v_admin    uuid;
  v_status   order_status;
  v_order_no text;
  v_line     record;
  v_on_hand  integer;
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

      v_restocked := v_restocked + 1;
    end loop;
  end if;

  update orders
    set status              = 'cancelled',
        cancelled_at        = now(),
        cancellation_reason = p_reason,
        updated_at          = now()
    where id = p_order_id;

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


-- ── customer.notes update RPC (admin-only) ─────────────────────────────────

create or replace function set_customer_notes(
  p_customer_id uuid,
  p_notes       text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select notes into v_before from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;

  update customers
    set notes = p_notes
    where id = p_customer_id;

  perform log_audit(
    'customer.notes_updated', 'customer', p_customer_id::text,
    'Customer notes updated',
    jsonb_build_object('notes', v_before),
    jsonb_build_object('notes', p_notes),
    null
  );
end;
$$;

grant execute on function set_customer_notes(uuid, text) to authenticated;


-- ── customer.status update RPC (admin-only) ────────────────────────────────

create or replace function set_customer_status(
  p_customer_id uuid,
  p_status      text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_status not in ('active', 'inactive', 'blocked') then
    raise exception 'Invalid status %', p_status;
  end if;

  select status into v_before from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;

  update customers
    set status = p_status
    where id = p_customer_id;

  perform log_audit(
    'customer.status_changed', 'customer', p_customer_id::text,
    format('Customer status: %s → %s', v_before, p_status),
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status),
    null
  );
end;
$$;

grant execute on function set_customer_status(uuid, text) to authenticated;
