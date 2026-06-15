# Inventory: per-SKU clip + bulk import

Two ways to manage stock/price/visibility **and the cited clip** (TikTok poster +
lightbox, like MOTS-C) without a redeploy:

1. **Admin → Inventory → Clip** — paste a link per SKU, "Fetch" auto-fills
   title/author/thumbnail, Save.
2. **Admin → Import** — download a sheet pre-filled with every catalog SKU's
   current values, edit offline, upload the CSV. One row per SKU sets stock,
   price, visibility, reorder point, and the clip fields at once.

Both write the same four columns on `product_stock`: `video_url`,
`video_title`, `video_description`, `video_thumbnail`. The catalog reads them
via the `public_product_overrides` view; `getCompoundVideo()` resolves the
override first, then static product fields, then the `COMPOUND_VIDEOS` demo map.

## Deploy order (REQUIRED before pushing the frontend to live use)

```bash
# 1. Migrations — columns, RPCs, and the media bucket
supabase db push          # applies 007 + 008 + 009
#   007: video_* columns, view update, set_product_video()
#   008: import_inventory(jsonb) bulk RPC
#   009: public 'compound-media' Storage bucket (hosted thumbnails)

# 2. Edge function — oEmbed + thumbnail hosting (uses the auto-injected
#    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to upload to compound-media)
supabase functions deploy resolve-video
#   optional: supabase secrets set ALLOWED_ORIGIN=https://vsresearchlabs.com
```

The frontend is **deploy-safe before the migration**: `productOverrides.reload()`
falls back to the base column set if the `video_*` columns aren't live yet, so
the public catalog won't break. The admin Clip/Import features just won't work
until 007/008 are applied. The "Fetch" button needs `resolve-video` deployed;
without it you can still paste url/title/description/thumbnail by hand.

## The import sheet

Columns (headers are the exact import keys — keep them):

| column | meaning | blank = |
|---|---|---|
| `sku` | join key, must match catalog | (row skipped) |
| `name`, `class` | reference only, ignored on import | — |
| `on_hand` | absolute stock; logged as a stock movement | unchanged |
| `price_usd` | dollars; converted to a cents override | unchanged |
| `hidden` | `true`/`false` | unchanged |
| `reorder_at` | reorder point | unchanged |
| `video_url` | TikTok url (short `/t/` links OK via Fetch) | clip unchanged |
| `video_title`, `video_description`, `video_thumbnail` | clip fields | — |

- **Blank cells never wipe data** — only filled cells apply.
- Unknown SKUs are flagged in the preview and skipped.
- `import_inventory` returns `{ applied, skipped, errors[] }`; the page shows it.

## Thumbnails — now automatic

TikTok CDN thumbnail URLs are **signed and expire**, so they can't be used
directly. Both paths now host a permanent copy for you:

- **Clip modal → Fetch**: downloads the thumbnail and uploads it to the
  `compound-media` bucket, then drops the permanent public URL into the field.
- **Import**: any clip row with a `video_url` but no `video_thumbnail` is
  resolved + hosted automatically during a "Hosting thumbnails" pre-pass before
  the rows are written. So pasting just the URL is enough.

Hosted at `…/storage/v1/object/public/compound-media/clips/<sku>.<ext>`.

If hosting ever fails (network, oEmbed down), the flow degrades gracefully: the
clip still saves, just without a poster. You can re-run Fetch later, or paste a
self-hosted URL (e.g. `/media/<slug>.jpg`) by hand — the static code path in
`COMPOUND_VIDEOS` still works too. See the `project_compound_video_workflow`
memory.
