-- 066_lookup_order_throttle_backstop.sql
-- ---------------------------------------------------------------------------
-- Close the 065 throttle bypass (a-path review 2026-07-17 finding #1, HIGH).
--
-- 065 keyed the rate bucket on the FIRST x-forwarded-for hop — which is the
-- client-asserted value (proxies APPEND; anything the client sends comes
-- first). Live-proven bypass: rotate the header, get a fresh bucket every
-- request. Only honest browsers were throttled.
--
-- Fix = defense in depth, no trust in any client-controlled key:
--   • per-caller bucket (first XFF hop, 30/10min) STAYS — it is the fast
--     cutoff for honest clients and costs nothing.
--   • NEW global backstop bucket ('__global__', 120/10min): caps TOTAL
--     lookup throughput no matter how headers rotate. An enumeration
--     campaign is bounded at ~17k probes/day across ALL sources; organic
--     /track traffic is a handful of lookups per hour and never sees it.
--     Deliberately exhausting it only degrades the status-lookup page
--     (buyers still have their token-gated invoice links) — an acceptable
--     availability trade for closing the oracle.
--   • NEW per-identifier bucket ('id:'||identifier, 15/10min): caps ZIP
--     brute force against one known order number regardless of source IP.
--
-- Same table, same raise/rollback semantics as 065 (an over-limit raise
-- rolls its own increments back; buckets park at the limit while hot).
--
-- Requires 065. Additive + idempotent.
--
-- Rollback: re-run 065's create or replace function lookup_order.
-- ---------------------------------------------------------------------------

-- Shared upsert: bump a bucket's counter within the window, return the new
-- count. Definer-only helper — never granted to clients.
create or replace function lookup_order_bump(p_bucket text, p_window interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  insert into lookup_order_attempts as la (bucket, window_start, attempts)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
     set attempts = case
           when la.window_start < now() - p_window then 1
           else la.attempts + 1
         end,
         window_start = case
           when la.window_start < now() - p_window then now()
           else la.window_start
         end
  returning la.attempts into v_attempts;
  return v_attempts;
end;
$$;

revoke execute on function lookup_order_bump(text, interval) from public, anon, authenticated;

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
  caller_limit     constant integer  := 30;
  global_limit     constant integer  := 120;
  identifier_limit constant integer  := 15;
  lookup_window    constant interval := interval '10 minutes';
  throttle_msg     constant text     :=
    'Too many lookup attempts. Please wait a few minutes and try again.';
  v_bucket   text;
  v_attempts integer;
begin
  -- 1) Global backstop FIRST — not keyed on anything the client controls.
  v_attempts := lookup_order_bump('__global__', lookup_window);
  if v_attempts > global_limit then
    raise exception '%', throttle_msg using errcode = 'P0001';
  end if;

  -- 2) Per-caller bucket: first x-forwarded-for hop. Client-spoofable, so
  -- it is only the HONEST-client fast cutoff; the backstops above/below do
  -- the adversarial work. NULL/empty buckets to 'unknown'.
  v_bucket := coalesce(
    nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      ',', 1)), ''),
    'unknown');
  v_attempts := lookup_order_bump(v_bucket, lookup_window);
  if v_attempts > caller_limit then
    raise exception '%', throttle_msg using errcode = 'P0001';
  end if;

  -- 3) Per-identifier bucket — caps ZIP brute force on one order number.
  v_attempts := lookup_order_bump('id:' || lower(btrim(coalesce(p_identifier, ''))), lookup_window);
  if v_attempts > identifier_limit then
    raise exception '%', throttle_msg using errcode = 'P0001';
  end if;

  -- Opportunistic purge (unchanged from 065).
  if random() < 0.01 then
    delete from lookup_order_attempts
     where lookup_order_attempts.window_start < now() - interval '1 day';
  end if;

  -- Status read — byte-for-byte the 021 shape.
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
