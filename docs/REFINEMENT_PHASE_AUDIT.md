# VS Research Labs — Refinement Phase Audit

> Current-state visual maturity audit, dimension by dimension,
> anchored to actual file paths and observed behaviour.
> Companion to `docs/REFINEMENT_PHASE_BLUEPRINT.md`.
>
> Maturity scale: 1 (raw) → 5 (production-grade institutional).

---

## A. Typography

**Maturity: 3 / 5.**

**Observed.** `src/index.css:2` imports Inter weights 300/400/500/600/700
from Google Fonts. `src/theme/theme.css:201–204` declares
`--font-sans` (Inter), `--font-mono` (JetBrains Mono — declared but
never loaded), `--font-display` (aliased to Inter).
`tailwind.config.js:28–30` extends only `fontFamily.sans`. No `mono`
or `display` Tailwind extension.

**Hierarchy actually in use across pages and components:**

- Display heads: `text-3xl sm:text-4xl lg:text-5xl font-light tracking-tight leading-[1.1]`
- Eyebrows: `text-[11px] uppercase tracking-[0.3em] text-white/40`
- Body: `text-base sm:text-lg text-white/65 leading-relaxed`
- Captions: `text-xs` or `text-[11px]` at white/40–55
- Quietest disclosure tier: `text-[10px] uppercase tracking-[0.3em] text-white/35`

The pattern is consistent and deliberate. Headings are uniformly
`font-light` (300). No mono is in use. Identifier-class strings
(SKUs, batch IDs, dates) get `tabular-nums` selectively — see
`src/components/catalog/InventoryRow.tsx:83`,
`src/components/catalog/ProductCard.tsx:80`,
`src/components/documents/DocumentCard.tsx:86`.

**Gap.** No typographic distinction between editorial copy and
operational identifiers. `--font-mono` is declared and unused. This
is the highest-leverage single intervention available — see
Blueprint §1.1.

---

## B. Color & contrast ladder

**Maturity: 4 / 5.**

**Observed.** Greyscale-on-black. Single accent: gold `#C4A35A`
(`--color-interactive-primary` in `theme.css:67`). White-opacity
ladder used: `/20`, `/25`, `/30`, `/35`, `/40`, `/45`, `/50`,
`/55`, `/65`, `/75`, `/80`, `/85`. Status colors declared in
`theme.css:76–83` but not actively surfaced in UI.

Gold population (verified by grep, post-Pass-D):

- `bg-gold` on the single primary CTA — `InquiryCTAModule.tsx:57`
- `bg-gold/15 border-gold/40 text-gold` on the cart-add
  confirmation chip — `InventoryRow.tsx:109`, `ProductPage.tsx`
- `text-gold` on chevron hover in two specific positions —
  `PositioningBlock.tsx:83`, `DocumentationPreview.tsx:76`,
  `DocumentCard.tsx:97`
- Title hover tint — `text-white group-hover:text-gold` on
  `InventoryRow.tsx:71`, `ProductCard.tsx:75`, `DocumentCard.tsx:83`

The discipline is real. Gold is no longer ambient.

**Gap.** Body opacity is picked ad hoc by JSX consumers. No
semantic content-color tokens (`--content-primary`, `--content-
secondary`, etc.) exist as named identifiers. Executors face a
multiple-choice problem at every text element. See Blueprint §R1
for codification.

---

## C. Surface system

**Maturity: 4 / 5.**

**Live utilities** (`src/theme/theme.css`):

- `.research-surface-solid` (`352–364`) — Level 1, hover tint, used
  by `ProductCard`, `InventoryRow`, `DocumentCard`, and as the
  default catalog surface
- `.research-surface-elevated` (`365–369`) — Level 1-elevated,
  used only at `lg:` breakpoint on `ProductPage.tsx:175, 219` for
  the info column and specs sub-panel
- `.research-surface-glass` (`370–384`) — **dead**. Grep confirms
  zero consumers post-Pass-D.

**Bridge classes still defined, all dead:**

- `.glass-themed` (`theme.css:404`)
- `.glass-panel` (`theme.css:410`)
- `.glow-primary` (`theme.css:418`)
- `.velari-shell-gradient` (`theme.css:421`)
- `.glass-card` (`index.css:33`)

**Gap.** Dead surface utilities present invitations to drift.
Cleanup queued in Wave R0.

---

## D. Border / divider grammar

**Maturity: 5 / 5.**

`white/[0.06]` is the universal hairline. Verified in every
section of `Landing.tsx`, every catalog row, every document card,
every cart section divider. Occasional `white/[0.08]` on stronger
emphasis (rare). No coloured borders. No `<hr>` elements; dividers
are bottom-borders on the preceding element.

