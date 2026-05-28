# VS Research Labs — Refinement Phase Blueprint

> Master document for the post-reconciliation refinement phase.
> Peer to `docs/EXECUTION_MAP.md` (construction) and
> `docs/COMPOSITION_SYSTEM_BLUEPRINT.md` (compositional grammar).
>
> Authored by the architect/synthesis lane (Opus). Consumed by
> downstream executor lanes (Kimi K2 and others). Executors do not
> invent design language — they implement what is specified here.
>
> Companion document: `docs/REFINEMENT_PHASE_AUDIT.md` (dimension-by-
> dimension current-state assessment, anchored to file paths).

---

## 0. Phase Charter

### 0.1 What just ended

The reconciliation phase is structurally complete. The frontend is
no longer a consumer storefront masquerading as a research site.
The system has procurement vocabulary, solid surface hierarchy,
hairline divider grammar, color-scoped motion only, gold accent
reduced to inquiry CTAs and cart indicators, twelve dead-code
components removed, three runtime deps removed, an institutional
terminal footer, a procurement intake form at `/cart`, and a
documentation library foundation at `/documentation`.

### 0.2 What this phase IS

**Refinement.** Surface-level visual calibration, typographic
maturity, operational realism, procurement-credibility polish.
Subtractive where possible. Additive only where the addition
raises operational trust (real metadata, real identifiers, real
archival posture).

The system today is intentionally restrained. The next phase tunes
that restraint into something that reads as **expensive,
institutional, documentation-oriented, procurement-native**. Not
louder. Not denser. More precise.

### 0.3 What this phase is NOT

Out of scope. Will be rejected if reintroduced by any executor:

- Marketing language, urgency framing, conversion copy
- Social proof patterns (avatars, logos, ratings, view counters)
- Atmospheric motion (route transitions, scroll-triggered effects,
  parallax, particle fields, ambient glow)
- Glass surfaces outside the existing single permitted use
  (`lg:research-surface-elevated` on `ProductPage` specs sub-panel)
- New gold accents outside CTAs and cart indicators
- New animation utilities, framer-motion or GSAP reintroduction
- Consumer-app patterns: bottom-sheet modals on desktop, overlay
  drawers, "quick view" cards, hover-to-reveal CTAs, decorative
  badges
- Designer gestures: drop shadows, gradient text, decorative
  background blurs, decorative SVG backgrounds, stock hero imagery
- Color palette expansion beyond white-opacity ladder + gold +
  status colors

### 0.4 Operating Model

| Lane                  | Authority                                                 |
| --------------------- | --------------------------------------------------------- |
| Architect (Opus)      | Visual direction, vocabulary, hierarchy, motion, audit    |
| Executors (others)    | Implementation of approved blueprints, refactors, tests   |

Where this document or a per-wave spec is silent, the executor
pauses and requests a blueprint extension rather than guessing.

### 0.5 Standing Anti-Drift Guardrails

1. **Solid surfaces only.** Permitted utilities: `research-surface-
   solid`, `research-surface-elevated`. `research-surface-glass` is
   dead and must not be reintroduced.
2. **Hairline grammar.** Borders use `white/[0.06]`, `white/[0.08]`,
   or `white/[0.10]` only.
3. **Color scope.** Body text uses the white-opacity ladder. Gold
   only on: primary inquiry CTAs, cart count indicator, added-to-
   inquiry confirmation state, single-purpose chevron hover tints
   in approved positions.
4. **Motion scope.** Permitted properties: `color`, `background-
   color`, `border-color`, `opacity` (functional only),
   `transform: translate-x` (≤ 0.5px on chevrons only). Forbidden:
   `scale`, `rotate`, `blur`, `filter`, route transitions, scroll
   effects.
5. **Typography scope.** Three families only: `--font-sans` (Inter),
   `--font-mono` (JetBrains Mono — to be wired in Wave R1),
   `--font-display` (currently aliased to Inter; may be redefined
   in Wave R1).
6. **Vocabulary.** See §0.6.
7. **Image discipline.** No stock photography, no lifestyle
   imagery. See §3.E.

### 0.6 Controlled Vocabulary

