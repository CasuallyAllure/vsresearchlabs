# EXECUTION MAP
## VS Research Labs — Implementation Roadmap

**Version:** 1.0  
**Status:** Active  
**Parent document:** `docs/COMPOSITION_SYSTEM_BLUEPRINT.md`  
**Scope:** Waves 1–6 implementation sequencing

> Operational reference only. For architectural rationale, surface values, and design philosophy, see the blueprint. This document answers: "what do I do next, in what order, and what must I not break."

---

## 1. CURRENT PROJECT PHASE

### Phase Status

| Layer | Status | Notes |
|---|---|---|
| CSS token system | ✅ Complete | `src/theme/theme.css` — all variables defined |
| Tailwind config | ✅ Complete | Identical to VelariNights source |
| ThemeProvider | ✅ Complete | Simplified single-preset version is correct |
| ThemeTuningProvider | ✅ Complete (scaffold) | Forward-compatible stub, no action needed |
| Shell architecture | ✅ Complete | GlobalSurface / GlobalHeader / AnimatedPortalShell / BottomNav |
| Landing page | ✅ Complete | Do not touch |
| Contact page | ✅ Complete | Do not touch |
| UI primitives (partial) | 🔶 In progress | Button/Badge/Chip/Modal exist but need upgrades |
| `src/lib/utils.ts` | ❌ Missing | Blocking dependency for all Wave 2+ work |
| Module composition system | ❌ Missing | ModuleShell, VelariShell, ModuleContent, ModuleHeader |
| ProductCard containment | ❌ Missing | Cards are image + loose text, no surface |
| PillTabs | ❌ Missing | No filter/tab switching UI exists |
| CartPage module structure | ❌ Missing | Flat single-column layout |
| ProductPage info panel | ❌ Missing | Desktop info column uncontained |
| Shell chrome refinement | ❌ Deferred | Header/BottomNav blur (Wave 6) |

### What Is Intentionally Deferred

Do not implement, discuss, or scaffold any of the following during Waves 1–6:

- Authentication, login, user profiles
- Invoice generation, payment processing
- Order management, fulfillment workflows
- Advanced search or faceted filtering
- Admin expansion beyond current CRUD stubs
- Multi-theme system (tech/industrial/retro95 presets)
- NoiseBackground atmospheric effects
- BottomNav route-role switching

### Success Definition for Current Phase

The current phase (Waves 1–6) is complete when:

1. `npm run build` produces zero errors across all waves
2. Every product card is a visually bounded solid-surface object
3. Catalog pages have a working PillTabs filter bar
4. CartPage has a 2-column desktop layout (items + glass inquiry panel)
5. ProductPage info column has solid surface containment on desktop
6. GlobalHeader has `bg-black/80 backdrop-blur-sm`
7. Mobile experience is verified at 390px on all pages
8. Landing and Contact pages are visually unchanged from their current state

---

## 2. IMPLEMENTATION WAVES

### Wave 1 — Infrastructure
**Complexity:** Low | **Risk:** Zero | **Visual impact:** None

**Objective:** Create the foundational utilities that all subsequent waves require. No user-facing changes.

| Action | File | Change type |
|---|---|---|
| CREATE | `src/lib/utils.ts` | New file — `cn` utility |
| PATCH | `src/theme/theme.css` | Append research surface tokens + utility classes |
| INSTALL | `@radix-ui/react-slot` | npm install OR remove asChild from Button source |

