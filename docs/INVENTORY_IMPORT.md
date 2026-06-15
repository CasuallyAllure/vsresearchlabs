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
# 1. Migrations — add the columns + RPCs
supabase db push          # applies 007_compound_video.sql + 008_inventory_import.sql
#   007: video_* columns, view update, set_product_video()
#   008: import_inventory(jsonb) bulk RPC

# 2. Edge function — server-side oEmbed for the "Fetch" button
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

## Thumbnails — the one manual step

TikTok CDN thumbnail URLs are **signed and expire**, so a fetched thumbnail is
fine for preview but not durable. For a permanent poster, host the image and
paste that stable URL into `video_thumbnail`:

```bash
curl -s -A "Mozilla/5.0" "https://www.tiktok.com/oembed?url=<fullUrl>" | python3 -c "import sys,json;print(json.load(sys.stdin)['thumbnail_url'])"
mkdir -p public/media && curl -s -A "Mozilla/5.0" -o public/media/<slug>.jpg "<thumbnail_url>"
# then set video_thumbnail = /media/<slug>.jpg
```

(Same step we did for MOTS-C. See the `project_compound_video_workflow` memory.)