**Inventory & catalog**: inventory · catalog · SKU · abbreviation ·
family · dose tier · specification · spec · variant · stock · in
stock · low stock · lot · batch · batch identifier · unit of
measure · package size · storage condition · shelf life · purity ·
readability · capacity · form factor.

**Documentation**: certificate of analysis (COA) · purity report ·
mass spectrometry report · sterility certificate · endotoxin test
report · calibration certificate · batch reference · issued date ·
issuer · document identifier · archive.

**Inquiry intake**: inquiry · procurement inquiry · open an
inquiry · add to inquiry · inquiry summary · inquiry reference ·
response window · one business day · volume request · custom
configuration · quote on inquiry.

**Compliance**: research-use only · for research purposes only ·
in vitro · not for human use · qualified personnel · institutional
setting · regulatory compliance · reconciliation · audit ·
disclosure.

**Forbidden synonyms** (search-and-purge if encountered): shop ·
store · checkout · buy now · add to cart · order (verb) · purchase ·
sale · deal · discount · coupon · promo · trending · bestseller ·
join · sign up · subscribe · newsletter.

---

## 1. Highest-Leverage Refinement Targets

Ranked. Each target is the spine of one or more refinement waves.

### 1.1 Numerical & identifier typography

**Why this is rank 1.** A procurement system that renders SKUs,
batch IDs, dose values, prices, and dates in proportional Inter
will never read as expensive. Activating `--font-mono` (already
declared, not yet wired) and applying it consistently to all
identifier-class strings is the single largest perceived-quality
delta available to us. Cost: low. Impact: immediate.

**Scope.** SKU, abbreviation rendering, batch IDs, dose strings,
prices, stock counts, dates, the cart count chip, copyright year.

**Wave.** R1 (typography foundation) + R2 (identifier primitives).

### 1.2 Real product & document imagery

**Why this is rank 2.** Every `placehold.co` URL in `products.json`
and `documents.json` reads as a wireframe. Replacing them with
**vector specimen plates** (peptide structures, glass vials, line
drawings of equipment) holds the institutional register without
inviting consumer-app photography drift.

**Wave.** R4.

### 1.3 Inquiry confirmation as a procurement document

**Why this is rank 3.** The post-submit state today is a generic
success message. A procurement system confirms an inquiry by
issuing an **inquiry reference** — a stamped, copyable, print-
ready summary with the SKU list, dose tiers, organization,
date, and response window. This single change converts the cart
flow from "checkout-shaped" into "intake-desk-shaped."

**Wave.** R5.

### 1.4 Procurement metadata enrichment

**Why this is rank 4.** Product type carries SKU, abbreviation,
family, variants. It does not carry **lot identifier, manufacturer
of record, country of origin, storage condition (machine-readable),
shelf life, or unit of measure**. Document type carries no issuer,
no file size, no page count, no expiration. Surfacing these where
they exist and quietly omitting where they don't is what makes a
catalog read as audited rather than improvised.

**Wave.** R3.

### 1.5 Documentation library maturity

**Why this is rank 5.** `/documentation` today renders the full
gallery with no filter, no sort, no per-document detail. A real
documentation archive supports filtering by family, document type,
date range, batch. The detail surface (modal or peer route) shows
issuer, format, page count, file size, expiration.

**Wave.** R6.

### 1.6 Residual infrastructure cleanup

**Why this is rank 6.** Not visible to users, but present in the
build: dead `ThemeProvider` + `ThemeTuningProvider` runtime, dead
`src/components/layout/` stubs, dead `App.css` Vite scaffold,
dead `@keyframes` in `index.css` and `theme.css`, dead Tailwind
extensions (`olive`, `purple.accent`, `gradient-gold`,
`backdropBlur.glass`), dead theme tokens (`--shell-gradient-*`,
`--color-roleAccent-*`, `--color-accent-olive-*`,
`--color-accent-purple`, `--scale-*`, `--shadow-glass*`, glass
bridge classes), deprecated `Product` legacy fields, stale
`BLUEPRINT.md`. Clearing this surface area before R1–R6 prevents
executors from referencing dead infrastructure as patterns.

**Wave.** R0 (gate; runs before R1).

---

## 2. Wave Plan

