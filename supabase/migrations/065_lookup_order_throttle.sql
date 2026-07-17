-- 065_lookup_order_throttle.sql
-- ---------------------------------------------------------------------------
-- Anon lookup_order rate limit — closes the order-number enumeration surface
-- (pro review 2026-07-17 §5.2, carried from the B review §6.4; "062" was
-- reserved for this but never written, and prod is already at 064).
--
-- The order-number space is enumerable (VSR-ORD-YYMMDD-NNN, ~1000/day) and
-- lookup_order is granted to anon (012:223, redefined 016 → 021). The RPC is
-- deliberately status/tracking-only (022 dropped the financial shape), so the
-- exposure is metadata — but an unthrottled anon endpoint over an enumerable
-- keyspace is still a scraping oracle. This migration adds a per-caller
-- throttle INSIDE the function, keyed on the caller's IP as PostgREST hands
-- it to the DB (request.headers → x-forwarded-for, first hop):
--
--   • lookup_order_attempts — one row per caller bucket, counter + window
--     start, reused in place (upsert). Service-definer-only: RLS enabled with
--     no policies, all table grants revoked from client roles.
--   • lookup_order — same signature/shape as 021 (status mapping unchanged),
--     now plpgsql: bump the caller's counter first, raise a clean
--     user-facing error above LOOKUP_LIMIT attempts per LOOKUP_WINDOW
--     (30 per 10 minutes — generous for a buyer refreshing their status,
--     hostile to enumeration at ~4,300 probes/day/IP).
--   • A raised error rolls the increment back with the transaction, so the
--     counter parks at the limit while the window lasts — every over-limit
--     call still computes limit+1 and raises. Missing header buckets to
--     'unknown' and still throttles (shared bucket beats no throttle).
--   • ~1% of successful calls opportunistically purge buckets idle > 1 day,
--     so the table stays bounded without a scheduler.
--
-- Requires 021 (current lookup_order shape). Additive + idempotent.
--
-- Rollback: re-run 021's create or replace function lookup_order (restores
-- the throttle-free sql function); optionally drop table
-- lookup_order_attempts.
-- ---------------------------------------------------------------------------

create table if not exists lookup_order_attempts (
  bucket       text        primary key,
  window_start timestamptz not null default now(),
  attempts     integer     not null default 0
);

alter table lookup_order_attempts enable row level security;
-- No policies on purpose: only the SECURITY DEFINER function below (owner
-- bypasses RLS) may read or write it.
revoke all on table lookup_order_attempts from public, anon, authenticated;

create or replace function lookup_order(p_identifier text, p_zip text)
returns table (
  order_number    text,
  status          text,
  carrier         text,
  tracking_number text,
  placed_at       timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_limit  constant integer  := 30;
  lookup_window constant interval := interval '10 minutes';
  v_bucket   text;
  v_attempts integer;
begin
  -- Caller bucket: first hop of x-forwarded-for as PostgREST exposes it.
  -- NULL (direct SQL, tests) buckets to 'unknown' — still throttled.
  v_bucket := coalesce(
    nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      ',', 1)), ''),
    'unknown');

  insert into lookup_order_attempts as la (bucket, window_start, attempts)
  values (v_bucket, now(), 1)
  on conflict (bucket) do update
     set attempts = case
           when la.window_start < now() - lookup_window then 1
           else la.attempts + 1
         end,
         window_start = case
           when la.window_start < now() - lookup_window then now()
           else la.window_start
         end
  returning la.attempts into v_attempts;

  if v_attempts > lookup_limit then
    -- Surfaced verbatim by the /track UI (TrackOrder.tsx renders
    -- error.message) — keep it clean and user-facing.
    raise exception 'Too many lookup attempts. Please wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;

  -- Opportunistic purge so the bucket table stays bounded without a
  -- scheduler; ~1% of successful calls, buckets idle for a day.
  if random() < 0.01 then
    delete from lookup_order_attempts
     where lookup_order_attempts.window_start < now() - interval '1 day';
  end if;

  -- Status read — byte-for-byte the 021 shape (public status mapping,
  -- tracking only after ship, one newest order).
  return query
  select
    o.order_number,
    case
      when o.status = 'cancelled'        then 'cancelled'
      when o.delivered_at is not null     then 'delivered'
      when o.tracking_number is not null
        or o.shipped_at is not null
        or o.status = 'fulfilled'         then 'shipped'
      when o.status = 'paid'              then 'processing'
      when o.status = 'payment_claimed'   then 'payment_verifying'
      when o.status = 'invoice_sent'      then 'awaiting_payment'
      else 'received'
    end as status,
    case when o.shipped_at is not null then o.carrier        end as carrier,
    case when o.shipped_at is not null then o.tracking_number end as tracking_number,
    o.created_at  as placed_at,
    o.shipped_at,
    o.delivered_at
  from orders o
  join inquiries i on i.id = o.inquiry_id
  where
    (
      lower(o.order_number) = lower(btrim(p_identifier))
      or lower(i.contact)   = lower(btrim(p_identifier))
    )
    and o.ship_zip is not null
    and replace(o.ship_zip, ' ', '') = replace(btrim(p_zip), ' ', '')
  order by o.created_at desc
  limit 1;
end;
$$;

grant execute on function lookup_order(text, text) to anon, authenticated;