**`src/lib/utils.ts` — exact content:**
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**`src/theme/theme.css` — exact block to append:**
```css
/* ─── Research surface tokens ─── */
:root {
  --surface-product: rgba(255, 255, 255, 0.03);
  --surface-product-hover: rgba(255, 255, 255, 0.055);
  --surface-elevated-research: rgba(255, 255, 255, 0.055);
  --surface-cta: rgba(255, 255, 255, 0.05);
  --border-product: rgba(255, 255, 255, 0.09);
  --border-product-hover: rgba(255, 255, 255, 0.15);
  --border-cta: rgba(255, 255, 255, 0.15);
  --blur-precision: 8px;
}

/* ─── Research surface utility classes ─── */
.research-surface-solid {
  background-color: var(--surface-product);
  border: 1px solid var(--border-product);
  border-radius: var(--radius-card);
  transition:
    background-color var(--duration-fast) var(--easing-easeInOut),
    border-color var(--duration-fast) var(--easing-easeInOut);
}
.research-surface-solid:hover {
  background-color: var(--surface-product-hover);
  border-color: var(--border-product-hover);
}
.research-surface-elevated {
  background-color: var(--surface-elevated-research);
  border: 1px solid var(--border-product-hover);
  border-radius: var(--radius-card);
}
.research-surface-glass {
  background-color: var(--surface-cta);
  backdrop-filter: blur(var(--blur-precision));
  -webkit-backdrop-filter: blur(var(--blur-precision));
  border: 1px solid var(--border-cta);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-glass);
  transition:
    border-color var(--duration-fast) var(--easing-easeInOut),
    box-shadow var(--duration-fast) var(--easing-easeInOut);
}
.research-surface-glass:hover {
  border-color: rgba(255, 255, 255, 0.20);
  box-shadow: var(--shadow-glassHover);
}

/* ─── VN-origin utility classes (required by transplanted primitives) ─── */
.bg-surface-base      { background-color: var(--color-surface-base); }
.bg-surface-elevated  { background-color: var(--color-surface-elevated); }
.bg-surface-overlay   { background-color: var(--color-surface-overlay); }
.text-content-primary   { color: var(--color-content-primary); }
.text-content-secondary { color: var(--color-content-secondary); }
.text-content-tertiary  { color: var(--color-content-tertiary); }
.border-default { border-color: var(--color-border-default); }
.border-subtle  { border-color: var(--color-border-subtle); }
.border-strong  { border-color: var(--color-border-strong); }
```

**Prerequisites:** None. This wave has no dependencies.

**Regression risk:** Zero. Purely additive.

**Validation checklist:**
- [ ] `src/lib/utils.ts` exists and exports `cn`
- [ ] `npm run build` passes with zero errors
- [ ] Open browser DevTools → Elements → `:root` computed styles → confirm `--surface-product`, `--blur-precision`, `--border-product` are present
- [ ] Confirm `.research-surface-solid` class appears in the compiled stylesheet
- [ ] No existing visual is changed (Landing, Contact, catalog pages look identical)

---

### Wave 2 — ProductCard Module Containment
**Complexity:** Medium | **Risk:** Low | **Visual impact:** High

**Objective:** Extract `ProductCard` from `ProductGrid.tsx` into a standalone component with solid surface containment. Highest-impact single change — converts image regions into bounded objects.

| Action | File | Change type |
|---|---|---|
| CREATE | `src/components/catalog/ProductCard.tsx` | New file — extracted + module-wrapped card |
| MODIFY | `src/components/ProductGrid.tsx` | Import new ProductCard; remove inline ProductCard definition |

**`ProductCard.tsx` component contract:**

```typescript
// Location: src/components/catalog/ProductCard.tsx
// Props: same as existing inline version
interface ProductCardProps {
  product: Product;
}
```

**Visual structure:**
```
<Link> wrapping:
  <div className="research-surface-solid overflow-hidden group">
    <div className="aspect-square w-full overflow-hidden bg-base-800">
      <img ... className="... group-hover:scale-[1.03]" />
      | or placeholder div |
    </div>
    <div className="border-t border-white/[0.06] px-4 py-3 space-y-1">
      <h3 className="text-sm font-medium text-white tracking-tight truncate group-hover:text-gold transition-colors">
      <p className="text-xs text-white/45 line-clamp-2 leading-relaxed">
    </div>
  </div>
```

**Key implementation notes:**
- The `<Link>` wraps the entire `research-surface-solid` div — the whole card is the tap target
- `group` on the outer div enables `group-hover:` on inner children
- `overflow-hidden` on the outer container clips the image to the card radius
- Image is flush to top — no top padding inside the card
- Content section uses inline padding (`px-4 py-3`) not ModuleContent (avoid the extra import for this simple structure)
- Hover: border/bg handled by `.research-surface-solid:hover` CSS rule
- Hover: image scale and name→gold handled by existing Tailwind group-hover classes

**Loading skeleton (for state="loading"):**
```
<div className="research-surface-solid overflow-hidden">
  <div className="aspect-square w-full bg-white/[0.06] animate-pulse" />
  <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
    <div className="h-3 bg-white/[0.06] rounded animate-pulse w-3/4" />
    <div className="h-3 bg-white/[0.06] rounded animate-pulse w-1/2" />
  </div>
</div>
```

**`ProductGrid.tsx` change:** Remove the inline `ProductCard` function (lines ~64–103) and import from `../catalog/ProductCard`.