No intervention required.

---

## E. Motion language

**Maturity: 4 / 5.**

**Observed properties:** `transition-colors`, `transition-all` (only
on chevrons doing color + 0.5px translate). Durations: `duration-200`
dominant. Easings: default Tailwind (`ease-in-out`). Single chevron
nudge pattern (`group-hover:translate-x-0.5`) on:

- `PositioningBlock.tsx:84`
- `DocumentationPreview.tsx:77`
- `DocumentCard.tsx:97`

**Skeleton motion:** `animate-pulse` on
`InventoryRowSkeleton`, `ProductCardSkeleton`. Acceptable.

**Dead motion infrastructure** (queued for R0 cleanup):

- `@keyframes fade-up`, `shimmer`, `glow-breathe`, `sheet-enter`,
  `modal-enter` (`index.css:66–89`)
- Utility classes `.animate-fade-up`, `.animate-glow`,
  `.animate-sheet`, `.animate-modal` (`index.css:92–95`)
- Token surface area: `--scale-press`, `--scale-press-sm`,
  `--scale-hover`, `--scale-bg-sheet` (`theme.css:291–294`)

Zero consumers in `src/`. Verified by grep.

---

## F. Iconography

**Maturity: 3 / 5.**

**Observed.** Inline SVGs hand-authored per consumer. Examples:

- `InventoryRow.tsx:114–142` — `polyline` check (stroke 2) and
  `line+line` plus (stroke 1.5)
- BottomNav (in `src/layout/`) — flask, microscope, mail, home
  icons inline
- Catalog filter — magnifier inline
- Eyebrow chevrons — `→` rendered as a glyph, not an SVG

No shared icon module. No external icon library. Stroke widths
inconsistent (1.5 vs 2.0). ViewBoxes consistent (`0 0 24 24`).

**Gap.** Without a shared module, executors will keep authoring
new icons inline with drift in stroke / sizing. Consolidation
queued in Wave R0.c (or R8 if pulled later).

---

## G. Numerical typography

**Maturity: 2 / 5.**

`tabular-nums` is applied selectively:

- `InventoryRow.tsx:83` — SKU
- `ProductCard.tsx:80` — SKU
- `DocumentCard.tsx:86` — Batch + date

**Not applied** (and visible to users):

- Prices in `ProductPage.tsx`, `CartPage.tsx`, equipment cards
  (when `priceCents !== null`)
- Stock counts (when `stock !== null` — currently never surfaced
  but the field is populated for equipment)
- Dose strings in `DoseTierStrip` and inline rendering
- Cart count chip in `GlobalHeader`
- Catalog result count caption
- Documentation count caption

Currency formatting is also informal — `priceCents` is an integer
number of cents but no `formatPrice()` helper exists; rendering
varies by surface.

**Gap.** Mono font is the answer for identifier-class strings.
Tabular-nums is the answer for inline proportional numerics
that need column alignment. A `lib/format.ts` module should
centralise the rendering. Queued in Wave R2.

---

## H. Imagery

**Maturity: 1 / 5.**

**Observed.** Every `images[]` entry in `src/data/products.json`
points to `https://placehold.co/...`. Every `thumbnailUrl` in
`src/data/documents.json` points to `https://placehold.co/...`.
`src/assets/hero.png` exists but is not consumed by any surface
post-Pass-A (verified by grep).

**This is the most operationally damaging gap in the system.** A
visitor who clicks past the homepage sees grey placeholder boxes
in every product card and document card. The institutional
register does not survive that experience.

Resolution path locked in Wave R4 — vector specimen plates and
stylized first-page document thumbnails. See Blueprint §1.2 and
§R4.

---

## I. Empty / loading / error states

**Maturity: 3 / 5.**

**Loading.** Skeletons exist and are well-formed:

- `ProductCardSkeleton` (`ProductCard.tsx:110`)
- `InventoryRowSkeleton` (`InventoryRow.tsx:154`)

**Empty.** Single short captions, voice uneven:

- `DocumentGallery.tsx:50` — "No documentation available."
  (good)
- `Catalog.tsx` (in surveyed regions) — terse but acceptable
- `CartPage.tsx` empty cart state — verified procurement-toned
  post-Pass-D

**Error.** Inline form errors on `CartPage`. Network errors fall
through to a generic caption. No unified `<ErrorState>` primitive.

**Gap.** No shared `<EmptyState>` or `<ErrorState>` component.
Executors compose these inline, voice will drift on next surface
that needs one. Queued in Wave R7.

---

## J. Form intake

