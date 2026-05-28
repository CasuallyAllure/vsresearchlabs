-- =============================================================================
-- VS Research Labs — Inquiries (S1: Inquiry Persistence)
-- =============================================================================
-- Converts the inquiry pipeline from email-only to persistent institutional
-- intake records. Every submitted inquiry is now stored before email delivery.
--
-- Reference format: VSR-REQ-YYMMDD-NNN (generated server-side in Edge Function)
--
-- Security model:
--   - Service role key (Edge Function) bypasses RLS — used for all writes.
--   - Authenticated users (future admin) can read.
--   - Anon cannot read or write (RLS default deny-all).
-- =============================================================================

-- Inquiries — one row per submitted inquiry.
create table inquiries (
  id               uuid        primary key default gen_random_uuid(),
  reference_id     text        unique not null,
  created_at       timestamptz not null default now(),
  name             text        not null,
  contact          text        not null,
  organization     text,
  notes            text,
  status           text        not null default 'OPEN'
                               check (status in ('OPEN', 'REVIEWING', 'RESPONDED', 'CLOSED')),
  intake_channel   text        not null default 'VSR-WEB-PORTAL',
  processing_node  text        not null default 'VSR-HQ-INTAKE',
  item_count       integer     not null check (item_count > 0)
);

-- Inquiry line items — product data snapshot at submission time.
-- Intentionally not foreign-keyed to the products table: the inquiry record
-- must remain accurate even if a product is renamed, repriced, or removed.
create table inquiry_items (
  id           uuid    primary key default gen_random_uuid(),
  inquiry_id   uuid    not null references inquiries(id) on delete cascade,
  sku          text    not null,
  product_name text    not null,
  quantity     integer not null check (quantity > 0 and quantity <= 999),
  category     text,
  item_note    text
);

-- Indexes
create index inquiries_reference_id_idx   on inquiries     (reference_id);
create index inquiries_created_at_idx     on inquiries     (created_at desc);
create index inquiries_status_idx         on inquiries     (status);
create index inquiry_items_inquiry_id_idx on inquiry_items (inquiry_id);

-- RLS
alter table inquiries      enable row level security;
alter table inquiry_items  enable row level security;

-- Authenticated admin can read. Service role (Edge Functions) bypasses RLS
-- implicitly — no explicit write policy needed. Default with RLS = deny-all.
create policy "Inquiries readable by admin"
  on inquiries for select
  using (auth.role() = 'authenticated');

create policy "Inquiry items readable by admin"
  on inquiry_items for select
  using (auth.role() = 'authenticated');