Refinement waves are prefixed `R` to distinguish from construction
waves (numeric, owned by `EXECUTION_MAP.md`). Dependencies are
strict: a later wave does not begin until the predecessor's
acceptance criteria are met.

```
R0  Residual infrastructure cleanup            ── gate
R1  Typography foundation                      ── R0
R2  Identifier system maturity                 ── R1
R3  Procurement metadata enrichment            ── R2
R4  Imagery strategy                           ── R0  (parallelizable with R1–R3)
R5  Inquiry document realism                   ── R2
R6  Documentation library maturity             ── R3
R7  Empty / loading / error state pass         ── R1, R2
R8  Header / footer / nav polish               ── R1, R2
R9  Accessibility & focus refinement           ── R0
R10 Print / export realism                     ── R5
R11 Production hardening (404, error, SEO)     ── all prior
```

Wave R0 is the only gate. Within R1–R8 several can proceed in
parallel if separate executor lanes are available, with the
dependency edges respected.

### 2.R0 — Residual infrastructure cleanup (GATE)

**Objective.** Remove dead infrastructure so executors cannot
mistake it for a pattern. No visible UI change.

**Scope.**

1. Delete `src/theme/ThemeProvider.tsx`,
   `src/theme/ThemeTuningProvider.tsx`. Update `src/theme/index.ts`
   to export only what survives (likely empty — then delete it).
   Update `src/main.tsx` to drop both providers; render `<App />`
   directly inside `<StrictMode>`.
2. Delete `src/components/layout/Footer.tsx`,
   `src/components/layout/Navbar.tsx`,
   `src/components/layout/Shell.tsx`. Delete the directory.
3. Delete `src/App.css` (Vite scaffold). Verify nothing imports
   it.
4. From `src/index.css`: delete `@keyframes fade-up`,
   `@keyframes shimmer`, `@keyframes glow-breathe`,
   `@keyframes sheet-enter`, `@keyframes modal-enter`, and the
   `.animate-fade-up`, `.animate-glow`, `.animate-sheet`,
   `.animate-modal` utility classes. Delete the `.glass-card`
   class.
5. From `src/theme/theme.css`: delete `--glass-blur*`,
   `--glass-opacity`, `--glass-tint`, `--glass-shadow*`,
   `--shell-gradient-*`, `--color-roleAccent-*`,
   `--color-accent-olive-*`, `--color-accent-purple`,
   `--scale-press*`, `--scale-hover`, `--scale-bg-sheet`,
   `--shadow-glass`, `--shadow-glassHover`, `--shadow-glow`,
   `--blur-sm`, `--blur-md`, `--blur-lg`, `--blur-xl`,
   `--blur-2xl`, `--blur-3xl` (keep only `--blur-precision`),
   `.research-surface-glass` utility, `.glass-themed`,
   `.glass-panel`, `.glow-primary`, `.velari-shell-gradient`.
6. From `tailwind.config.js`: remove `colors.olive`,
   `colors.purple`, `backgroundImage.gradient-gold`,
   `backdropBlur.glass`, `backdropBlur.glass-heavy`,
   `borderRadius.card`, `borderRadius.card-inner`,
   `borderRadius.card-sm` (verify no consumers first).
7. From `src/types/product.ts`: remove the four `@deprecated`
   legacy fields (`description`, `price_cents`, `in_stock`,
   `created_at`). Update `products.json` to drop them.
   Update any reader still referencing them.
8. Delete or replace `BLUEPRINT.md` (currently describes the
   pre-reconciliation consumer-shop architecture). Replace with
   a short pointer to `docs/`.

**Acceptance.** `tsc -b` clean. `vite build` clean. Bundle smaller
(or unchanged). No grep hit for any deleted symbol in `src/`.
No visible UI change.

### 2.R1 — Typography foundation

**Objective.** Activate the second typeface and establish the
typographic scale executors will use throughout R2–R11.

**Architect decision required before executor begins.** Choose
one of the two paths:

- **Path A (recommended):** Inter (sans) + JetBrains Mono (mono).
  Display headings remain Inter `font-light` with tighter
  tracking. All identifiers and numerics adopt mono.
- **Path B:** Inter + JetBrains Mono + a serif for display
  (candidates: GT Sectra, Tiempos Headline, or a libre option such
  as Source Serif 4). Adds editorial gravity at cost of a third
  font import.

