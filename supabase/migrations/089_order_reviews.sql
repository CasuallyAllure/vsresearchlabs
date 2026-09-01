-- 089_order_reviews.sql
-- ---------------------------------------------------------------------------
-- The completed-order review program: after an order is delivered, the buyer
-- is asked how the ORDER went — shipping speed, packaging, documentation,
-- communication. Approved reviews render publicly as service feedback.
--
-- SCOPE IS DELIBERATE AND LOAD-BEARING. This collects feedback about
-- FULFILMENT, never about what a compound did. Third-party text describing an
-- effect would be an intended-use claim on a research-supply catalog, which is
-- exactly what the FDA audit backlog exists to remove — so nothing here asks
-- for it, the prompt says so, and every review passes an admin before it is
-- visible. The rating is a service rating; the column is named for it.
--
--   • order_reviews          — one row per order (UNIQUE order_id), moderated.
--   • order_review_prompt()  — anon, token-gated: what the form needs to render.
--   • submit_order_review()  — anon, token-gated: insert one pending review.
--   • public_service_reviews() — anon: APPROVED reviews only, no contact data.
--   • admin_review_queue() / admin_moderate_review() — is_admin() moderation.
--   • automation kind 'review_request' (075 engine) — the ask email, seeded OFF.
--
-- AUTHORIZATION for the buyer half is the order's 256-bit lookup_token (019),
-- the same secret the invoice email and /track already carry — a review link
-- needs no account, and knowing an order number is not enough.
--
-- Additive + idempotent. No writes granted to anon anywhere; every anon path
-- is a SECURITY DEFINER function that checks the token itself.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   dropping the five functions and the table, and deleting the
--   automation_settings row.
-- ---------------------------------------------------------------------------

-- ── 1. The table ───────────────────────────────────────────────────────────

create table if not exists order_reviews (
  id            uuid        primary key default gen_random_uuid(),
  -- One review per order. The UNIQUE is the whole anti-spam story for the
  -- buyer half: the token opens exactly one order, the order takes one review.
  order_id      uuid        not null unique references orders(id) on delete cascade,
  user_id       uuid        references auth.users(id) on delete set null,
  buyer_contact text,
  -- SERVICE rating. 1–5, about fulfilment — see the header.
  service_rating integer    not null check (service_rating between 1 and 5),
  comment       text        check (comment is null or length(comment) <= 1000),
  -- What the public sees instead of a full name: "Ada R." Computed at submit
  -- from the order's buyer_name; never the email, never the organization.
  display_name  text        not null,
  status        text        not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  moderated_by  uuid        references auth.users(id) on delete set null,
  moderated_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists order_reviews_status_idx on order_reviews (status, created_at desc);

alter table order_reviews enable row level security;
drop policy if exists "Admins read order reviews" on order_reviews;
create policy "Admins read order reviews" on order_reviews for select using (is_admin());
revoke all on order_reviews from anon, authenticated;
grant select on order_reviews to authenticated;  -- RLS narrows this to admins
-- Every write goes through the SECURITY DEFINER verbs below. No write policy
-- exists and the grants above exclude them.

-- ── 2. Eligibility, in one place ───────────────────────────────────────────
--
-- "Completed" = fulfilled AND settled long enough ago that the buyer has the
-- parcel in hand: 3 days past a recorded delivery, or 10 days past shipment
-- when delivery was never marked (the common case when tracking is not
-- reconciled). Both the ask email and the form gate on THIS function, so the
-- link in the email can never open a form the order is not eligible for.

create or replace function order_review_eligible(p_order orders)
returns boolean
language sql
stable
as $$
  select p_order.status = 'fulfilled'
     and (
       (p_order.delivered_at is not null and p_order.delivered_at <= now() - interval '3 days')
       or (p_order.delivered_at is null and p_order.shipped_at is not null
           and p_order.shipped_at <= now() - interval '10 days')
     );
$$;

-- Helpers are called only from the SECURITY DEFINER verbs below (which execute
-- as the owner), so they need no grants of their own — and PostgreSQL's
-- built-in EXECUTE-to-PUBLIC default must be stripped or the 079 hardening
-- suite fails them by name.
revoke execute on function order_review_eligible(orders) from public, anon, authenticated;

-- ── 3. Buyer half — token-gated, anon ──────────────────────────────────────

/** "Ada Reyes" → "Ada R." — first name, last initial. */
create or replace function review_display_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_name), '') = '' then 'A customer'
    when position(' ' in btrim(p_name)) = 0 then btrim(p_name)
    else split_part(btrim(p_name), ' ', 1) || ' ' ||
         upper(substr(split_part(btrim(p_name), ' ', 2), 1, 1)) || '.'
  end;