**Prerequisites:** Wave 1 complete (though `cn` is not used by ProductCard — Wave 1 still required to be validated first).

**Regression risk:** Low.
- Grid layout: zero risk — `ProductGrid` manages the grid unchanged
- Routing: `<Link>` behavior unchanged
- Loading/error/empty states in `ProductGrid`: unchanged
- The only thing changing is how an individual card visually renders

**Validation checklist:**
- [ ] Both `/research-supplies` and `/laboratory-equipment` render correctly
- [ ] Mobile (390px): cards are full-width, solid surface visible, image + content section separated by hairline
- [ ] SM (640px): 2-up grid, cards align correctly, no height mismatch
- [ ] LG (1024px): 3-up grid, solid surface distinguishable from black background
- [ ] Hover: card surface brightens, image scales, name turns gold — all three transitions fire
- [ ] Loading state: skeleton renders within card bounds, not full-page spinner
- [ ] Empty state: text renders correctly
- [ ] Clicking a card navigates to the correct product detail route
- [ ] Landing page: unchanged

---

### Wave 3 — PillTabs Filter Bar
**Complexity:** Low-Medium | **Risk:** Low | **Visual impact:** Medium

**Objective:** Add a PillTabs filter bar above the product grid on both catalog pages. Introduces the clearest app-native signal currently absent from the UI.

| Action | File | Change type |
|---|---|---|
| CREATE | `src/components/ui/PillTabs.tsx` | New file — transplanted + research-adapted |
| MODIFY | `src/pages/ResearchSupplies.tsx` | Add PillTabs + filter state |
| MODIFY | `src/pages/LaboratoryEquipment.tsx` | Add PillTabs + filter state |

**`PillTabs.tsx` research-adapted values:**
```
Container:    bg-white/[0.04] backdrop-blur-sm border border-white/[0.09] rounded-2xl p-1.5
Active pill:  bg-white/[0.08] text-white rounded-xl shadow-sm
Inactive pill: text-white/55 hover:text-white/80 transition-colors
Font size:    text-xs
```

**Initial tab definitions for both catalog pages:**
```typescript
const filterTabs = [
  { id: 'all',         label: 'All' },
  { id: 'in-stock',    label: 'In Stock' },
  { id: 'new',         label: 'New Arrivals' },
];
```

**Filter logic scope for Wave 3:** Visual only. The active tab state updates the PillTabs active indicator. Actual product filtering (passing `filter` to `useProducts`) can be wired in the same pass IF `useProducts` supports it cleanly. If it requires hook changes, leave filtering as a stub and wire in Wave 3b. Do not modify `useProducts.ts` without first reading it completely.

**Page insertion point:**
```
[existing header section — unchanged]
[hairline divider — existing]
<PillTabs tabs={filterTabs} activeId={filter} onChange={setFilter} />
[ProductGrid — unchanged]
```

**Prerequisites:** Wave 1 complete. Wave 2 complete (recommended for clean visual context, not technically required).

**Regression risk:** Low. Insertion only — no existing code modified except adding PillTabs between header and grid.

**Validation checklist:**
- [ ] PillTabs renders between page header and product grid on both catalog pages
- [ ] Active tab has visible selected state (brighter pill)
- [ ] Tab switching transition is smooth (`var(--duration-fast)`)
- [ ] PillTabs container does not visually compete with page header or product grid
- [ ] Mobile: PillTabs fits within the 390px column, wraps gracefully if needed
- [ ] PillTabs does NOT render on Landing, Contact, ProductPage, or CartPage

---

### Wave 4 — CartPage Module Restructure
**Complexity:** High | **Risk:** Medium-High | **Visual impact:** High

**Objective:** Convert CartPage from flat single-column layout to 2-column module-composed layout on desktop, with solid/glass surface containment on both mobile and desktop.

| Action | File | Change type |
|---|---|---|
| MODIFY | `src/pages/CartPage.tsx` | Significant layout restructure — read fully before touching |

**Pre-implementation requirement:** Read `CartPage.tsx` completely before making any changes. Understand every state branch: `success`, `items.length === 0`, and the default list+form state. The restructure applies ONLY to the default state. Success and empty states are unchanged.

**Layout restructure — default state only:**