This blueprint locks in **Path A** unless the architect lane
overrides. Path A delivers ≥80% of the perceived-quality lift at
a fraction of the cost and risk.

**Scope (Path A).**

1. Add `JetBrains Mono` to the Google Fonts `@import` in
   `src/index.css` (weights 400, 500).
2. Verify `--font-mono` token in `theme.css` resolves correctly.
3. Extend `tailwind.config.js fontFamily`: add `mono: ['JetBrains
   Mono', ...]` so executors can write `font-mono` directly.
4. Define typographic scale tokens (additive in `theme.css`):
   ```
   --type-display:    2.5rem / 1.05 / -0.02em / 300
   --type-h1:         2rem   / 1.1  / -0.02em / 300
   --type-h2:         1.5rem / 1.15 / -0.015em / 300
   --type-h3:         1.125rem / 1.25 / -0.01em / 400
   --type-body-lg:    1.0625rem / 1.55 / 0 / 400
   --type-body:       0.9375rem / 1.55 / 0 / 400
   --type-caption:    0.8125rem / 1.45 / 0 / 400
   --type-eyebrow:    0.6875rem / 1 / 0.3em uppercase / 400
   --type-micro:      0.625rem / 1 / 0.25em uppercase / 400
   --type-mono-sm:    0.8125rem / 1.4 / 0 / 400 (mono)
   --type-mono-xs:    0.6875rem / 1.4 / 0 / 400 (mono)
   ```
5. Document the scale in `docs/REFINEMENT_PHASE_TYPOGRAPHY.md`
   (architect authors after executor preps the tokens).

**Acceptance.** Tokens defined. Mono font loaded. No visible UI
change yet (consumers wired in R2). Lighthouse font-loading
metric does not regress.

### 2.R2 — Identifier system maturity

**Objective.** Apply the mono family and tabular numerics to every
identifier-class and numeric-class string in the system.

**Scope.**

1. Compose `src/components/ui/identifiers.tsx`:
   - `<SkuLabel sku={string} className?=string />` — renders
     mono, `tracking-tight`, no decoration. Optionally accepts
     `copyable` boolean (R5 dependency, deferred).
   - `<BatchId id={string} />` — mono, hairline-tracked.
   - `<DoseValue dose={string} />` — mono for the numeric core,
     sans for the unit suffix (split on first non-digit).
   - `<IssuedDate iso={string} />` — mono, `YYYY-MM-DD`.
   - `<PriceDisplay cents={number|null} />` — mono with
     `tabular-nums`. Renders "Inquire for pricing" (sans) when
     null.
   - `<StockIndicator stock={number|null} />` — see Wave R3 for
     the in-stock/low-stock/on-order vocabulary; this primitive
     handles rendering only.
2. Replace ad hoc renderings:
   - `InventoryRow.tsx`: SKU → `<SkuLabel>`. Dose chip → `<DoseValue>`.
   - `ProductCard.tsx`: SKU → `<SkuLabel>`.
   - `ProductPage.tsx`: SKU in identifier band → `<SkuLabel>`.
     Specs values where numeric → mono inline.
   - `DocumentCard.tsx`: Batch + date → `<BatchId>` + `<IssuedDate>`.
   - `CartPage.tsx`: line item SKU → `<SkuLabel>`. Quantity input
     value → mono numeric.
   - `Catalog.tsx`: result count line → mono numeric.
   - `Documentation.tsx`: count caption → mono numeric.
   - `GlobalHeader.tsx`: cart count chip → mono.
   - `GlobalFooter.tsx`: copyright year already uses
     `tabular-nums`; switch to mono.
3. Compose `src/lib/format.ts`:
   - `formatPrice(cents: number | null): string`
   - `formatStock(n: number | null): { label: string; tone:
     'available' | 'low' | 'on-order' | 'untracked' }`
   - `formatBatchId(s: string): string` (no-op today; reserved)
   - `formatIssuedDate(iso: string): string`
   The primitives in §1 import from this module.

**Acceptance.** Visual diff: SKUs, batch IDs, dates, prices, dose
strings, counts all render in JetBrains Mono. No layout shift on
production routes. `tsc -b` clean.

