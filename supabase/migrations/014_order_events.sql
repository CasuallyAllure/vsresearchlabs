-- 014_order_events.sql
-- Append-only timeline of order lifecycle events: stage advances, reverts,
-- and free-form admin notes. Powers the order status bar's notes log and the
-- printable status history on the invoice. Existing status RPCs are unchanged;
-- the admin client appends an event after each successful transition (a later
-- backend pass can move this into triggers).

create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  stage      text,                              -- pipeline stage this note attaches to
  kind       text not null default 'note',      -- 'note' | 'advance' | 'revert' | 'system'
  note       text,
  actor      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_id_idx
  on order_events(order_id, created_at);

alter table order_events enable row level security;

create policy "Admins can read order_events"
  on order_events for select
  using (is_admin());

create policy "Admins can insert order_events"
  on order_events for insert
  with check (is_admin());