```
BEFORE (all states, single column):
  [header]
  [items list — hairlines]
  [form — flat]

AFTER (default state, responsive):
  [page header — flat, unchanged]
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-[var(--space-6)]">
    <div className="lg:col-span-8">
      <div className="research-surface-solid overflow-hidden">
        <ul className="divide-y divide-white/[0.06]">
          {/* existing item rows — markup unchanged */}
        </ul>
      </div>
    </div>
    <div className="lg:col-span-4">
      <div className="research-surface-glass lg:sticky lg:top-[calc(56px+var(--space-4))] p-[var(--space-6)]">
        {/* existing form markup — unchanged */}
      </div>
    </div>
  </div>
```

**Critical rules for Wave 4:**
1. ALL existing state logic (`name`, `contact`, `notes`, `touched`, `notesOpen`, `submit`, `formInvalid`) is untouched
2. ALL existing form handlers (`handleSubmit`, `handleIncrement`, `handleDecrement`, `toggleNote`, `setItemNote`) are untouched
3. The item list `<ul>` moves inside the solid surface wrapper — the `border-t` on the `<ul>` may be removed since the surface wrapper defines the outer boundary. Internal item rows keep `border-b border-white/[0.06]`
4. The `lg:sticky` on the form column requires `top-[calc(56px+var(--space-4))]` — 56px = GlobalHeader height
5. On mobile, `lg:sticky` has no effect — stacking order (items above form) is correct
6. The success state and empty state render outside the grid entirely — no change to those branches

**Prerequisites:** Waves 1, 2, and 3 must be complete and validated. Wave 4 is the highest-complexity wave — do not rush into it.

**Regression risk:** Medium-High. All existing form functionality must be tested end-to-end after this wave.

**Validation checklist:**
- [ ] Mobile (390px): items module renders above form module, both have correct surfaces
- [ ] Desktop (1024px): 2-column layout, items on left (8 cols), form on right (4 cols)
- [ ] Form submit works: name + contact filled → send → success state renders
- [ ] Form validation works: empty submit shows name/contact errors
- [ ] Quantity increment/decrement work correctly
- [ ] Remove item works correctly
- [ ] Per-item note toggle works correctly
- [ ] Success state: unchanged from current (flat, centered, no module)
- [ ] Empty state: unchanged from current (or updated per blueprint spec)
- [ ] Glass surface on form panel: backdrop-filter visible in browser DevTools
- [ ] ONLY the form panel uses glass — no other glass on the page
- [ ] Sticky form column on desktop: form stays visible when items list is long

---

### Wave 5 — ProductPage Info Panel (Desktop Only)
**Complexity:** Low-Medium | **Risk:** Low | **Visual impact:** Medium (desktop only)

**Objective:** Apply solid surface containment to the product info column on desktop. Zero mobile changes.

| Action | File | Change type |
|---|---|---|
| MODIFY | `src/pages/ProductPage.tsx` | Add `lg:` surface classes to info column + spec block only |

**Surgical change — info column wrapper:**

Find the `<div className="lg:col-span-5 flex flex-col">` and add surface classes with `lg:` prefix only:

```tsx
<div className="lg:col-span-5 flex flex-col lg:research-surface-solid lg:p-[var(--space-6)]">
```

**Spec sub-panel — if `product.specs.length > 0`:**

Wrap the existing `<dl>` in a surface wrapper on desktop:

```tsx
<div className="lg:research-surface-elevated lg:overflow-hidden mb-[var(--space-8)] lg:mb-[var(--space-6)]">
  <dl>
    {/* existing spec rows unchanged */}
  </dl>
</div>
```

**What does NOT change:**
- Image gallery column — untouched
- Thumbnail row — untouched
- Breadcrumb — untouched
- Related products strip — untouched
- Mobile sticky CTA — untouched
- All mobile layout — untouched
- All product data rendering logic — untouched

**Prerequisites:** Waves 1–4 complete and validated. (Technically independent of Wave 4 — these are different pages — but validate sequentially for clean rollout.)

**Regression risk:** Low. Mobile-only Tailwind classes (`lg:`) have no effect below the LG breakpoint.

**Validation checklist:**
- [ ] Mobile (390px): ProductPage looks identical to current — no surface visible
- [ ] Desktop (1024px): info column has visible solid surface separation from background
- [ ] Spec sub-panel reads as a distinct information object within the info panel
- [ ] The solid info panel does not visually compete with the product image
- [ ] Add to Inquiry CTA button is fully visible and functional
- [ ] Mobile sticky CTA: still renders correctly, still positioned above BottomNav
- [ ] Image gallery: unchanged at all breakpoints