### 2.R3 — Procurement metadata enrichment

**Objective.** Extend the data schema and seed dataset so the
catalog reads as audited, not improvised.

**Scope.**

1. Extend `src/types/product.ts Product`:
   ```ts
   /** Lot identifier of the most recent batch in stock. */
   lot?: string;
   /** Manufacturer or source of record. Optional. */
   manufacturer?: string;
   /** ISO 3166-1 alpha-2 country of origin. */
   countryOfOrigin?: string;
   /** Storage condition, machine-readable. */
   storage?: 'ambient' | 'refrigerated' | 'frozen' | 'desiccated';
   /** Shelf life in months from manufacture. */
   shelfLifeMonths?: number;
   /** Unit of measure for the inquiry quantity field. */
   unitOfMeasure?: 'vial' | 'bottle' | 'box' | 'unit' | 'kit';
   ```
2. Extend `src/types/document.ts Document`:
   ```ts
   issuer?: string;            /** e.g. "VS Research Labs QC" */
   format?: 'PDF';             /** reserved for future formats */
   pageCount?: number;
   fileSizeBytes?: number;
   expiresAt?: string;         /** ISO date — calibration certs */
   ```
3. Update `products.json`: populate the new fields for all 10
   entries with realistic values. Vary `createdAt` / `updatedAt`
   across multiple weeks (current values are uniformly April
   2026, which itself reads as a placeholder).
4. Update `documents.json`: populate `issuer`, `pageCount` (1–4
   typical), `fileSizeBytes` (~50–400KB realistic for short
   PDFs). For calibration certs, populate `expiresAt`.
5. Surface the new fields:
   - `ProductPage` specs table absorbs `storage`, `shelfLife`,
     `manufacturer`, `countryOfOrigin`, `lot` where present.
   - `InventoryRow` and `ProductCard` remain unchanged in
     density (no new fields surfaced); the data is referenceable
     by inquiry submissions.
   - `DocumentCard` adds a third caption line: `{format} ·
     {pageCount}p · {fileSizeKB}KB` when fields are present.
   - `/documentation` route's count caption (Wave R6 will turn
     this into proper filter UI; for now a richer caption is
     enough).

**Acceptance.** Schema extended additively (no breaking
changes). Data populated. Surfaces render new fields where
present, omit cleanly where absent. No layout regressions.

### 2.R4 — Imagery strategy

**Objective.** Replace `placehold.co` URLs with imagery that
holds the institutional register.

**Architect decision required.** Choose one strategy:

- **Path A (recommended):** Inline SVG specimen plates. Each
  product gets a hand-curated monochrome line drawing (vial,
  syringe, balance, vortex mixer, microcentrifuge, etc.) on a
  neutral background. Document thumbnails get stylized first-
  page renders that mimic real PDF previews (header band, two or
  three lines of placeholder body, signature block).
- **Path B:** Photographic reference plates. Real, controlled,
  restrained product photography on neutral backgrounds.

Path A is recommended for the institutional register, lower
asset cost, and resilience under future product additions. Locks
in unless the architect lane overrides.

**Scope (Path A).**

1. Author 10 product specimen SVGs (one per product). Stored
   under `public/specimens/{abbreviation}.svg`. Single colour
   (white at 65% opacity on transparent), 1.25px stroke, 800×600
   viewBox.
2. Author 6 document thumbnail SVGs (one per `documentType` in
   the `DocumentTypeLabel` union). Stored under
   `public/document-types/{slug}.svg`. 420×560 viewBox to match
   the existing aspect ratio used by `DocumentCard`.
3. Update `products.json images[]` to reference
   `/specimens/{abbreviation}.svg`. Update `documents.json
   thumbnailUrl` to reference `/document-types/{slug}.svg`.
4. Adjust image styling in `ProductCard.tsx`, `ProductPage.tsx`,
   `DocumentCard.tsx` to render SVG at appropriate insets
   (specimens want padding, not `object-cover`).
5. Delete `src/assets/hero.png` (orphan; not referenced post-
   Pass-A).

**Acceptance.** No `placehold.co` URLs anywhere in `src/data/`.
Specimens and document thumbnails render at the same dimensions
as their predecessors. No CLS regression.

