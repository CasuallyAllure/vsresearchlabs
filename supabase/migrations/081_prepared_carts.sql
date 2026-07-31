-- =============================================================================
-- 081_prepared_carts.sql — the prepared-cart data layer
-- =============================================================================
-- WHAT THIS IS
-- ------------
-- The owner opens /admin/members, expands a member's row, picks compounds and
-- doses, optionally attaches a coupon code, and sends. This migration owns
-- everything up to and including persisting that cart and minting its link
-- token. The e-mail and the member-facing claim page are a separate workstream
-- (see "SEAM" below).
--
-- PRIME DIRECTIVE: a prepared cart is a SHOPPING LIST, NOT A QUOTE.
-- It carries (sku, dose, quantity) and nothing else. Every price, discount,
-- coupon and reward resolves at open/checkout time through the paths that
-- already exist. There is no second checkout, no second price, no second store.
--
-- WHY NO MONEY IS STORED (this is forced, not stylistic)
-- ------------------------------------------------------
-- place-order's `verifyLinePrices` rejects the ENTIRE order (HTTP 409) when a
-- line's unitPriceCents is not byte-identical to the live catalog price —
-- supabase/functions/place-order/handler.ts and place-order/priceCheck.ts state
-- the policy as "FAIL CLOSED … to the cent, no tolerance". A baked-in
-- negotiated price would therefore not produce a discount; it would produce an
-- order the member CANNOT PLACE. So:
--
--   • prepared_cart_lines has no price column, and admin_create_prepared_cart
--     REJECTS any line object carrying a price-shaped key. Both halves matter:
--     the schema makes it impossible to store, the guard makes it impossible to
--     send by mistake from a client that was changed later.
--   • A bespoke price travels as a COUPON CODE (prepared_carts.coupon_code) —
--     the only client-supplied discount channel place-order accepts, and it is
--     re-resolved server-side by validate_coupon (031). Never a percent, never
--     an amount.
--   • The member's STANDING account discount needs nothing stored here at all:
--     effective_customer_discount(user_id) (045/069/074) is keyed solely on the
--     user id and applies automatically at checkout.
--
-- WHY THE TOKEN IS HASHED
-- -----------------------
-- The link token is a credential delivered to an inbox. It is minted inside
-- admin_create_prepared_cart, returned to the admin ONCE, and only its SHA-256
-- digest is persisted. A dump of prepared_carts — or any future read path that
-- forgets to exclude a column — cannot be replayed into a working link.
--
-- Token shape follows the one pattern this repo has (019_order_lookup_token):
-- two concatenated gen_random_uuid()s with the dashes stripped, ~244 bits of
-- entropy. Hashing uses pg_catalog.sha256(bytea), a PostgreSQL 11+ BUILT-IN —
-- deliberately not pgcrypto's digest(), which lives in the `extensions` schema
-- and would make this migration depend on an extension placement the repo does
-- not otherwise rely on.
--
-- GRANT POSTURE — revoke BEFORE grant, and then grant NOTHING
-- -----------------------------------------------------------
-- This schema carries a bootstrap `ALTER DEFAULT PRIVILEGES … grant all on
-- tables to anon, authenticated, service_role` (see .github/workflows/ci.yml's
-- hosted-parity block). A bare `create table` is therefore born FULLY WRITABLE
-- BY ANON, and a later `grant select` is a no-op on top of that. This was a
-- live, empirically-proven production vulnerability repaired last week —
-- 078_view_grant_hardening.sql:4-41 is the write-up; 078:75-76 is the canonical
-- fixed form. 078 closed the source prospectively for WRITE privileges, but
-- SELECT is deliberately still in the ambient defaults (revoking it would take
-- the public catalog dark), so a new table is still born anon-READABLE.
--
-- Both tables below therefore `revoke all from anon, authenticated` and grant
-- NOTHING back. There is no PostgREST-reachable read path to either table for
-- any browser role. Every access goes through the SECURITY DEFINER RPCs, which
-- is what lets admin_prepared_carts structurally omit token_hash. RLS is
-- enabled with admin-only policies as a second, independent fence: if a future
-- migration re-grants SELECT by accident, the policy still returns zero rows.
--
-- Same bug class applies to FUNCTIONS through a separate ACL channel, plus
-- PostgreSQL's own built-in `EXECUTE TO PUBLIC` default — 079 found 70 of 80
-- public routines anon- or authenticated-callable. Each function below is
-- explicitly revoked from public, anon, authenticated before being granted to
-- the narrowest role. The prospective ALTER DEFAULT PRIVILEGES revoke is a
-- documented no-op (079:88-105); THE REAL GUARD IS THE TEST. All three
-- routines are registered in tests/integration/functionGrantHardening.test.ts's
-- AUTHENTICATED_ONLY allowlist — none of them may ever appear in ANON_CALLABLE.
--
-- SEAM FOR THE EMAIL / CLAIM WORKSTREAM
-- --------------------------------------
-- This migration deliberately does NOT define `claim_prepared_cart`. That RPC
-- belongs to the claim workstream, and the shape it must implement is fixed by
-- what is stored here:
--
--   • Look the cart up by encode(sha256(p_token::bytea), 'hex') — never by a
--     plaintext column, which does not exist.
--   • Bind to the owner: `and user_id = auth.uid()`. The token alone must NOT
--     be sufficient. This is a deliberate departure from /track's bearer token
--     (041) — that token rides in a URL delivered to an inbox and across a
--     sign-in, so possession must not equal authorization.
--   • Gate on `revoked_at is null and expires_at > now()`, and treat
--     claimed_at as a "has been loaded at least once" stamp — the link stays
--     REUSABLE until claimed/expired/revoked is decided otherwise (a member who
--     opens the mail on a phone and finishes on a laptop must not be stranded).
--   • Return every failure with the SAME {ok:false, reason} shape so nothing
--     distinguishes "wrong token" from "wrong user" from "expired" (the 041
--     convention — no error-shape oracle).
--   • Reconstruct each line with variantProduct(product, dose) on the client.
--     prepared_cart_lines stores `dose` NOT NULL (empty string for
--     single-config items) precisely so the claim path can never lose it: a
--     bare add() drops the dose and produced $0 order lines in production
--     (src/lib/cartActions.ts:1-24 is the incident write-up).
--     src/lib/preparedCart.ts::planPreparedCart is the pure mapper for this.
--
-- Additive, idempotent and re-runnable. No data touched. Forward-fix only.
-- =============================================================================