---

### Wave 6 — Shell Chrome Refinement
**Complexity:** Low | **Risk:** Low | **Visual impact:** Low-Medium

**Objective:** Add `backdrop-blur-sm` to GlobalHeader. Optionally add to BottomNav.

| Action | File | Change type |
|---|---|---|
| MODIFY | `src/layout/GlobalHeader.tsx` | 1-line surface change |
| MODIFY | `src/layout/BottomNav.tsx` | Optional — evaluate after header |

**GlobalHeader change — exact line:**
```
Current:  className="sticky top-0 z-40 bg-black border-b border-white/[0.06]"
Target:   className="sticky top-0 z-40 bg-black/80 backdrop-blur-sm border-b border-white/[0.06]"
```

**BottomNav change — evaluate first:**
```
Current:  className="fixed bottom-0 left-0 right-0 z-50 bg-black border-t border-white/[0.06]"
Option:   className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-t border-white/[0.06]"
```

Only apply the BottomNav change if the header change looks correct in testing. They are independent but related — implement header first, validate, then decide on BottomNav.

**Prerequisites:** Waves 1–5 complete and validated.

**Regression risk:** Low. Single class change on each component.

**Validation checklist:**
- [ ] Scroll any content-rich page — header appears to float above scrolling content
- [ ] Content does not visually bleed through the header unexpectedly
- [ ] Cart badge on header renders correctly
- [ ] BottomNav (if updated): active tab gold color unchanged

---

## 3. EXECUTION PRIORITY

### Must Happen First (Blocking)

```
Wave 1 MUST complete before any other wave.
src/lib/utils.ts MUST exist before any transplanted VN primitive is imported.
theme.css research surface tokens MUST exist before research-surface-* classes are used.
```

### Sequential Chain (Cannot Be Parallelized)

```
Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 → Wave 6
```

Each wave validates the foundation for the next. Do not skip steps.

**Exception — Waves 4 and 5 are page-independent.** After Wave 3 is validated, Waves 4 and 5 can be implemented in parallel by different sessions (CartPage and ProductPage do not share code). However, both still require Wave 1 completion.

### What Can Happen in Parallel (After Wave 1)

| Parallel track A | Parallel track B |
|---|---|
| Wave 2 (ProductCard) | — |
| Wave 3 (PillTabs) | — |
| Wave 4 (CartPage) | Wave 5 (ProductPage) |
| Wave 6 (Shell) | — |

**Only Waves 4 and 5 are safe to parallelize.** All others must be sequential.

### Must NEVER Happen Before Its Prerequisite

| This task | Must NEVER precede |
|---|---|
| Wave 2, 3, 4, 5, or 6 | Wave 1 validated |
| Wave 4 (CartPage) | Wave 2 validated |
| Wave 6 (Shell) | All other waves validated |
| Any new component import using `cn()` | Wave 1 (`src/lib/utils.ts` created) |
| Any use of `research-surface-*` classes | Wave 1 (theme.css patch applied) |

---

## 4. MODEL ASSIGNMENT RECOMMENDATION

| Task type | Recommended model | Reason |
|---|---|---|
| Wave 1 (infrastructure) | Any Sonnet | Deterministic — exact content specified in this document |
| Wave 2 (ProductCard) | Sonnet 4.6 | Moderate complexity; needs to follow exact component spec |
| Wave 3 (PillTabs transplant) | Sonnet 4.6 | Transplant + adaptation; must not import VN deps |
| Wave 4 (CartPage restructure) | Sonnet 4.6 or Opus | Highest-complexity wave; must preserve all existing logic exactly |
| Wave 5 (ProductPage desktop) | Any Sonnet | Low-complexity; `lg:` prefix surgical change only |
| Wave 6 (Shell chrome) | Any Sonnet | 1-line change; deterministic |
| Post-wave visual validation | Sonnet with browser/screenshot access | Needs to compare visual output against spec |
| Architecture decisions | Opus or senior Sonnet | Must read blueprint before deciding |
| Refactoring / cleanup | Haiku or Sonnet | Low-stakes cleanup after each wave |
| DO_NOT_IMPORT enforcement | Any model with blueprint context | Can be enforced by grep/search |

**Assignment rule:** Any model executing a wave MUST read the relevant wave section in this document AND the parent blueprint before writing a single line of code.

---