### 2.R5 — Inquiry document realism

**Objective.** Convert the post-submit success state on `/cart`
into a procurement intake confirmation that reads as a stamped
document.

**Scope.**

1. Extend `useCart` to support a submission record:
   ```ts
   interface InquirySubmission {
     reference: string;        // e.g. "VSR-INQ-2026-04-0142"
     submittedAt: string;      // ISO timestamp
     items: CartItem[];
     contact: {
       name: string;
       email: string;
       phone?: string;
     };
     organization?: string;
     notes?: string;
   }
   ```
2. Generate `reference` deterministically client-side on submit:
   `VSR-INQ-{YYYY}-{MM}-{NNNN}` where `NNNN` is a 4-digit pseudo-
   sequence derived from a salted hash of `submittedAt + email`.
   This is presentation-only; the canonical reference is whatever
   the backend assigns.
3. Replace the current success state with a structured
   confirmation:
   - **Stamp band**: "Inquiry received" eyebrow, reference number
     in mono, submitted-at date in mono.
   - **Items table**: each line = abbreviation chip · SKU (mono)
     · name · dose · qty (mono). Hairline rows.
   - **Contact + organization summary**: read-only mirror of
     submitted fields.
   - **Notes block** (when present).
   - **Response window line**: "A response will follow within one
     business day."
   - **Print action**: caption-tier "Print confirmation" link
     calling `window.print()`.
4. Add `print.css` rules (in `index.css`, `@media print` block)
   that:
   - hide `<GlobalHeader>`, `<BottomNav>`, `<GlobalFooter>`,
     `print-action`
   - render `<body>` on white with black text
   - force the confirmation block to full width
5. Update empty cart state vocabulary: "No items in inquiry"
   instead of any "your cart is empty" residue. Re-verify Pass D
   already handled this.

**Acceptance.** Submitting `/cart` produces a confirmation that
prints cleanly to PDF/paper as a single page. Reference number
is stable (same submission produces the same reference if
inputs are identical, modulo timestamp). No marketing language
in any state.

### 2.R6 — Documentation library maturity

**Objective.** Turn `/documentation` from a static gallery into a
filterable archive with per-document detail.

**Scope.**

1. Add filter UI to `/documentation`:
   - Family pill tabs (reuse `PillTabs`): All · Peptide · Solvent ·
     Consumable · Instrument. Derived from the products' `family`
     field via the abbreviation join.
   - Document-type pill tabs (second row): All · COA · HPLC · MS ·
     Sterility · Endotoxin · Calibration.
   - Date range: leftmost selector with "Past 30 days · Past 90
     days · Past year · All time". Mono date display.
2. Wire filtering in a derivation hook
   `src/hooks/useDocuments.ts` that returns the filtered set.
3. Per-document detail surface. Two viable shapes:
   - **A: Inline expander row** under the card.
   - **B: Peer route `/documentation/:id`.**
   Architect decision: lock in **B** (peer route) for procurement
   credibility — documents should have addressable URLs.
4. New page `src/pages/DocumentDetail.tsx`:
   - Identifier band: document type · batch ID · issued date.
   - Document preview area: large thumbnail with `aria-hidden`
     decorative caption "Preview only — full document available
     on inquiry."
   - Metadata table: issuer, format, page count, file size,
     expiration (if present), associated SKU (link to product).
   - "Request this document" CTA that pre-fills `/cart` notes
     with the batch reference (or directly opens `/contact`).
5. Add cross-links: `ProductPage` gains a "Documentation" sub-
   section listing documents whose `productAbbreviation` matches.
   Reuses `DocumentGallery` with filtered set.

**Acceptance.** Filters work. Per-document URL renders. Empty
states present. No filter UI competes with the catalog page's
visual rhythm — same `PillTabs` style, same hairline grammar.

### 2.R7 — Empty / loading / error state pass

**Objective.** Codify a single voice across every state.

**Scope.**

1. Compose `src/components/ui/EmptyState.tsx`:
   ```tsx
   <EmptyState
     eyebrow="Catalog"
     headline="No matching SKUs"
     body="Adjust filters or open an inquiry for custom configurations."
     action={{ label: 'Open an inquiry', to: '/cart' }} // optional
   />
   ```
