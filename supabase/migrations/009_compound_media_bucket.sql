-- =============================================================================
-- VS Research Labs — compound-media storage bucket
-- =============================================================================
-- A public bucket for compound poster images (cited-clip thumbnails today).
-- The resolve-video edge function downloads the (expiring) TikTok CDN thumbnail
-- and uploads a permanent copy here, then stores the public URL on the SKU — so
-- thumbnails never rot and no image is hosted by hand.
--
-- Public read (served at /storage/v1/object/public/compound-media/<path>).
-- Writes are service-role only (the edge function), so no insert/update policy
-- is granted to anon/authenticated.
--
-- Additive. Re-runnable.
-- =============================================================================

insert into storage.buckets (id, name, public)
  values ('compound-media', 'compound-media', true)
  on conflict (id) do update set public = true;

-- Explicit public read (a public bucket already serves via the public endpoint;
-- this keeps the policy intent visible and covers the authenticated client too).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'compound_media_public_read'
  ) then
    create policy compound_media_public_read on storage.objects
      for select to public
      using (bucket_id = 'compound-media');
  end if;
end $$;
