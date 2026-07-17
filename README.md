# VS Research Labs — storefront

Production e-commerce storefront for VS Research Labs (research compounds, research-use-only). Vite + React 19 + TypeScript (strict) on the front, Supabase (Postgres + RLS + edge functions) on the back, deployed as a static SPA via Cloudflare (wrangler).

**Live domain:** vsresearchlabs.com

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite 8, React 19, react-router 7, Tailwind 3, zustand |
| 3D hero | three.js + @react-three/fiber (real PDB coordinates, lazy-loaded chunk) |
| Backend | Supabase — RLS tables, SECURITY DEFINER RPCs, 11 edge functions (Deno) |
| Checkout | `place-order` edge function → Zelle invoice email (Resend), manual payment verification |
| Design system | `src/theme/theme.css` tokens, monochrome silver/graphite/cream, single-source dark mode (`docs/DESIGN_2026_BLUEPRINT.md`) |

## Development

```sh
npm install
npm run dev          # Vite dev server (needs .env.local — see below)
npm run lint         # eslint
npx tsc -b           # typecheck
npm run test         # vitest (unit + RLS; RLS self-skips without TEST_SUPABASE_* env)
npm run test:e2e     # Playwright smoke (local only)
```

`.env.local` (gitignored) must carry `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, or the app boots in "backend not configured" mode.

## Deploying — MANUAL, three independent targets

**`git push` deploys NOTHING.** Each target ships separately:

1. **Frontend** — `npm run build && npx wrangler deploy` — ⚠ ALWAYS from the repo root, never from a git worktree (worktrees lack `.env.local`, so the Supabase keys don't get baked in and prod breaks).
2. **Edge functions** — `supabase functions deploy <name>` (or all). Function behavior changes are inert until this runs.
3. **Database** — `supabase db push` applies `supabase/migrations/`. Some function deploys REQUIRE their migration first — check the migration header comments for ordering.

Secrets live in Supabase (`supabase secrets list`) — never in code.

**Going backwards:** see [docs/ROLLBACK.md](docs/ROLLBACK.md). Reverting a commit
deploys nothing — each target has its own reverse, and only the frontend has a
real rollback verb.

## Repo map

- `src/pages/` — routes (public, `account/`, `admin/`, `legal/`); all lazy-loaded via `src/App.tsx`
- `src/components/` — by domain (`catalog/`, `landing/`, `cart/`, `admin/`, `account/`, …)
- `src/lib/` — pricing, coupons, shipping, placeOrder, auth. **Price path rule:** public catalog/cart must use `effectiveTierPriceCents` / `variantProduct(product, dose)` — see the header comments in `src/lib/cartActions.ts`
- `supabase/functions/` — edge functions; `_shared/` has the admin gate, CORS, Turnstile, email branding
- `supabase/migrations/` — numbered, additive; prod is pushed manually
- `scripts/` — inventory generator (`npm run gen:inventory` — but note `biopeptideCompounds.generated.json` is hand-maintained now, don't regenerate blindly), vial imagery, molecular structure builder, `scripts/inventory.mjs` stock CLI
- `docs/` — design blueprints and system docs; `docs/DESIGN_2026_BLUEPRINT.md` is the design direction of record

## Testing

Vitest unit tests cover the money math (pricing, coupons, rewards, checkout price verification) in `tests/unit/`; `tests/rls/` verifies portal isolation against a live test DB; Playwright covers a logged-out smoke journey. CI (`.github/workflows/ci.yml`) runs lint + typecheck + unit tests on every push/PR.
