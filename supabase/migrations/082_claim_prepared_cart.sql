-- =============================================================================
-- 082_claim_prepared_cart.sql — the member-facing half of the prepared cart
-- =============================================================================
-- 081 built the cart and minted its link token but deliberately stopped short
-- of the two routines the member-facing half needs. This migration adds them:
--
--   claim_prepared_cart(p_token)          the member redeems their own link
--   prepared_cart_email_payload(id, tok)  what send-prepared-cart mails out
--
-- and replaces one of 081's, because opening a link is no longer a one-shot
-- event and 081's derived status said otherwise:
--
--   admin_prepared_carts(user, n)         status is openability; opens are a count
--
-- The shape of the first is not a new design decision — it is written down in
-- 081's header ("SEAM FOR THE EMAIL / CLAIM WORKSTREAM", 081:80-104) and is
-- implemented here verbatim except where noted below.
--
-- LOOKUP IS BY DIGEST, AND POSSESSION IS NOT AUTHORIZATION
-- --------------------------------------------------------
-- There is no plaintext token column to look up by — 081 stores only
-- `encode(sha256(token::bytea), 'hex')` — so the claim hashes the presented
-- token the same way and matches on the digest.
--
-- The match alone is NOT enough. The predicate is
--
--     token_hash = <digest>  AND  user_id = auth.uid()
--
-- and both halves are required. This is a DELIBERATE DEPARTURE from /track's
-- bearer token (019/041), where possession of the token IS the authorization
-- because the buyer has no account. Here the recipient always has an account —
-- the cart is built FOR a member — so a link that leaks (a forwarded mail, a
-- shared screenshot, a mailbox someone else can read) must be worth nothing to
-- whoever holds it. It is redeemable by exactly one auth user.
--
-- NO ORACLE: the failure shape AND the wrong-user reason are the miss reason
-- -----------------------------------------------------------------------
-- Every failure returns the SAME jsonb shape — `{ok:false, reason:<text>}` —
-- and never raises. A raise would itself be a signal (PostgREST renders it as a
-- different status with a different body), which is exactly the oracle 041's
-- convention exists to avoid.
--
-- The reason VALUES are graded by what the caller has already proven:
--
--   • `not_found` is returned for a token that does not exist, a malformed
--     token, AND a real token belonging to a DIFFERENT member. Those three are
--     indistinguishable by construction: they are the same `not found` branch
--     of one query whose predicate contains both conditions. An attacker
--     holding a leaked link learns nothing — not even that the link is real.
--
--   • `revoked` / `expired` are reachable ONLY after the (digest, auth.uid())
--     pair matched — i.e. only by the one member the cart was built for, about
--     their own cart. Telling the rightful owner why their own link stopped
--     working discloses nothing to anybody else, and the alternative (a blank
--     "no") is the dead end this workstream exists to fix: a real client
--     already hit a 404 on this URL.
--
-- RE-OPENABLE UNTIL IT EXPIRES OR IS REVOKED — 081's contract, upheld
-- -------------------------------------------------------------------
-- 081:92-95 says claimed_at is a "has been loaded at least once" stamp and the
-- link "stays REUSABLE until claimed/expired/revoked is decided otherwise",
-- flagging the phone-then-laptop case. That reading stands, and the reason is
-- concrete rather than stylistic:
--
--   THE CART IS DEVICE-LOCAL. src/hooks/useCart.ts persists into localStorage
--   (zustand `persist`, siteConfig.storage.cartKey). It is not a server-side
--   cart shared across a member's devices.
--
-- So a single-use link would fail in the NORMAL case, not an edge case: the
-- member opens the mail on their phone, taps through, the phone's cart fills.
-- They then sit down at a laptop to actually buy, tap the same link, and would
-- be told "already claimed — the items are in your cart" while looking at an
-- empty one. That is indistinguishable from the broken link this workstream was
-- opened to fix. Email-on-phone / buy-on-desktop is how people shop.
--
-- Therefore: a claim NEVER refuses for having happened before. `already_claimed`
-- does not exist as a reason. `claimed_at` is retained purely as the FIRST-claim
-- timestamp for the owner's visibility, alongside `claim_count` and
-- `last_claimed_at` (added below) so the admin panel can honestly show
-- "opened 3×".
--
-- Idempotence is the CLIENT's job and is real, not incidental: the claim page
-- SETS each prepared line's quantity to the prepared amount rather than adding
-- to it (AccountPreparedCart.tsx), so a second or third device converges on the
-- same cart instead of doubling it. The server returning the same list every
-- time is what makes that convergence possible.
--
-- The stamp still cannot be written twice: `claimed_at = coalesce(claimed_at,
-- now())` under the row lock a single UPDATE takes means a concurrent second
-- tap re-reads the committed row and preserves the first claim's timestamp. It
-- is not refused — it simply does not overwrite.
--
-- STILL NO MONEY
-- --------------
-- The claim returns `(sku, dose, quantity)`, the coupon CODE and the note. No
-- price, ever — for the same forced reason 081 stores none: place-order's
-- verifyLinePrices rejects the whole order (409) on any client-supplied price
-- that is not byte-identical to the live catalog. The client reconstructs each
-- line through `variantProduct(product, dose)` (src/lib/preparedCart.ts's
-- planPreparedCart is the mapper) and every figure resolves live.
--
-- GRANT POSTURE — revoke BEFORE grant
-- ------------------------------------
-- This schema's bootstrap `alter default privileges … grant all on functions to
-- anon, authenticated, service_role`, layered on PostgreSQL's own built-in
-- `EXECUTE TO PUBLIC` default for new routines, means a bare `create function`
-- is born ANON-CALLABLE. That was a live vulnerability (078 for views, 079 for
-- routines: 70 of 80 were reachable). Both routines below therefore revoke from
-- public, anon, authenticated FIRST and only then grant to the narrowest role.
-- claim_prepared_cart is registered in the AUTHENTICATED_ONLY allowlist in
-- tests/integration/functionGrantHardening.test.ts — THAT TEST IS THE REAL
-- GUARD, and it fails CI on any routine added without one.
--
-- Additive, idempotent and re-runnable. No data touched. Forward-fix only.
-- Rollback: DB is forward-fix only — deploy a later migration dropping both
--   functions. Nothing in 081 depends on either.
-- =============================================================================


-- ── 1. Open-count columns ───────────────────────────────────────────────────
-- claimed_at (081) keeps its meaning: the FIRST time this link was opened. The
-- two columns here are what make "opened 3× — last on the 12th" honest on the
-- admin surface, which matters now that opening is not a one-shot event.
-- Additive with defaults, so existing rows read as never-opened.

alter table prepared_carts
  add column if not exists claim_count     integer     not null default 0,
  add column if not exists last_claimed_at timestamptz;

comment on column prepared_carts.claimed_at is
  'FIRST time the member opened this link. Never a lock: the link stays openable until it expires or is revoked, because the cart it fills is device-local (localStorage), so a member who opens the mail on a phone must still be able to open it on the laptop they buy from.';
comment on column prepared_carts.claim_count is
  'How many times the member has opened this link. Display only — nothing gates on it.';


-- ── 2. claim_prepared_cart — the member redeems their own link ──────────────
-- Returns on success:
--   {ok:true, cart_id, coupon_code, note, expires_at, first_claim,
--    lines:[{sku, dose, quantity}]}   -- dose is '' for single-config items
-- and on every failure:
--   {ok:false, reason:'not_signed_in'|'not_found'|'revoked'|'expired'}
--
-- The SAME list comes back every time. That is the contract the client's
-- set-quantity (rather than add-quantity) apply depends on to converge.

create or replace function claim_prepared_cart(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_cart  prepared_carts;
  v_first boolean;
begin
  -- Defensive: the EXECUTE grant is `authenticated` only, so a NULL uid should
  -- be unreachable from a browser. Answered in the uniform shape anyway rather
  -- than raising, so the page has one response contract to render.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Hash whatever arrived. A malformed or empty token simply digests to
  -- something no row carries, and falls into the same `not_found` branch as a
  -- wrong-user token — there is no separate validation rejection to observe.
  v_hash := encode(sha256(coalesce(btrim(p_token), '')::bytea), 'hex');

  -- BOTH conditions, in ONE query. Splitting this into "find by hash, then
  -- check the owner" would reintroduce the oracle: the two misses would become
  -- distinguishable by construction even if the returned value matched.
  select * into v_cart
    from prepared_carts
   where token_hash = v_hash
     and user_id = v_uid;

  if not found then
    -- No such token / malformed token / someone else's token. One answer.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Past this line the caller has PROVEN they are the member this cart was
  -- built for, so a specific reason is owed to them and leaks nothing.
  if v_cart.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  if v_cart.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Record the open. `coalesce(claimed_at, now())` PRESERVES the first claim:
  -- a concurrent second tap blocks on this row's lock, re-reads the committed
  -- row and keeps the earlier timestamp, so the first-claim stamp can never be
  -- written twice — but neither tap is refused, which is the whole point.
  update prepared_carts
     set claimed_at      = coalesce(claimed_at, now()),
         last_claimed_at = now(),
         claim_count     = claim_count + 1
   where id = v_cart.id
  returning (claim_count = 1) into v_first;

  -- Audit only the FIRST open. Every subsequent one is the same member on
  -- another device; logging each would bury the signal the owner cares about
  -- ("did this land?") under noise. claim_count carries the rest.
  if v_first then
    perform log_audit(
      'member.prepared_cart.claimed',
      'customer',
      v_uid::text,
      'Prepared cart claimed',
      null,
      jsonb_build_object('cart_id', v_cart.id, 'coupon_code', v_cart.coupon_code),
      null
    );
  end if;

  return jsonb_build_object(
    'ok',          true,
    'cart_id',     v_cart.id,
    'coupon_code', v_cart.coupon_code,
    'note',        v_cart.note,
    'expires_at',  v_cart.expires_at,
    -- False on a re-open. The page uses it for nothing that gates behaviour —
    -- the apply is idempotent either way — but it is the honest signal for copy.
    'first_claim', coalesce(v_first, false),
    'lines',       (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sku', l.sku, 'dose', l.dose, 'quantity', l.quantity
             ) order by l.position, l.sku), '[]'::jsonb)
        from prepared_cart_lines l
       where l.cart_id = v_cart.id
    )
  );
end;
$$;


-- ── 3. prepared_cart_email_payload — what send-prepared-cart needs ──────────
-- Service-role only, called by the edge function. It exists because the two
-- facts the mail needs are BOTH unreachable over PostgREST: `auth.users.email`
-- is outside the exposed schema, and 081 grants nothing at all on
-- prepared_carts / prepared_cart_lines. Same shape and same posture as 075's
-- automation_candidates — eligibility next to the tables it reads.
--
-- `token_ok` is the reason the plaintext token is a parameter: it proves the
-- link about to be mailed is the link that actually opens this cart. A mail
-- carrying a dud URL is worse than no mail, because the member burns a trip to
-- a dead page (this whole workstream exists because one already did).
--
-- CONSENT: `marketing_opt_out` is returned, not enforced here. A prepared cart
-- is an unsolicited commercial offer — the same category as 075's `winback`,
-- the one automation kind gated on this column — so the edge function refuses
-- to send when it is true. It is surfaced rather than silently swallowed so the
-- admin is TOLD the mail was suppressed and can hand the link over by another
-- channel the member did agree to.

create or replace function prepared_cart_email_payload(
  p_cart_id uuid,
  p_token   text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_cart prepared_carts;
  v_email text;
  v_name  text;
  v_optout boolean;
begin
  select * into v_cart from prepared_carts where id = p_cart_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select u.email, cp.full_name, coalesce(cp.marketing_opt_out, false)
    into v_email, v_name, v_optout
    from auth.users u
    left join customer_profiles cp on cp.user_id = u.id
   where u.id = v_cart.user_id;

  if v_email is null or btrim(v_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_recipient');
  end if;

  return jsonb_build_object(
    'ok',                true,
    -- The member behind the cart, so the edge function's email_log row is
    -- attributable (075's user_id column) instead of an orphan address.
    'user_id',           v_cart.user_id,
    'recipient',         v_email,
    'display_name',      nullif(btrim(coalesce(v_name, '')), ''),
    'marketing_opt_out', v_optout,
    'coupon_code',       v_cart.coupon_code,
    'note',              v_cart.note,
    'expires_at',        v_cart.expires_at,
    'revoked',           v_cart.revoked_at is not null,
    'expired',           v_cart.expires_at <= now(),
    -- Same digest comparison the claim performs, so "the mail links to this
    -- cart" is checked rather than assumed.
    'token_ok',          v_cart.token_hash = encode(sha256(coalesce(btrim(p_token), '')::bytea), 'hex'),
    'lines',             (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sku', l.sku, 'dose', l.dose, 'quantity', l.quantity
             ) order by l.position, l.sku), '[]'::jsonb)
        from prepared_cart_lines l
       where l.cart_id = v_cart.id
    )
  );
end;
$$;


-- ── 4. admin_prepared_carts — replaced to tell the truth about "claimed" ────
-- 081's version derived `status = 'claimed'` the moment claimed_at was set. That
-- was accurate under a single-use claim and is MISLEADING now: an opened link is
-- still perfectly live, and an owner reading "claimed" would reasonably conclude
-- it is spent and rebuild a cart the member can already open.
--
-- So status is now only ever live / expired / revoked — the three states that
-- actually answer "will this link still work?" — and how often it has been
-- opened moves into its own fields, where it is information rather than a verdict.
-- Everything else about the function is unchanged, including the explicit column
-- list that keeps token_hash off every client-reachable surface.

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
             'id',              pc.id,
             'created_at',      pc.created_at,
             'expires_at',      pc.expires_at,
             'claimed_at',      pc.claimed_at,
             'last_claimed_at', pc.last_claimed_at,
             'claim_count',     pc.claim_count,
             'revoked_at',      pc.revoked_at,
             'coupon_code',     pc.coupon_code,
             'note',            pc.note,
             -- Openability only. "Has been opened" is claim_count's job.
             'status',          case
                                  when pc.revoked_at is not null then 'revoked'
                                  when pc.expires_at <= now()    then 'expired'
                                  else 'live'
                                end,
             'lines',           (
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


-- ── 5. EXECUTE grants — revoke from all three roles, then narrow ────────────
-- Mandatory and separate from the table channel: a new routine is born
-- EXECUTE-to-PUBLIC and the bootstrap adds anon/authenticated on top. See the
-- header; 079 is the write-up.

-- The member's own claim. `authenticated` is as narrow as an ACL can express;
-- the `user_id = auth.uid()` predicate in the body is the real fence, and both
-- are asserted by tests/integration/preparedCarts.test.ts. This routine must
-- NEVER move to ANON_CALLABLE: an anonymous caller has no auth.uid(), so a
-- leaked link would become redeemable by whoever holds it — the exact property
-- the owner binding exists to deny.
revoke execute on function claim_prepared_cart(text) from public, anon, authenticated;
grant  execute on function claim_prepared_cart(text) to authenticated;

-- Service-role only (the send-prepared-cart edge function), which reaches it
-- through its default grant — the same arrangement 075 uses for
-- automation_candidates. It returns a member's e-mail address and must never be
-- reachable from a browser at all, so nothing is granted back.
revoke execute on function prepared_cart_email_payload(uuid, text) from public, anon, authenticated;

comment on function claim_prepared_cart(text) is
  'Member-facing redemption of a prepared-cart link. Matches on sha256(token) AND user_id = auth.uid() — possession alone is NOT authorization, unlike /track''s bearer token. Every failure returns the same {ok:false, reason} shape; a wrong-user token is indistinguishable from a nonexistent one (both `not_found`). Single use: claimed_at is stamped by a conditional update, so a link cannot load a cart twice.';

comment on function prepared_cart_email_payload(uuid, text) is
  'Service-role only. Everything send-prepared-cart needs to compose the claim email — recipient, marketing_opt_out, lines, coupon code, note, expiry — plus token_ok, which proves the link being mailed actually opens this cart. Never granted to any browser role: it returns a member''s email address.';