**Maturity: 4 / 5.**

`/cart` (`src/pages/CartPage.tsx`) is the procurement intake
surface. Three sections: Contact, Organization, Notes. Inputs are
solid black, hairline border, white/55 placeholder, focus state
`border-white/30`. Required-field asterisks are white/40 (de-
golded in Pass D — verified).

`/contact` (`src/pages/Contact.tsx`) is the open inquiry surface
with email + phone, no form. Acceptable as-is.

**Gap.** Post-submit success state on `/cart` is a generic success
message, not a stamped procurement document. Highest-impact
single change to the cart flow. Queued in Wave R5.

---

## K. Identifier system

**Maturity: 3 / 5.**

`AbbreviationChip` exists (`src/components/catalog/AbbreviationChip.tsx`)
and renders the 3-char abbreviation as a hairline chip. Used in
`InventoryRow`, `ProductCard`, `ProductPage`, `InventoryTable`.
Consistent.

SKUs render as plain text with `tabular-nums`. Batch IDs render
as plain text with `tabular-nums`. Dates render as plain text
with `tabular-nums`. None use mono.

**Gap.** No `SkuLabel`, `BatchId`, `DoseValue`, `IssuedDate`,
`PriceDisplay` primitives. Each consumer composes inline, with
small variations. The mono treatment proposed in R1/R2 is the
correct moment to introduce these primitives — pulling identifier
rendering into shared components and applying mono in one place.

---

## L. Procurement metadata depth

**Maturity: 3 / 5.**

**Product** (`src/types/product.ts`) carries: `id`, `slug`, `name`,
`category`, `shortDescription`, `longDescription`, `images`,
`specs[]`, `sku`, `abbreviation`, `family`, `variants[]`,
`priceCents`, `stock`, `tags`, `featured`, `createdAt`,
`updatedAt`, plus four `@deprecated` legacy fields
(`description`, `price_cents`, `in_stock`, `created_at`) that
must be retired in R0.

**Missing for procurement realism:** lot identifier, manufacturer,
country of origin, machine-readable storage condition, shelf life,
unit of measure. Some of these appear in `specs[]` as free-text
key/value but are not machine-readable.

**Document** (`src/types/document.ts`) carries: `id`,
`productAbbreviation`, `productName`, `documentType`, `batchId`,
`issuedDate`, `thumbnailUrl`. **Missing:** issuer, file format,
page count, file size, expiration date.

**Data freshness drift.** All 10 products in `products.json` carry
`createdAt` / `updatedAt` between `2026-04-01` and `2026-04-10` —
ten consecutive days at midnight UTC. This reads as seed data, not
as a real catalog. Acceptable for now; queued for variation in R3.

---

## M. Documentation library

**Maturity: 3 / 5.**

`/documentation` (`src/pages/Documentation.tsx`) renders the full
gallery (`DocumentGallery` over `documents.json`). 10 documents
total covering 6 product families (SEM, TZP, RTT, BAC, BAL, PHM,
CEN). Each `DocumentCard` is a horizontal solid surface: small
3:4 thumbnail + metadata column. No filter UI. No per-document
detail surface — `cardHref` routes to `/documentation` itself
(self-referential placeholder noted in `DocumentCard.tsx:30`).

`Landing` previews the first 3 documents via `DocumentationPreview`.

**Gap.** A real procurement archive supports filtering and per-
document URLs. Queued in Wave R6.

---

## N. Header / footer / global chrome

**Maturity: 4 / 5.**

`src/layout/GlobalHeader.tsx` (assumed; not re-read in this audit
turn but confirmed live by Landing import-graph and prior summary)
is sticky, solid-black, hairline-bottom, with logotype left, nav
center, cart-icon right.

`src/layout/GlobalFooter.tsx` is the institutional terminal added
in Pass D. Three caption rows. Mono copyright year.

`src/layout/BottomNav.tsx` is the mobile bottom navigation.

**Stale residue:** `src/components/layout/Footer.tsx`,
`src/components/layout/Navbar.tsx`, `src/components/layout/Shell.tsx`
exist as 280-byte stubs. **No imports from anywhere in `src/`.**
Confirmed dead; queued for deletion in Wave R0.

**Polish opportunities:**

- Logotype refinement post-R1 (Inter tracking + weight sweep, or
  bespoke wordmark SVG). Architect to decide.
- Cart count chip → mono with `tabular-nums` for fixed-width 1
  vs 2 digit display.
- BottomNav icon stroke consistency (part of icon consolidation).

---

## O. Accessibility & focus

**Maturity: 3 / 5.**