-- ── 1. prepared_carts — one row per cart the admin built and sent ───────────
-- token_hash: SHA-256 hex of the plaintext link token. The plaintext is
--   returned by admin_create_prepared_cart exactly once and never persisted.
-- coupon_code: an OPTIONAL one-off price for THIS cart, stored as a code only.
--   Re-resolved server-side by validate_coupon at checkout. Never a number.
-- expires_at: 14 days by default (owner default of record). Column default, so
--   changing it is a one-line migration.
-- claimed_at: first successful claim. Set by the claim workstream, not here.
-- revoked_at: admin kill-switch, set by admin_revoke_prepared_cart.

create table if not exists prepared_carts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token_hash  text        not null,
  coupon_code text,
  note        text,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  claimed_at  timestamptz,
  revoked_at  timestamptz
);

create unique index if not exists prepared_carts_token_hash_key on prepared_carts (token_hash);
create index if not exists prepared_carts_user_idx on prepared_carts (user_id, created_at desc);

comment on column prepared_carts.token_hash is
  'SHA-256 hex digest of the link token. The plaintext is returned by admin_create_prepared_cart once and never stored — a table dump cannot be replayed into a working link.';
comment on column prepared_carts.coupon_code is
  'Optional one-off price for this cart, as a CODE only (re-resolved by validate_coupon at checkout). Never a percent or an amount — place-order fails closed on any client-supplied price. The member''s standing account discount is automatic and is not represented here.';


-- ── 2. prepared_cart_lines — (sku, dose, quantity) and nothing else ─────────
-- dose is NOT NULL with '' meaning "single-config product" — the same contract
-- variantProduct() honours by passing the product through unchanged. Making it
-- nullable would invite the null-dose → $0-line trap back in.
-- The (cart_id, sku, dose) unique constraint stops a duplicated line from
-- silently doubling a quantity on claim.

create table if not exists prepared_cart_lines (
  id       uuid    primary key default gen_random_uuid(),
  cart_id  uuid    not null references prepared_carts(id) on delete cascade,
  sku      text    not null check (btrim(sku) <> ''),
  dose     text    not null default '',
  quantity integer not null check (quantity > 0 and quantity <= 9999),
  position integer not null default 0
);

