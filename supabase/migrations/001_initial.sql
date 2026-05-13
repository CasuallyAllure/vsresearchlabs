-- Products (managed manually or via Supabase dashboard)
create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price_cents integer not null,
  category    text,
  images      text[],
  aliexpress_url text,
  in_stock    boolean default true,
  created_at  timestamptz default now()
);

-- Orders
create table orders (
  id              uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  customer_email  text not null,
  customer_name   text,
  shipping_address jsonb,
  status          text default 'pending',
  total_cents     integer,
  created_at      timestamptz default now()
);

-- Order items
create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders(id),
  product_id uuid references products(id),
  quantity   integer not null,
  price_cents integer not null
);

-- Enable RLS
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- Products are publicly readable (but aliexpress_url filtered at app level)
create policy "Products are viewable by everyone"
  on products for select
  using (true);

-- Orders and order_items are only accessible via service role (Edge Functions)
create policy "Orders are managed by service role"
  on orders for all
  using (false);

create policy "Order items are managed by service role"
  on order_items for all
  using (false);