## 5. REFERENCE-DEPENDENT VS REFERENCE-FREE TASKS

### Safe to Execute Without Screenshots

All six waves are safe to execute from the blueprint spec alone. The surface values, component structure, and layout patterns are fully specified in this document and in `COMPOSITION_SYSTEM_BLUEPRINT.md`.

| Task | Reference required? |
|---|---|
| Wave 1 — infrastructure | No — exact code in this document |
| Wave 2 — ProductCard | No — exact structure in this document |
| Wave 3 — PillTabs | No — exact values in this document |
| Wave 4 — CartPage | No — layout spec in this document |
| Wave 5 — ProductPage | No — change is `lg:` prefix surgical |
| Wave 6 — Shell chrome | No — 1-line change in this document |

### Requires Screenshots Before Proceeding

| Task | Why screenshots are needed |
|---|---|
| Any adjustment to surface opacity values | Must visually verify the calibration matches research aesthetic — not nightlife |
| Any new Landing page enhancement | Landing is "complete" — changes require visual reference to justify |
| NoiseBackground implementation | Atmospheric effect; needs reference for how it should read in research context |
| Any addition to the Global Header beyond Wave 6 | Header is load-bearing chrome — changes need visual validation |
| Admin page redesign | Not in scope — do not begin without new direction + references |

---

## 6. SAFE IMMEDIATE TASKS

These tasks can be executed RIGHT NOW with zero risk. No prerequisite other than being in the correct repo directory.

| Task | File | Risk |
|---|---|---|
| Create `src/lib/utils.ts` | New file | Zero |
| Append research surface tokens to `src/theme/theme.css` | Additive patch | Zero |
| Install `@radix-ui/react-slot` (if asChild is kept) | `package.json` | Zero |
| Read and confirm `src/components/ProductGrid.tsx` before Wave 2 | Read only | Zero |
| Read `src/pages/CartPage.tsx` completely before Wave 4 | Read only | Zero |

Wave 1 is fully safe to execute immediately. It produces zero visual changes to any page.

---

## 7. HIGH-RISK TASKS

### Risk: Regression in Business Logic

| Task | Risk description | Mitigation |
|---|---|---|
| Wave 4 (CartPage restructure) | The most complex page. Form logic, validation, quantity controls, per-item notes, success/error state must all survive the layout restructure | Read the file completely first. Make layout changes only. Touch zero business logic. |
| Button.tsx upgrade (outside current waves) | Touches the highest-traffic component. API changes can break every consumer | Not in current wave scope. When it occurs, audit every Button usage site first. |

### Risk: Design Drift

| Task | Risk description | Mitigation |
|---|---|---|
| Any surface opacity value change | Increasing opacity above spec values drifts toward VelariNights nightlife aesthetic | Use only the values in `COMPOSITION_SYSTEM_BLUEPRINT.md §3`. Any deviation requires explicit approval. |
| Adding blur > 8px | Violates the blur cap; creates atmospheric feel | Enforced by `--blur-precision: 8px`. Never hardcode a blur value — only use the token. |
| Adding a second glass surface to any page | Dilutes the "glass is earned" signal | Before adding any glass class, count existing glass surfaces on the target page. Maximum is one. |
| ProductCard styling improvisation | Model may default to generic card patterns (heavy shadows, prominent borders, SaaS look) | Use exact values from Wave 2 spec. No improvisation. |

### Risk: Architecture Violation

| Task | Risk description | Mitigation |
|---|---|---|
| Modifying `AnimatedPortalShell.tsx` | Breaks all route transitions if done incorrectly | Not in any wave scope. Do not touch. |
| Modifying `src/theme/theme.css` beyond Wave 1 patch | Could overwrite existing tokens or break VN-origin utility classes | Only append — never modify existing rules. Always read the file before editing. |
| Importing anything from `src/ui/variants/` in VelariNights | Pulls in ticket/holo/role system | Enforced by the DO_NOT_IMPORT list in `COMPOSITION_SYSTEM_BLUEPRINT.md §9.2`. |

---

## 8. IMPLEMENTATION ORDER LOCK

### Forbidden Sequencing Mistakes