create unique index if not exists prepared_cart_lines_unique on prepared_cart_lines (cart_id, sku, dose);
create index if not exists prepared_cart_lines_cart_idx on prepared_cart_lines (cart_id, position);

comment on table prepared_cart_lines is
  'A prepared cart is a shopping list, not a quote: (sku, dose, quantity) only. NO price column, by design — place-order rejects the whole order (409) when a line price is not byte-identical to the live catalog, so a stored price makes the order unplaceable, not discounted.';


-- ── 3. RLS + grants — revoke FIRST, then grant nothing ─────────────────────
-- Order matters: the ambient ALTER DEFAULT PRIVILEGES already handed these
-- brand-new tables to anon/authenticated at CREATE time. See the header.

alter table prepared_carts      enable row level security;
alter table prepared_cart_lines enable row level security;

revoke all on prepared_carts      from anon, authenticated;
revoke all on prepared_cart_lines from anon, authenticated;

-- No grant follows. Every read and write goes through the definer RPCs below,
-- which is what keeps token_hash off every client-reachable surface. The
-- policies are the independent second fence described in the header.

drop policy if exists "Admins read prepared carts" on prepared_carts;
create policy "Admins read prepared carts"
  on prepared_carts for select
  using (is_admin());

drop policy if exists "Admins read prepared cart lines" on prepared_cart_lines;
create policy "Admins read prepared cart lines"
  on prepared_cart_lines for select
  using (is_admin());


-- ── 4. admin_create_prepared_cart — the one write verb, token returned once ─
-- p_lines: jsonb array of {sku, dose, quantity}. Validated element by element;
-- ANY price-shaped key anywhere in a line is a hard error (see header).
--
-- Returns {cart_id, token, expires_at}. `token` is the ONLY time the plaintext
-- exists outside the caller's response — there is no way to read it back.

