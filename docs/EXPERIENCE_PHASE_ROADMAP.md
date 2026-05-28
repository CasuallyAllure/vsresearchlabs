# Experience + Operational Systems Phase — Execution Roadmap
## VS Research Labs · Post-Refinement Phase

**Phase Mandate:**
Every wave must produce at least one of: visible advancement, operational advancement, admin capability, content capability, media capability, or workflow capability. Subtractive-only waves are not authorized unless directly tied to capability delivery.

**Target:**
High-end operational research platform. Advanced institutional infrastructure. NOT a minimal procurement template.

---

## Visual Experience Recovery — Design DNA Restoration

### The Drift Diagnosis

The R0–R11 procurement filter was applied too aggressively. Valid eliminations:
- Consumer-app vocabulary
- Flashy hover effects, scale-on-hover
- Glass morphism, backdrop-blur
- Consumer funnel motion

Unintended eliminations:
- Surface depth and dimensional hierarchy
- Specimen imagery impact (SVG background matches container — no contrast, no presence)
- Modular visual sophistication
- Landing page visual anchors
- Velari DNA: layered composition, premium typographic intelligence, atmospheric structure

### What Returns (Procurement-Compatible)

**Surface depth.** Level 0 → Level 1 → Level 2 must be perceptibly distinct through luminance variation and border treatment, not glass or blur.

**Specimen illustrations as visual anchors.** Each specimen SVG's internal background currently matches the page surface exactly (`#0a0a0a`). This eliminates depth. The fix: introduce a controlled luminance offset (`#111` or `#0d0d0d` container background vs. SVG background) so specimens read as placed objects with depth, not merged surfaces.

**Module architecture as sophistication.** Expandable information modules are more sophisticated than flat row dumps. The architecture itself carries the visual statement.

**Gold precision returns.** Gold currently appears only on the primary CTA. In the recovered system it appears as a precision accent in module headers, status indicators, and data identifiers — sparingly, but at more locations.

**Landing presence.** The hero is currently a text paragraph. It needs one visual anchor: a featured product specimen + identifier block.

### What Does NOT Return
- Glass morphism / backdrop-filter
- Scale-on-hover cards
- Consumer CTAs or vocabulary
- Gradient backgrounds behind text
- Decorative ambient elements
- Drop shadows on text
- Dashboard data visualizations

---

## Execution Tracks

### EXPERIENCE TRACK — E-Series

---

#### E1 — Specimen Depth Restoration [IMMEDIATE · HIGHEST VISUAL ROI]
**Produces:** Visual anchor depth, specimen-plate identity

**Problem:** Specimen SVGs render flat because the SVG's internal `fill="#0a0a0a"` background matches the page surface exactly. No contrast, no depth, no presence.

**Fix:**
- ProductCard image container: change `bg-base-800` (`#0a0a0a`) to `bg-[#070707]` — creates a perceptible depth shelf behind the specimen
- ProductPage main image: same treatment, add `ring-1 ring-inset ring-white/[0.04]` for a contained surface feel
- Optionally: regenerate 2–3 flagship specimens with richer blueprint detail (more measurement annotations, title block, cross-section callouts) to elevate the strongest visual anchors

No structural changes. Immediate visible result.

---

#### E2 — Surface Depth Restoration [HIGH PRIORITY]
**Produces:** Dimensional hierarchy, platform depth

The procurement filter set `--color-surface-elevated: #0a0a0a` for Level 2, identical to Level 1 and base. All surface levels currently render at the same luminance. This is the root cause of the "flat procurement template" feel.

**Fix:**
- Level 0 (base/page): `#000000` — preserved
- Level 1 (`.research-surface-solid`): `#090909` — introduce subtle offset
- Level 2 (`.research-surface-elevated`): `#111111` — perceptible lift
- Hairline borders: upgrade from `rgba(255,255,255,0.06)` to `rgba(255,255,255,0.08)` on Level 1, `rgba(255,255,255,0.1)` on Level 2
- ProductCard: add `shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]` — subtle inner top highlight