```
❌ NEVER: Implement Wave 2 before Wave 1 is validated
❌ NEVER: Import any component using cn() before src/lib/utils.ts exists
❌ NEVER: Use research-surface-* classes before theme.css patch is applied
❌ NEVER: Implement Wave 4 before reading CartPage.tsx in full
❌ NEVER: Implement Wave 6 before Waves 1–5 are validated
❌ NEVER: Add a second glass surface to any page
❌ NEVER: Apply any module surface to the Landing or Contact pages
❌ NEVER: Modify the AnimatedPortalShell
❌ NEVER: Implement NoiseBackground without explicit new direction
❌ NEVER: Begin auth/payment/advanced filtering work during Waves 1–6
```

### Anti-Drift Sequencing Rules

```
✅ ALWAYS: Read the blueprint section for the current wave before writing code
✅ ALWAYS: Validate mobile at 390px before declaring a wave complete
✅ ALWAYS: Confirm Landing and Contact are visually unchanged after every wave
✅ ALWAYS: Use token values from the blueprint — never approximate from VN source
✅ ALWAYS: Run npm run build after each wave before beginning the next
✅ ALWAYS: Preserve all existing business logic when restructuring layouts
```

### What Not to Touch Yet

The following files are in the repo but must not be modified during Waves 1–6:

| File | Reason |
|---|---|
| `src/pages/Landing.tsx` | Architecturally complete — protected |
| `src/pages/Contact.tsx` | Architecturally complete — protected |
| `src/layout/AnimatedPortalShell.tsx` | Load-bearing route animation — no wave requires changes |
| `src/layout/GlobalSurface.tsx` | Complete — no wave requires changes |
| `src/layout/BottomNav.tsx` | Protected until Wave 6, and even then only one line |
| `src/theme/ThemeProvider.tsx` | Complete — no changes needed |
| `src/theme/ThemeTuningProvider.tsx` | Scaffold — leave as-is |
| `src/hooks/useProducts.ts` | Read-only during Wave 3 unless filter wiring is trivial |
| `src/lib/supabase.ts` | Backend — no wave touches this |
| `src/stores/productStore.ts` | State — no wave touches this |

---

## 9. DEFINITION OF "FOUNDATION COMPLETE"

The following conditions must ALL be true before any of the deferred systems (auth, payments, advanced filtering, admin expansion) may begin.

### Required Conditions

| # | Condition | How to verify |
|---|---|---|
| 1 | `npm run build` passes with zero TypeScript errors | Run `npm run build` |
| 2 | `src/lib/utils.ts` exists and exports `cn` | File exists; builds without error |
| 3 | Research surface tokens visible in browser `:root` | DevTools → Elements → Computed → search `--surface-product` |
| 4 | ProductCard renders as a bounded solid-surface object on both catalog pages | Visual check at 390px and 1024px |
| 5 | PillTabs renders above product grid on both catalog pages | Visual check |
| 6 | CartPage 2-column layout renders correctly on desktop | Visual check at 1024px |
| 7 | CartPage form submit works end-to-end (or Supabase env is confirming edge function) | Manual test: fill form → submit → success state |
| 8 | ProductPage info panel has solid surface on desktop | Visual check at 1024px |
| 9 | GlobalHeader has `bg-black/80 backdrop-blur-sm` | DevTools → Elements → header class inspection |
| 10 | Landing and Contact pages are visually unchanged | Side-by-side comparison with pre-wave screenshots |
| 11 | Mobile experience verified on all modified pages | DevTools responsive mode at 390px |
| 12 | No glass surface appears more than once on any screen | Manual audit of CartPage, ProductPage, both catalog pages |

### What "Foundation Complete" Unlocks

Once all 12 conditions above are true, the following work is unblocked:

- **Auth and user profiles** — login flow, session management, protected routes
- **Invoice workflows** — order confirmation, invoice PDF generation
- **Advanced filtering** — `useProducts` hook extension, URL-driven filter state
- **Admin expansion** — analytics views, order management, inventory tools
- **Backend expansion** — new Supabase tables, additional edge functions
- **Multi-theme system** — only if business requirement emerges; not a default next step

### What "Foundation Complete" Does NOT Unlock

The following remain deferred regardless of foundation status:

- NoiseBackground / atmospheric hero effects (requires visual reference + explicit direction)
- Multi-theme system (no business requirement)
- Role-based UI (no auth system yet)
- Social or discovery features (out of scope for this product)

---

*End of EXECUTION_MAP.md*

*This document is operational. For architectural rationale and surface value specifications, see `docs/COMPOSITION_SYSTEM_BLUEPRINT.md`. For the definition of done on the full project, see §14 of the blueprint.*