create or replace function admin_create_prepared_cart(
  p_user_id     uuid,
  p_lines       jsonb,
  p_coupon_code text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_token   text;
  v_cart_id uuid;
  v_expires timestamptz;
  v_coupon  text;
  v_note    text;
  v_line    jsonb;
  v_sku     text;
  v_dose    text;
  v_qty     integer;
  v_index   integer := 0;
  v_count   integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_user_id is null then
    raise exception 'A prepared cart needs a member';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A prepared cart needs at least one line';
  end if;

  v_coupon := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_note   := nullif(btrim(coalesce(p_note, '')), '');

  -- Two concatenated UUIDv4s with the dashes stripped (019_order_lookup_token's
  -- pattern) — ~244 bits. The plaintext lives only in this local variable and
  -- the return value; only its digest is ever written.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into prepared_carts (user_id, token_hash, coupon_code, note, created_by)
  values (p_user_id, encode(sha256(v_token::bytea), 'hex'), v_coupon, v_note, auth.uid())
  returning id, expires_at into v_cart_id, v_expires;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Prepared cart line % is not an object', v_index;
    end if;

    -- A prepared cart stores NO money. A client that starts sending a price is
    -- refused loudly here rather than writing an order the member cannot place.
    if v_line ?| array['price', 'price_cents', 'priceCents', 'unit_price_cents', 'unitPriceCents', 'amount_cents'] then
      raise exception 'Prepared cart lines must not carry a price — attach a coupon code instead';
    end if;

    v_sku  := btrim(coalesce(v_line->>'sku', ''));
    v_dose := btrim(coalesce(v_line->>'dose', ''));

    if v_sku = '' then
      raise exception 'Prepared cart line % is missing a sku', v_index;
    end if;

    begin
      v_qty := (v_line->>'quantity')::integer;
    exception when others then
      raise exception 'Prepared cart line % has a non-numeric quantity', v_index;
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Prepared cart line % needs a quantity above zero', v_index;
    end if;

    -- Same (sku, dose) twice in one payload sums instead of erroring: the admin
    -- adding a row twice means "more of that", never "two cart lines".
    insert into prepared_cart_lines (cart_id, sku, dose, quantity, position)
    values (v_cart_id, v_sku, v_dose, v_qty, v_index)
    on conflict (cart_id, sku, dose)
      do update set quantity = least(prepared_cart_lines.quantity + excluded.quantity, 9999);

    v_index := v_index + 1;
  end loop;

  select count(*) into v_count from prepared_cart_lines where cart_id = v_cart_id;

  perform log_audit(
    'member.prepared_cart.created',
    'customer',
    p_user_id::text,
    format('Prepared cart with %s line(s)%s', v_count,
           case when v_coupon is null then '' else ' · coupon ' || v_coupon end),
    null,
    jsonb_build_object(
      'cart_id',     v_cart_id,
      'lines',       v_count,
      'coupon_code', v_coupon,
      'expires_at',  v_expires
    ),
    null
  );

  -- token: first and last sight of the plaintext.
  return jsonb_build_object('cart_id', v_cart_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;


-- ── 5. admin_revoke_prepared_cart — the kill switch ────────────────────────
-- Returns {ok:false, reason} rather than raising for a miss, so a double-tap or
-- a stale id is a calm no-op in the admin UI. A non-admin still gets a raise:
-- "already revoked" and "you may not do this" must not look alike.

create or replace function admin_revoke_prepared_cart(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update prepared_carts
     set revoked_at = now()
   where id = p_id
     and revoked_at is null
  returning user_id into v_user_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_already_revoked');
  end if;

  perform log_audit(
    'member.prepared_cart.revoked',
    'customer',
    v_user_id::text,
    'Prepared cart revoked',
    null,
    jsonb_build_object('cart_id', p_id),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;


-- ── 6. admin_prepared_carts — the admin read surface, token_hash EXCLUDED ───
-- The only read path that exists. Its column list is the guarantee that
-- token_hash never reaches a client: the tables carry no grants at all, so
-- there is no PostgREST endpoint to select it from either.
--
-- `status` is derived here rather than in the UI so the panel and any future
-- consumer agree on what "live" means.

create or replace function admin_prepared_carts(
  p_user_id uuid,
  p_limit   integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows  jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
             'id',          pc.id,
             'created_at',  pc.created_at,
             'expires_at',  pc.expires_at,
             'claimed_at',  pc.claimed_at,
             'revoked_at',  pc.revoked_at,
             'coupon_code', pc.coupon_code,
             'note',        pc.note,
             'status',      case
                              when pc.revoked_at is not null   then 'revoked'
                              when pc.expires_at <= now()      then 'expired'
                              when pc.claimed_at is not null   then 'claimed'
                              else 'live'
                            end,
             'lines',       (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'sku', l.sku, 'dose', l.dose, 'quantity', l.quantity
                      ) order by l.position, l.sku), '[]'::jsonb)
                 from prepared_cart_lines l
                where l.cart_id = pc.id
             )
           ) as r
      from prepared_carts pc
     where pc.user_id = p_user_id
     order by pc.created_at desc
     limit v_limit
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;


-- ── 7. Function EXECUTE grants — revoke from all three roles, then narrow ───
-- Mandatory and separate from the table channel: PostgreSQL's built-in default
-- for a new function is EXECUTE TO PUBLIC, and the bootstrap adds `alter
-- default privileges … grant all on functions to anon, authenticated,
-- service_role` on top. `authenticated` is as narrow as an ACL can express for
-- an admin RPC; the `if not is_admin() then raise` body guard is the real
-- fence, and both are asserted by the integration suite.
--
-- NONE of these may ever be added to ANON_CALLABLE in
-- tests/integration/functionGrantHardening.test.ts.

revoke execute on function admin_create_prepared_cart(uuid, jsonb, text, text) from public, anon, authenticated;
grant  execute on function admin_create_prepared_cart(uuid, jsonb, text, text) to authenticated;

revoke execute on function admin_revoke_prepared_cart(uuid) from public, anon, authenticated;
grant  execute on function admin_revoke_prepared_cart(uuid) to authenticated;

revoke execute on function admin_prepared_carts(uuid, integer) from public, anon, authenticated;
grant  execute on function admin_prepared_carts(uuid, integer) to authenticated;

comment on function admin_create_prepared_cart(uuid, jsonb, text, text) is
  'Admin-only. Persists a (sku, dose, quantity) shopping list for a member, mints a link token, stores only its SHA-256 digest, and returns the plaintext ONCE. Rejects empty line arrays and any line carrying a price key — a prepared cart stores no money because place-order fails closed on client-supplied prices.';