This restores depth hierarchy without any structural changes. The page stops reading as a flat document.

---

#### E3 — Advanced Product Module Architecture [HIGH PRIORITY]
**Produces:** Expandable information system, visible sophistication, future-ready surface

The ProductPage currently dumps all metadata as flat labeled rows. Restructure as collapsible panels — each module has a distinct visual identity, expand/collapse state, and grouped content.

**Module structure:**
```
[ MODULE HEADER ─────────────── CHEVRON ]
  content panel (animated collapse)
```

**Modules:**

| Module | Content | Default State |
|--------|---------|---------------|
| Technical Specifications | Current `specs` dl rows | Expanded |
| Procurement Details | Lot, manufacturer, origin, testing, shipping, lead time, shelf life | Expanded |
| Regulatory & Compliance | CAS number, molecular weight, testing standard, safety classification | Collapsed |
| Storage & Handling | Storage condition, temperature, packaging, reconstitution notes | Collapsed |
| Research Context | `longDescription`, mechanism notes, usage guidance | Collapsed |
| Associated Documentation | Doc cards, moved from bottom of page into module | Collapsed |

**Implementation notes:**
- Module state: local `useState`, no persistence needed
- Expand/collapse: `max-height` transition with `overflow-hidden` — CSS-only, no library
- Module header: `text-[10px] uppercase tracking-[0.25em] text-white/40` + gold chevron on hover
- Each module is a self-contained component: `<ProductModule label="..." defaultOpen={bool}>`

**Visual result:** ProductPage transforms from a procurement form into an advanced information system. Modules create explicit depth layers — the page becomes navigable, not just scrollable.

---

#### E4 — Landing Visual Evolution [PLATFORM PRESENCE]
**Produces:** Strong first impression, Velari DNA in hero, featured inventory surface

**Current landing:** Hero is a text paragraph. No visual anchors. Categories are typeset rows.

**Recovery targets:**

**Hero:** Add a flagship product specimen tile (right column) at `lg:` breakpoint. Single featured product — specimen illustration + identifier band (abbreviation chip, name, SKU). The hero becomes a two-column composition: identity statement + inventory preview.

**Featured inventory strip:** 3 featured products (`featured: true`) rendered in a richer card format above the category index — specimen-first layout, not metadata-first.

**Category rows:** Add right-side product count + a subtle visual weight marker (thin left border accent in gold at very low opacity). Makes the category index feel curated rather than listed.

**PositioningBlock:** Add a thin left-border accent module for each positioning statement. Gives the block dimensional presence.

---

#### E5 — Media/Video Module System [ADVANCED PRODUCT EXPERIENCE]
**Produces:** Media-capable product surfaces, platform tier lift

Extend product data model:
```typescript
mediaModules?: {
  type: 'video' | 'technical-diagram' | 'reference-image';
  url: string;
  caption?: string;
  thumbnail?: string;
  annotationPoints?: { x: number; y: number; label: string }[];
}[];
```

**Rendering:**
- `video`: embedded iframe with institutional header bar (channel name, reference code) — not a raw YouTube embed
- `technical-diagram`: zoomable SVG viewer with pinch/scroll, annotation callouts
- `reference-image`: lightbox viewer with optional annotation overlay

**Placement:** between image gallery and info column on ProductPage, or as a dedicated expandable `<ProductModule>`.

**Admin:** media module editor in AdminEdit — add/remove/reorder modules.

---

### OPERATIONAL TRACK — O-Series

---

#### O1 — Admin Authentication [REQUIRED BEFORE FURTHER ADMIN INVESTMENT]
**Produces:** Real admin access control, closes CR-3

Replace `VITE_ADMIN_PASSPHRASE` with Supabase Auth (email magic link).

