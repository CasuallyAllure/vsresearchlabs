# Compound Deep Links — `/c/<slug>`

Shareable URLs for the compound intelligence record. Shipped 2026-07-28.

## The URL scheme

```
https://vsresearchlabs.com/c/<product.slug>
e.g. https://vsresearchlabs.com/c/bpc157-5mg
```

One path per compound, keyed on the product's existing `slug`. There is no
new identifier and no new data — `slug` already shipped on every product in
`src/data/products.json` and `biopeptideCompounds.generated.json` (71 total,
all unique and URL-safe; a unit test asserts both properties).

`/product/:id` is unchanged and still the commerce page. `/c/<slug>` is the
*record*: the dossier overlay, addressable.

## The resolver

`src/lib/compoundShare.ts` is the single slug ⇄ compound authority. Every
surface — the overlay's URL sync, the share button, the `/c/:slug` route, and
the build-time Open Graph generator — goes through it, so a link minted on one
surface resolves identically everywhere else.

| Export | Purpose |
| --- | --- |
| `compoundSharePath(product)` | `/c/<slug>` |
| `compoundShareUrl(product)` | absolute, always on the production host |
| `resolveCompoundSlug(products, slug)` | slug → Product, falling back to `id` then `sku`; `null` for unknown |
| `shareDescription(product)` | RUO-framed blurb for share sheets + og:description |
| `shareTitle(product)` | `<name> — VS Research Labs` |
| `isCompoundSharePath(pathname)` | route-prefix test (used by RouteMeta) |

`compoundShareUrl` deliberately ignores `window.location.origin`: a link
copied from a preview or localhost session must still be the link that works
when it is pasted somewhere else.

## How the URL gets written (overlay stays an overlay)

`src/hooks/useCompoundShareRoute.ts`, called once from
`CompoundIntelligenceOverlay`. Because the hook lives *inside* the overlay,
every mount point inherits the behaviour — catalog rows, `/research` tiles,
the supply-page grids, the landing hero spotlight, the bundle and inventory
modals, and the product-page dossier band. Do not re-implement it per surface.

```
open   → history.pushState('/c/<slug>')     address bar is copyable
swipe  → history.replaceState('/c/<next>')  carousel doesn't stack entries
back   → popstate closes the overlay
close  → history.back() rewinds to the page underneath
```

A raw `pushState` does **not** notify React Router (it only listens to
`popstate`), which is the point: the page underneath keeps rendering with its
filters and scroll intact instead of unmounting. The two locations re-converge
the moment the overlay closes, because closing rewinds the same entry it
pushed. The cleanup only calls `history.back()` when the top entry is still
ours, so following a link *out* of the overlay does not hijack history.

## Disclaimer gate ordering (compliance)

`DisclaimerGate` is mounted at the app root and is untouched by this work — it
still shows itself on first visit on every route, focus-trapped, ESC-proof.

`src/pages/CompoundShare.tsx` (the `/c/:slug` route) does not bypass or reorder
it. It renders the catalog underneath and then **withholds the compound
overlay** until the gate reports acceptance, listening for the same
`vsr:disclaimer-accepted` event the landing entrance sequence uses. So:

- **First-time visitor on a shared link** → gate → accept → compound record.
- **Returning visitor** (stored acceptance) → compound record directly.

An unknown slug is not an error: the route replaces itself with `/catalog`.

## Share affordance

`src/components/catalog/ShareCompoundButton.tsx`, in the overlay chrome strip
next to close. Web Share API when the platform offers one (mobile share
sheet), otherwise clipboard with a `Link copied` confirmation. Clipboard
failures surface as `Copy failed` rather than a silently dead button. A
dismissed share sheet (`AbortError`) is not treated as a failure. The
confirmation is absolutely positioned so it cannot shove the chrome controls
sideways, and its entrance animation is disabled under
`prefers-reduced-motion`.

## Open Graph / share previews

The site is a client-rendered SPA served as **static assets** by the Cloudflare
Worker (`wrangler.jsonc` → `assets`, no worker script). Link unfurlers do not
run JavaScript, so per-route meta has to exist in the served HTML.

`scripts/buildCompoundShareRoutes.mjs` runs as the last step of `npm run
build`. It clones the built `dist/index.html` once per compound, swaps only
the title / description / canonical / `og:*` / `twitter:*` tags, and writes
`dist/c/<slug>.html`. Everything else — including the hashed script and link
tags — is byte-identical, so the React app boots exactly as it does anywhere
else.

Serving, confirmed against `wrangler dev`:

| Request | Result |
| --- | --- |
| `/c/bpc157-5mg` | `200`, compound-specific og tags (clean URL, no redirect) |
| `/c/bpc157-5mg.html` | `307` → `/c/bpc157-5mg` |
| `/c/bpc157-5mg/` | `307` → `/c/bpc157-5mg` |
| `/c/<unknown>` | `200` SPA `index.html` → React falls back to `/catalog` |

This works because Cloudflare's asset router defaults to
`html_handling: auto-trailing-slash` (serves `foo.html` at `/foo`) and
`not_found_handling: single-page-application` catches everything else.

**No edge worker code was added.** A runtime `HTMLRewriter` worker was the
alternative; prerendering is strictly less machinery, has no request-path
failure mode, and produces the same bytes for crawlers.

`og:image` is the compound's own vial render (1024×1024), falling back to the
brand mark if the file is missing from `dist/`. Descriptions are the catalog
`shortDescription` with the research-use boundary appended — never a
therapeutic claim.

### Keeping the generator honest

The script duplicates three constants from the TypeScript side because it runs
in Node against raw JSON: `ORIGIN`, `RUO_LINE`, and `DESCRIPTION_MAX`. It
throws (failing the build) if any expected meta tag is missing from
`dist/index.html`, so a template edit surfaces as a build failure rather than
71 share links silently previewing the landing page.
