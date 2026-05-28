-- =============================================================================
-- VS Research Labs — Initial Schema (Inquiry-Only)
-- =============================================================================
-- This file is the canonical Phase-1 schema. Stripe / orders / order_items
-- have been removed; the storefront is inquiry-only and emails go through
-- the `send-inquiry` Edge Function (Resend).
--
-- Supplier confidentiality
-- ------------------------
-- The supplier source (`aliexpress_url`) lives in a SEPARATE table that is
-- never exposed to anon. The PostgREST API for `anon` cannot reach it.
-- =============================================================================

-- Public product catalog (safe to expose to anon)
create table products (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique,
  sku               text unique,
  name              text not null,
  short_description text,
  long_description  text,
  category          text,
  images            text[],
  specs             jsonb,
  tags              text[],
  price_cents       integer,
  stock             integer,
  featured          boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Supplier source — service-role only. Never granted to anon/authenticated.
create table product_supplier_links (
  product_id     uuid primary key references products(id) on delete cascade,
  aliexpress_url text not null,
  notes          text,
  updated_at     timestamptz default now()
);

-- Enable RLS
alter table products enable row level security;
alter table product_supplier_links enable row level security;

-- Public catalog is readable by everyone (anon included).
create policy "Products are viewable by everyone"
  on products for select
  using (true);

-- Supplier links: deny all by default. Service role bypasses RLS, so Edge
-- Functions / admin tooling using SUPABASE_SERVICE_ROLE_KEY still work.
create policy "Supplier links are service-role only"
  on product_supplier_links for all
  using (false);

-- Belt-and-suspenders: explicitly revoke API access so `anon` cannot even
-- attempt to query the table via PostgREST.
revoke all on product_supplier_links from anon, authenticated;