$$;

revoke execute on function review_display_name(text) from public, anon, authenticated;

create or replace function order_review_prompt(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
begin
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into o from orders where lookup_token = btrim(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not order_review_eligible(o) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if exists (select 1 from order_reviews r where r.order_id = o.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed',
                              'orderNumber', o.order_number);
  end if;

  return jsonb_build_object(
    'ok', true,
    'orderNumber', o.order_number,
    'name', review_display_name(o.buyer_name)
  );
end;
$$;

create or replace function submit_order_review(
  p_token   text,
  p_rating  integer,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o         orders%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_rating');
  end if;
  if v_comment is not null and length(v_comment) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'comment_too_long');
  end if;
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into o from orders where lookup_token = btrim(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not order_review_eligible(o) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  insert into order_reviews (order_id, user_id, buyer_contact, service_rating, comment, display_name)
  values (o.id, o.user_id, lower(btrim(o.buyer_contact)), p_rating, v_comment,
          review_display_name(o.buyer_name))
  on conflict (order_id) do nothing;

  if not found then
    -- The order already carries a review; say so rather than silently
    -- pretending this one landed.
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke execute on function order_review_prompt(text) from public;
revoke execute on function submit_order_review(text, integer, text) from public;
-- (both are re-granted to anon+authenticated below: the buyer has no account,
--  and the order's 256-bit token is the authorization — same posture as the
--  019 order-lookup RPCs.)
grant  execute on function order_review_prompt(text) to anon, authenticated;
grant  execute on function submit_order_review(text, integer, text) to anon, authenticated;

-- ── 4. Public read — approved only, no contact data ────────────────────────

create or replace function public_service_reviews(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(p.row_json order by p.created_at desc)
        from (
          select jsonb_build_object(
                   'rating',  r.service_rating,
                   'comment', r.comment,
                   'name',    r.display_name,
                   'iso',     to_char(r.created_at, 'YYYY-MM-DD')
                 ) as row_json,
                 r.created_at
            from order_reviews r
           where r.status = 'approved'
           order by r.created_at desc
           limit v_limit
        ) p
    ), '[]'::jsonb),
    'total',   (select count(*) from order_reviews where status = 'approved'),
    'average', (select round(avg(service_rating)::numeric, 2) from order_reviews where status = 'approved')
  );
end;
$$;

revoke execute on function public_service_reviews(integer) from public;
grant  execute on function public_service_reviews(integer) to anon, authenticated;

-- ── 5. Admin moderation ────────────────────────────────────────────────────

create or replace function admin_review_queue(
  p_status text    default 'pending',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_status text    := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with filtered as (
    select r.*, o.order_number
      from order_reviews r
      join orders o on o.id = r.order_id
     where v_status = 'all' or r.status = v_status
  ),
  page as (
    select * from filtered order by created_at desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',          p.id,
        'orderId',     p.order_id,
        'orderNumber', p.order_number,
        'contact',     p.buyer_contact,
        'name',        p.display_name,
        'rating',      p.service_rating,
        'comment',     p.comment,
        'status',      p.status,
        'createdIso',  to_char(p.created_at, 'YYYY-MM-DD')
      ) order by p.created_at desc)
      from page p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'pending',  (select count(*) from order_reviews where status = 'pending'),
      'approved', (select count(*) from order_reviews where status = 'approved'),
      'rejected', (select count(*) from order_reviews where status = 'rejected'),
      'average',  (select round(avg(service_rating)::numeric, 2) from order_reviews where status = 'approved')
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function admin_moderate_review(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before text;
  r        order_reviews%rowtype;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid review status: %', coalesce(p_status, '(null)');
  end if;

  select status into v_before from order_reviews where id = p_id;
  if v_before is null then
    raise exception 'Review not found';
  end if;

  update order_reviews
     set status = p_status, moderated_by = auth.uid(), moderated_at = now()
   where id = p_id
  returning * into r;

  perform log_audit(
    'review.' || p_status, 'order', r.order_id::text,
    format('Review %s (%s stars)', p_status, r.service_rating),
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status),
    null
  );

  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status);
end;
$$;

revoke execute on function admin_review_queue(text, integer, integer) from public, anon;
revoke execute on function admin_moderate_review(uuid, text)          from public, anon;
grant  execute on function admin_review_queue(text, integer, integer) to authenticated;
grant  execute on function admin_moderate_review(uuid, text)          to authenticated;

-- ── 6. The ask email — a new kind in the 075 automation engine ─────────────

insert into automation_settings (kind) values ('review_request')
on conflict (kind) do nothing;