`focus-visible` rings present on most interactive elements.
Pattern varies: `focus-visible:ring-1 ring-white/20`,
`focus-visible:ring-1 ring-white/50`, etc. Reduced-motion media
query handled in `theme.css:301–319`.

ARIA labels present on most interactive elements (e.g.
`InventoryRow.tsx:99–103`, `DocumentCard.tsx:113`).

**Gaps:**

- No skip links
- No live region for inquiry-add success (relies on visual
  affordance only)
- Some text colour rungs (`/35`, `/40`) at the edge of WCAG AA
  for non-large text on `#000`

Queued in Wave R9.

---

## P. Theme runtime engine

**Maturity: dead infrastructure.**

`src/theme/ThemeProvider.tsx` (197 lines) and
`src/theme/ThemeTuningProvider.tsx` (declared at `theme/index.ts`)
are wired in `src/main.tsx:9–13`. Both providers run on every
page load.

**However:**

- `ThemeProvider` writes `data-theme`, `data-theme-mode`,
  `data-theme-family` attributes on `<html>` and persists
  `vsresearchlabs-theme-preference` to localStorage.
- `theme.css` contains **zero `[data-theme]` or `[data-theme-*]`
  attribute selectors** (verified by grep).
- The hooks `useTheme`, `useThemeTuning` are only consumed
  internally within the `theme/` folder. Zero application
  consumers.

**Conclusion.** The runtime engine is inert. It writes attributes
nothing reads. It listens to `prefers-color-scheme: dark`
changes, then writes attributes nothing reads. It mutates
localStorage, then on next reload writes attributes nothing
reads. Pure overhead.

The CSS tokens defined in `theme.css :root` ARE used by Tailwind
arbitrary-value JSX (`var(--space-6)`, etc.) and by the
`research-surface-*` utilities. Those survive. The runtime
provider does not.

Queued for deletion in Wave R0.

---

## Q. Tailwind extensions

**Maturity: 2 / 5 (pending cleanup).**

`tailwind.config.js`:

- `colors.base` — used (✓)
- `colors.gold` (light/DEFAULT/dark/muted) — used; `gold.muted`
  unused (verify before deletion)
- `colors.olive` — **unused** (queue R0)
- `colors.purple.accent` — **unused** (queue R0)
- `colors.text` — used by `text-content-*` utilities only
  (verify)
- `borderRadius.card`, `card-inner`, `card-sm` — `card`/`card-sm`
  may be unused; `research-surface-*` uses `--radius-card`.
  Verify before deletion.
- `backgroundImage.gradient-gold` — **unused** (queue R0)
- `backdropBlur.glass`, `glass-heavy` — **unused** post-glass
  removal (queue R0)
- `fontFamily.sans` — used (✓); `mono` and `display` need to be
  added in R1.

---

## R. Stale documentation

**Maturity: 1 / 5.**

`BLUEPRINT.md` (15.8KB at repo root) describes the original
consumer-shop architecture: dropshipping, Stripe Checkout, GSAP
on landing, Framer Motion micro-interactions, GlassCard
primitive, "tone: clean, premium, clinical-minimal — like a
biotech brand, not a storefront", routes `/store /product/:id
/cart /order/:id`, etc.

None of this matches the current procurement system. The
document is actively misleading to any new contributor or
executor agent that reads the repo top-down.

Queued in Wave R0 for replacement with a short pointer to
`docs/`.

---

## Summary scorecard

| Dimension                    | Score | Wave  |
| ---------------------------- | ----- | ----- |
| Typography                   | 3 / 5 | R1    |
| Color & contrast ladder      | 4 / 5 | R1    |
| Surface system               | 4 / 5 | R0    |
| Border / divider grammar     | 5 / 5 | —     |
| Motion language              | 4 / 5 | R0    |
| Iconography                  | 3 / 5 | R0/R8 |
| Numerical typography         | 2 / 5 | R2    |
| Imagery                      | 1 / 5 | R4    |
| Empty / loading / error      | 3 / 5 | R7    |
| Form intake                  | 4 / 5 | R5    |
| Identifier system            | 3 / 5 | R2    |
| Procurement metadata depth   | 3 / 5 | R3    |
| Documentation library        | 3 / 5 | R6    |
| Header / footer / chrome     | 4 / 5 | R0/R8 |
| Accessibility & focus        | 3 / 5 | R9    |
| Theme runtime engine         | dead  | R0    |
| Tailwind extensions          | 2 / 5 | R0    |
| Stale documentation          | 1 / 5 | R0    |

The bones are sound. The lift is real. The wave plan in
`REFINEMENT_PHASE_BLUEPRINT.md` is calibrated to this audit.