2. Compose `src/components/ui/ErrorState.tsx` with the same
   shape but reserved tone ("Inventory could not be loaded.
   Refresh, or contact procurement.").
3. Replace inline empty/error renderings in: `Catalog.tsx`,
   `ResearchSupplies.tsx`, `LaboratoryEquipment.tsx`,
   `Documentation.tsx`, `DocumentGallery.tsx` (empty branch),
   `ProductGrid.tsx`, `CartPage.tsx` (empty cart).
4. Audit skeleton timing. Currently skeletons appear immediately.
   Introduce `min-show 200ms / debounce 150ms` so brief loads
   don't flash the skeleton.

**Acceptance.** Vocabulary uniform. No "Oops!" or "Sorry!" or
"Something went wrong." anywhere. Skeleton does not flash on
sub-200ms loads.

### 2.R8 — Header / footer / nav polish

**Objective.** Final calibration on global chrome.

**Scope.**

1. **Logotype** in `GlobalHeader`. Currently "VS RESEARCH LABS"
   in default sans. Architect to evaluate after R1 lands —
   options: same Inter at refined tracking (`tracking-[0.35em]`,
   `font-light`), or a custom-tuned wordmark SVG. Default to
   Inter refinement unless overridden.
2. **Cart chip** in `GlobalHeader`. Currently small `rounded-sm`
   institutional chip. Update to mono digit with `tabular-nums`
   so a 2-digit count and 1-digit count occupy the same width.
3. **BottomNav icons**. Re-author with consistent stroke
   (1.5px), consistent corner radius, consistent visual weight.
   Ship as part of the icon consolidation (R0.c if pulled
   forward, otherwise R8).
4. **GlobalFooter**. Add a third caption row (optional, behind
   architect approval) with regulatory identifier or business
   address — only if the user provides real values. Otherwise
   hold current shape.

**Acceptance.** No regressions on accessibility. Header height
unchanged. Footer height unchanged or +1 line if regulatory row
approved.

### 2.R9 — Accessibility & focus refinement

**Objective.** Procurement-grade keyboard and screen-reader UX.

**Scope.**

1. Audit focus rings. Standardise on
   `focus-visible:ring-1 focus-visible:ring-white/40
   focus-visible:ring-offset-2 focus-visible:ring-offset-black`
   for buttons and inputs; `focus-visible:outline-none
   focus-visible:[&>...]:ring-1 ...` patterns on links wrapping
   surfaces.
2. Skip links at top of `<body>`: "Skip to inventory", "Skip to
   inquiry intake".
3. Live regions:
   - InventoryRow + ProductPage inquiry-add: `<div
     aria-live="polite" className="sr-only">{addedToInquiryMessage}</div>`
     so screen reader announces the action.
   - CartPage submission state changes announced.
4. Reduced motion verification (already partially present in
   `theme.css`); confirm chevron `translate-x-0.5` respects it.
5. Color contrast verification. Audit `text-white/35`,
   `text-white/40` against `#000` background — these are at the
   edge of WCAG AA for non-large text. Where a string is
   primary content (not decorative), promote to `/55` minimum.
   Where decorative (eyebrows, captions), `/40` permitted with
   `aria-hidden` on purely decorative cases.

**Acceptance.** Lighthouse a11y score ≥ 95. Manual screen reader
walk of catalog → product → add to inquiry → cart → submit
produces a coherent narrative.

### 2.R10 — Print / export realism

**Objective.** Inquiry confirmations and per-document detail
print as procurement documents.

**Scope.**

1. Print stylesheet covering `/cart` (success state),
   `/documentation/:id`, `/product/:id`. White background, black
   text, hide chrome, force serif body if Path B from R1 was
   chosen, otherwise force `font-sans` with print-friendly
   sizing.
2. Optional: CSV/Markdown export of the current inquiry from
   `/cart` (caption-tier "Export draft" link). Generates a plain-
   text procurement-ready inquiry with SKUs, dose tiers, and
   notes. Reserved — architect to confirm scope.

**Acceptance.** `Cmd+P` on `/cart` (success) produces a clean
single-page document. No background colours bleed. No icons bleed.

### 2.R11 — Production hardening

**Objective.** Final pre-deploy pass.

**Scope.**

1. **Not-found route.** `<Route path="*" element={<NotFound />}/>`.
   `NotFound` is a procurement-grade 404: eyebrow "Not found" ·
   h1 "This route does not exist" · single body sentence · link
   to `/catalog` and `/contact`.
2. **Error boundary.** Top-level boundary in `App.tsx` wrapping
   `<Routes>`. Procurement-grade error surface with reload action
   and a quiet caption-tier "If this persists, open a procurement
   inquiry" link.
3. **Initial app shell** during JS load. Add a static skeleton
   to `index.html` that matches the GlobalHeader + main column
   bounds so first paint is not a flash of unstyled content.
4. **SEO meta** in `index.html`. Title, description, OG tags
   tuned to procurement positioning. No marketing meta.
5. **Lighthouse pass.** LCP < 2.5s mobile, CLS < 0.05, a11y ≥ 95,
   best practices ≥ 95.
6. **Bundle audit.** Verify R0 cleanup actually shipped
   (`framer-motion`, `gsap`, `class-variance-authority` absent
   from build manifest).
7. **Disclaimer review.** Architect lane reviews
   `LegalDisclaimer.tsx` against actual jurisdiction
   requirements with the user's counsel before launch.

**Acceptance.** Production deploy gate. All metrics met.

---

## 3. Acceptance Criteria Framework

Every wave completes against four lenses. Executors do not call a
wave done until all four pass.

1. **Visual coherence.** No new color, surface, motion, or
   typography pattern outside the approved set. Diff screenshots
   reviewed by the architect lane.
2. **Vocabulary discipline.** Grep across `src/` for every term in
   the §0.6 forbidden list returns zero results. Approved
   vocabulary is propagated where applicable.
3. **Code health.** `tsc -b` clean. `vite build` clean. No new
   ESLint warnings. Bundle size monitored — refinement waves
   should generally reduce or hold bundle size, not grow it.
4. **Operational realism.** New surfaces, vocabulary, and metadata
   read as procurement, not as design exercise. Tested by reading
   the surface aloud and asking: would a procurement manager file
   this in their reconciliation folder?

---

## 4. Open Strategic Questions

Architect lane resolves these as their corresponding waves
approach. Executors do not begin a wave until its open question
is closed.

1. **R1 path.** Path A (Inter + JetBrains Mono) recommended.
   Architect to confirm or override before R1 starts.
2. **R4 path.** Path A (vector specimens) recommended. Architect
   to confirm. If Path B (photography), executor lane requires a
   separate image-asset spec.
3. **R6 detail surface.** Locked to peer route
   `/documentation/:id`. Confirm.
4. **R8 logotype.** Default to Inter refinement. Architect may
   override with a wordmark SVG spec.
5. **R8 footer regulatory row.** Requires real regulatory ID or
   business address from the user. Without that, hold current
   shape.
6. **R10 export format.** CSV vs Markdown vs both — architect to
   decide once R5 lands.

---

## 5. Companion Documents

- `docs/REFINEMENT_PHASE_AUDIT.md` — current-state visual
  maturity audit, dimension by dimension, anchored to file
  paths. Authored alongside this blueprint.
- `docs/REFINEMENT_PHASE_TYPOGRAPHY.md` — to be authored by
  architect lane between R0 and R1, formalising the type scale
  tokens and per-surface mappings.
- `docs/REFINEMENT_PHASE_IMAGERY.md` — to be authored before R4,
  formalising the specimen drawing brief.
- Per-wave executor briefs may be authored as
  `docs/wave-R{n}-spec.md` if a wave expands beyond what this
  document specifies.

---

## 6. Phase Closing Disposition

This phase ends when:

- All R0–R11 acceptance criteria are met
- The system passes the operational-realism read-aloud test on
  every public-facing surface
- A procurement manager unfamiliar with the system can complete
  an inquiry without encountering vocabulary or motion that
  reads as consumer-app
- `BLUEPRINT.md` (or its replacement) accurately describes the
  procurement system as built

After this phase: backend integration (Supabase, real inquiry
submission, admin CRUD hardening). That is a separate phase, not
covered by this document.
