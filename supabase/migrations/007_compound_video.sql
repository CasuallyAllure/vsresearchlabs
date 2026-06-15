-- =============================================================================
-- VS Research Labs — Compound cited-clip override
-- =============================================================================
-- Per-SKU "Research Media" video (TikTok today): url + title + description +
-- thumbnail. Lives on product_stock alongside the other overrides, exposed on
-- the public_product_overrides view, written by an admin-gated RPC.
--
-- Thumbnails should be a STABLE url (hosted in /public/media, or a Supabase
-- Storage url) — TikTok CDN thumbnails are signed + expire. The admin
-- "Fetch from TikTok" button pre-fills metadata via the resolve-video edge
-- function; for a permanent thumbnail, host the image and paste its url.
--
-- Additive. Re-runnable.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'video_url') then
    alter table product_stock add column video_url text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'video_title') then
    alter table product_stock add column video_title text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'video_description') then
    alter table product_stock add column video_description text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'video_thumbnail') then
    alter table product_stock add column video_thumbnail text;
  end if;
end $$;

-- Re-expose the public override view with the video fields.
create or replace view public_product_overrides as
  select sku, on_hand, hidden, price_cents_override, deleted_at,
         video_url, video_title, video_description, video_thumbnail
  from product_stock;

grant select on public_product_overrides to anon, authenticated;

-- ── RPC ──────────────────────────────────────────────────────────────────────

create or replace function set_product_video(
  p_sku         text,
  p_url         text,
  p_title       text,
  p_description text,
  p_thumbnail   text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;

  select video_url into v_before from product_stock where sku = p_sku;

  update product_stock
    set video_url         = nullif(btrim(p_url), ''),
        video_title       = nullif(btrim(p_title), ''),
        video_description = nullif(btrim(p_description), ''),
        video_thumbnail   = nullif(btrim(p_thumbnail), ''),
        updated_at        = now()
    where sku = p_sku;

  perform log_audit(
    'product.video_changed', 'product', p_sku,
    case
      when nullif(btrim(p_url), '') is null then format('%s — cited clip cleared', p_sku)
      else format('%s — cited clip set', p_sku)
    end,
    jsonb_build_object('video_url', v_before),
    jsonb_build_object('video_url', nullif(btrim(p_url), '')),
    null
  );
end;
$$;

grant execute on function set_product_video(text, text, text, text, text) to authenticated;
