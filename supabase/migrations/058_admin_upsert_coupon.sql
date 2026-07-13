-- 058_admin_upsert_coupon.sql
-- ---------------------------------------------------------------------------
-- One audited write-path for coupon CREATE and EDIT (the admin editor had no
-- edit path — only a direct insert + toggle-active + delete). SECURITY DEFINER
-- + is_admin() + log_audit, matching every other money mutation (036). Handles
-- the combinability flags added in 057.
--
-- p_id null → insert; else update that coupon by id. Code is normalized
-- uppercase; kind-specific required fields validated. Returns the row as jsonb.
-- Requires 057. Rollback: drop function admin_upsert_coupon.
-- ---------------------------------------------------------------------------

create or replace function admin_upsert_coupon(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code   text := upper(btrim(coalesce(p_payload->>'code', '')));
  v_kind   text := p_payload->>'kind';
  v_row    coupons%rowtype;
  v_is_new boolean := p_id is null;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  -- Basic validation (mirrors the coupons table CHECK constraints so the admin
  -- gets a clean error instead of a raw constraint violation).
  if length(v_code) < 3 or length(v_code) > 40 then
    raise exception 'Code must be 3–40 characters.';
  end if;
  if v_kind not in ('percent', 'fixed', 'free_item') then
    raise exception 'Invalid kind %', coalesce(v_kind, '(null)');
  end if;
  if v_kind = 'percent' and (p_payload->>'percent') is null then
    raise exception 'Percent codes need a percent.';
  end if;
  if v_kind = 'fixed' and (p_payload->>'amount_cents') is null then
    raise exception 'Fixed codes need an amount.';
  end if;
  if v_kind = 'free_item' and ((p_payload->>'free_sku') is null or (p_payload->>'free_label') is null) then
    raise exception 'Free-item codes need a SKU and a label.';
  end if;

  if v_is_new then
    insert into coupons (
      code, kind, percent, amount_cents, free_sku, free_dose, free_label,
      min_subtotal_cents, max_uses, once_per_contact, requires_account,
      starts_at, expires_at, active, affiliate_id, commission_percent,
      exclusive, combines_with_codes, combines_with_promos, combines_with_account
    ) values (
      v_code, v_kind,
      nullif(p_payload->>'percent', '')::integer,
      nullif(p_payload->>'amount_cents', '')::integer,
      nullif(p_payload->>'free_sku', ''), nullif(p_payload->>'free_dose', ''), nullif(p_payload->>'free_label', ''),
      coalesce(nullif(p_payload->>'min_subtotal_cents', '')::integer, 0),
      nullif(p_payload->>'max_uses', '')::integer,
      coalesce((p_payload->>'once_per_contact')::boolean, false),
      coalesce((p_payload->>'requires_account')::boolean, false),
      nullif(p_payload->>'starts_at', '')::timestamptz,
      nullif(p_payload->>'expires_at', '')::timestamptz,
      coalesce((p_payload->>'active')::boolean, true),
      nullif(p_payload->>'affiliate_id', '')::uuid,
      nullif(p_payload->>'commission_percent', '')::integer,
      coalesce((p_payload->>'exclusive')::boolean, false),
      coalesce((p_payload->>'combines_with_codes')::boolean, true),
      coalesce((p_payload->>'combines_with_promos')::boolean, true),
      coalesce((p_payload->>'combines_with_account')::boolean, true)
    )
    returning * into v_row;
  else
    update coupons set
      code                  = v_code,
      kind                  = v_kind,
      percent               = nullif(p_payload->>'percent', '')::integer,
      amount_cents          = nullif(p_payload->>'amount_cents', '')::integer,
      free_sku              = nullif(p_payload->>'free_sku', ''),
      free_dose             = nullif(p_payload->>'free_dose', ''),
      free_label            = nullif(p_payload->>'free_label', ''),
      min_subtotal_cents    = coalesce(nullif(p_payload->>'min_subtotal_cents', '')::integer, 0),
      max_uses              = nullif(p_payload->>'max_uses', '')::integer,
      once_per_contact      = coalesce((p_payload->>'once_per_contact')::boolean, false),
      requires_account      = coalesce((p_payload->>'requires_account')::boolean, false),
      starts_at             = nullif(p_payload->>'starts_at', '')::timestamptz,
      expires_at            = nullif(p_payload->>'expires_at', '')::timestamptz,
      active                = coalesce((p_payload->>'active')::boolean, true),
      affiliate_id          = nullif(p_payload->>'affiliate_id', '')::uuid,
      commission_percent    = nullif(p_payload->>'commission_percent', '')::integer,
      exclusive             = coalesce((p_payload->>'exclusive')::boolean, false),
      combines_with_codes   = coalesce((p_payload->>'combines_with_codes')::boolean, true),
      combines_with_promos  = coalesce((p_payload->>'combines_with_promos')::boolean, true),
      combines_with_account = coalesce((p_payload->>'combines_with_account')::boolean, true),
      updated_at            = now()
    where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Coupon not found';
    end if;
  end if;

  perform log_audit(
    case when v_is_new then 'coupon.created' else 'coupon.updated' end,
    'coupon', v_row.id::text,
    format('%s %s (%s)', case when v_is_new then 'Created' else 'Updated' end, v_row.code, v_row.kind),
    null, to_jsonb(v_row), jsonb_build_object('source', 'admin_coupon_editor')
  );

  return to_jsonb(v_row);
end;
$$;

revoke execute on function admin_upsert_coupon(uuid, jsonb) from public, anon;
grant execute on function admin_upsert_coupon(uuid, jsonb) to authenticated;