- `AdminGate.tsx` rewritten: uses `supabase.auth.getSession()` + `onAuthStateChange`
- Magic link sent via `supabase.auth.signInWithOtp({ email })`
- Session stored in Supabase's default localStorage mechanism
- `/admin` routes redirect to login if no session
- Remove `VITE_ADMIN_PASSPHRASE` from `.env.example`
- No new DB tables (uses Supabase built-in auth schema)

---

#### O2 — Admin Inquiry Inbox [HIGH OPERATIONAL VALUE]
**Produces:** Real procurement workflow, admin inquiry lifecycle management

**Routes:**
- `/admin/inquiries` — paginated list: reference ID, name/org, item count, status, submitted date
- `/admin/inquiries/:id` — full detail: contact info, all line items with SKU/qty/notes, status control, internal admin notes

**Status transitions (OPEN → REVIEWING → RESPONDED → CLOSED):**
- Status dropdown on detail page
- Optimistic update + Supabase patch
- Status badge colors: `OPEN` white/50, `REVIEWING` amber, `RESPONDED` emerald, `CLOSED` white/25

**Reply:** `mailto:` link pre-filled with: `To: {contact}`, `Subject: RE: Inquiry {referenceId}` — no custom email sender needed. Sufficient for operational use.

**Internal notes:** textarea saved to `inquiries.notes` column. Not shown to submitter.

---

#### O3 — Inventory Persistence [DATABASE MIGRATION]
**Produces:** Real data foundation, admin-editable inventory, closes CR-2

Move products from JSON to Supabase `products` table. Hooks already forward-compatible (loading/error stubs → real queries).

**Schema:** matches existing `Product` type fields — `id`, `slug`, `name`, `category`, `sku`, `abbreviation`, `family`, `images` (text[]), `specs` (jsonb), `variants` (jsonb), all procurement metadata columns.

**Hook changes:** `useProducts` and `useProduct` query Supabase instead of importing JSON. No component changes required.

**Admin:** real product CRUD through AdminEdit. Expose all procurement fields currently absent from the form (abbreviation, family, variants, batchReference, lotNumber, casNumber, molecularWeight, testingStandard).

---

#### O4 — Document Storage [REAL DOCUMENT SYSTEM]
**Produces:** Uploadable/downloadable document archive, closes document fake-system

- Supabase Storage bucket `documents` for PDF files
- `documents` table in DB: id, slug, title, type, status, file_path, product_abbreviation references, metadata
- Admin upload: drag-drop PDF → Storage → DB record
- DocumentDetail: real signed URL for PDF download (currently no-op)
- Replaces `src/data/documents.json`

---

#### O5 — Full Admin Content System [COMPLETE OPERATIONAL CAPABILITY]
**Produces:** Content management for all platform surfaces

**Depends on O3 + O4 complete.**

- Product create/archive (not delete — preserve inquiry history)
- Document upload/edit/archive
- Product media module management (E5 dependency)
- Batch/lot number updates
- Featured product management (controls E4 landing strip)
- Inventory status flags

---

## Priority Sequence

```
IMMEDIATE (production visual ROI, no structural risk):
  1. E1 — Specimen Depth Restoration
  2. E2 — Surface Depth Restoration

HIGH PRIORITY (structural but contained):
  3. E3 — Advanced Product Module Architecture
  4. O1 — Admin Authentication

BUILDS ON ABOVE:
  5. O2 — Admin Inquiry Inbox (needs O1)
  6. E4 — Landing Visual Evolution
  7. E5 — Media/Video Module System

DATABASE MIGRATIONS (larger scope, authorization required):
  8. O3 — Inventory Persistence
  9. O4 — Document Storage
 10. O5 — Full Admin Content System (needs O3 + O4)
```

---

## Wave Authorization Protocol

Each O-series and E3+ wave requires explicit authorization before beginning. E1 and E2 are pre-authorized as immediate corrections. After each wave:

1. `tsc -b` — TypeScript clean
2. `vite build` — build clean
3. Visual verification in dev server

---

## North Star Check (every wave)

> "Does this feel more like **advanced research infrastructure** and less like **minimal procurement template**?"

If no — the wave is not complete.
