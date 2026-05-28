# COMPOSITION SYSTEM BLUEPRINT
## VS Research Labs — Canonical Implementation Reference

**Version:** 1.0  
**Status:** Active — authoritative  
**Scope:** Design system, module architecture, implementation sequencing  
**Context:** Derived from architectural audit of VelariNights-APP and full analysis of current vsresearchlabs codebase  

> This document is the canonical implementation reference for the VS Research Labs design system. Any future model, engineer, or system working on this codebase must read and execute against this blueprint before modifying layout, surfaces, components, or composition patterns. Deviation from this document requires explicit architectural approval and an update to this file.

---

## 1. EXECUTIVE SUMMARY

### The Problem

After the Phase 1–3 scaffolding of VS Research Labs, the site had a precise visual language — correct tokens, correct typography, correct spacing — but it did not feel like an application. It felt like a well-designed website.

The specific failure: the site operated on a single depth plane. Raw black background. Content floating directly on it. Hairline borders (`border-white/[0.06]`) as the only structural mechanism. No contained objects. No foreground/background relationships. No module identity at the component level.

This created an experience that reads as "a normal website using Velari colors" rather than "a Velari-native application adapted for commerce."

### Why Tokens Were Insufficient

The token layer — spacing, radius, shadow, blur, typography, motion — was successfully transplanted from VelariNights in the Phase 1–2 build. The CSS variable system is complete and correct. The Tailwind configuration is correct.

Tokens define *values*. They do not define *structure*. A site can have perfect spacing tokens and still feel flat because those tokens are being applied to uncontained content. Tokens provide the raw material. Module composition provides the grammar that turns raw material into objects.

### Why Module Composition Is Canonical

The module composition system — `ModuleShell`, `VelariShell`, `ModuleContent`, `ModuleHeader`, `PillTabs` — is not a UI library. It is a spatial grammar. It defines what a bounded object looks like, how content lives inside it, how objects relate to each other, and how the page develops vertical rhythm.

Without it:
- Pages flatten
- Spacing loses rhythm (tokens exist but nothing organizes them)
- Sections lose containment (content flows without boundaries)
- Interactions feel generic (interactive elements have no object identity)
- Surfaces lose depth (no foreground/background relationship)
- The UI stops feeling app-native

The module system is canonical because the product is not a website. It is a mobile-native modular application that also scales to desktop. That architectural decision mandates module composition at every interactive surface.

---

## 2. CORE DESIGN PHILOSOPHY

These principles are not preferences. They are load-bearing constraints that govern every implementation decision.

### 2.1 Mobile-Native App Architecture

This product is an application that happens to run in a browser. It is not a responsive website that has a mobile breakpoint. The architecture is mobile-first in the truest sense: the mobile layout is the canonical layout. Desktop is the mobile layout expanded intelligently.

Every layout decision must be validated on mobile first. If it works on mobile, expand it for desktop. Never design for desktop and then collapse for mobile.

Practical implications:
- BottomNav is always visible and always the primary navigation
- Tap targets are always ≥ 44px
- Content columns are always max-constrained (never stretched edge-to-edge on desktop)
- Touch interactions are first-class; hover states are enhancements, not requirements

### 2.2 Modular Composition

Every interactive or informational surface in the application is a **module** — a bounded spatial object with defined edges, internal structure, and consistent density. Content does not float on the page background. Content lives inside modules.

A module is:
- A surface with a defined boundary (solid, elevated, or glass)
- An internal spacing system (density: compact / comfortable / spacious)
- A hierarchical structure (overline → title → content → action)
- A state machine (loading / empty / error / populated)

A module is not:
- A decorative card for visual interest
- A container applied arbitrarily to make things look "boxed"
- A pattern applied to every element regardless of context

Modules are applied where content needs object identity. Headers, hero sections, navigation, and editorial strips do not need modules.

### 2.3 Desktop-as-Expanded-Mobile

The desktop experience is the mobile experience with more modules per row and a two-column layout on transactional pages. The modules themselves are identical. The grid arranges them differently.

Desktop must never feel like a "full website" that was also made to work on mobile. It must feel like the mobile app running on a larger screen — with the same object grammar, the same surface language, the same density system — simply displaying more information per viewport.

Grid behavior:
```
Mobile:   1 module per row (always)
SM 640+:  2 modules per row (product grids)
LG 1024+: 3 modules per row (product grids) / 2-column layouts (transactional)
```

### 2.4 Premium Technical Minimalism

The visual tone is: a precision scientific instrument. Not a nightclub. Not a SaaS dashboard. Not a generic e-commerce storefront.

The aesthetic vocabulary:
- Deep black base surfaces (`#000000`, `#050505`)
- White content with aggressive opacity reduction for hierarchy (`white/65`, `white/45`, `white/40`, `white/30`)
- Gold (`#C4A35A`) as the single accent color — used sparingly as a premium signal
- Inter typeface — geometric, precise, technical
- Uppercase tracking for overlines and labels (`tracking-[0.3em]`, `uppercase`)
- Font-weight light (`300`) for display type — legibility through spacing, not weight

What this aesthetic is NOT:
- It is not warm or atmospheric (no ambient glows by default)
- It is not playful (no gradients, no decorative elements)
- It is not aggressive (no heavy shadows, no high-contrast accents)
- It is not dense (module spacing is generous, not information-packed)

### 2.5 Research / Laboratory Tone

Every design decision should pass a single question: *Does this feel like precision laboratory equipment, or does it feel like a consumer product?*

Laboratory precision signals:
- Hairline borders as structural definition
- Uppercase micro-labels for spec data
- Monospaced values in specification tables
- Minimal color vocabulary (black, white, gold only)
- Motion that is fast and purposeful, never decorative
- Typography that is set, not styled

### 2.6 Restrained Depth Philosophy

Depth is earned, not applied as decoration. The site operates with three visual altitudes:

1. **Base plane** — the raw page background. Nothing sits here except the background itself.
2. **Object plane** — contained modules with solid surfaces. Product cards, form sections, spec panels.
3. **CTA plane** — the highest visual altitude. The single most important action surface on a given screen. This is where glass surfaces are permitted.

No element should skip planes. No card should float on the base plane. No CTA should compete with other CTA-plane elements on the same screen.

### 2.7 Glass Is Earned

Glass surfaces (backdrop-filter blur + elevated opacity) are a premium visual signal. They communicate: *this is the most important action surface on this screen.*

This signal has value precisely because it is rare. If glass is applied to every surface, the signal disappears. The rule is absolute:

**Maximum one glass surface per screen state.**

Glass is permitted for:
- Cart inquiry summary/submit panel
- Primary CTA sections on landing (future)

Glass is forbidden for:
- Product cards
- Category filter bars
- Navigation (except the header scroll-state upgrade)
- Spec panels
- Item list rows
- Form fields (the form section container may be glass; the fields inside are not)

### 2.8 Bounded-Object Philosophy

The fundamental shift the module system creates is moving from *regions of content* to *bounded objects*.

A region of content: "Here is a name, then a price, then a description."  
A bounded object: "Here is a product. It has a name, a price, and a description. It begins here and ends here. It can be tapped."

This distinction is what creates app-native feel. Regions describe. Objects act.

Every interactive surface — product cards, cart items (as a group), inquiry form, spec tables — must have object identity: a defined boundary, consistent internal structure, and interactive state behavior (hover, pressed, focus).

---

## 3. CANONICAL SURFACE HIERARCHY

This hierarchy defines every surface in the application. These values are fixed. No surface outside this hierarchy may be introduced without architectural review.

### Level 0 — Base Plane

```
background-color: #000000 (--color-surface-base)
                  #050505 (--color-surface-sunken, for inset areas)
border: none
blur: none
```

**Use for:** The page background. Nothing else.  
**Never use as:** A container, a card, a panel, or any bounded object.

---

### Level 1 — Solid Surface (default module surface)

```
background-color: rgba(255, 255, 255, 0.03)
border: 1px solid rgba(255, 255, 255, 0.09)
border-radius: var(--radius-card)  /* 24px */
backdrop-filter: none
box-shadow: none
```

**Hover state:**
```
background-color: rgba(255, 255, 255, 0.055)
border-color: rgba(255, 255, 255, 0.15)
transition: all var(--duration-fast) var(--easing-easeInOut)
```

**Use for:** Product cards, spec sub-panels, form section containers, item list group containers, any interactive content object.

**Forbidden for:** Navigation, hero sections, editorial strips, full-page backgrounds.

---

### Level 2 — Elevated Surface (secondary module emphasis)

```
background-color: rgba(255, 255, 255, 0.055)
border: 1px solid rgba(255, 255, 255, 0.13)
border-radius: var(--radius-card)
backdrop-filter: none
box-shadow: var(--shadow-sm)
```

**Use for:** A nested content block within a solid surface (e.g., the specs panel inside the ProductPage info module). Depth signaling within a composed module.

**Constraint:** Never nest deeper than 2 levels total (Level 1 → Level 2). No Level 2 inside Level 2.

**Forbidden for:** Standalone elements, primary containers, anything at the page root level.

---

### Level 3 — Glass Surface (CTA / premium action plane)

```
background-color: rgba(255, 255, 255, 0.05)
border: 1px solid rgba(255, 255, 255, 0.15)
border-radius: var(--radius-card)
backdrop-filter: blur(8px)
-webkit-backdrop-filter: blur(8px)
box-shadow: var(--shadow-glass)
```

**Hover state:**
```
border-color: rgba(255, 255, 255, 0.20)
box-shadow: var(--shadow-glassHover)
```

**Blur cap:** 8px maximum. No exceptions. VelariNights uses 16–24px; the research site uses 8px. The lower value is what separates "precision instrument" from "atmospheric nightlife."

**Opacity cap:** 0.08 maximum background opacity. No exceptions.

**Use for:** Cart inquiry summary/form panel (desktop right column), primary CTA sections.

**Hard constraints:**
- Maximum one glass surface visible at any time
- Never stack glass surfaces
- Never use glass for navigation, cards, or decorative containers
- Glass is a signal, not a style

---

### Flat (no surface)

```
background: transparent
border: none or var(--color-border-subtle) only as a structural divider
```

**Use for:** Page-level chrome regions (Landing hero, category row strips, section headers, contact information), editorial layouts, any content where containment is unnecessary or would fight the reading experience.

**Hairline divider rule:** `border-white/[0.06]` remains the canonical hairline value for structural separators (section dividers, list row separators). This value should not be changed.

---

### CSS Token Additions Required

These tokens must be added to `src/theme/theme.css` before Wave 1 implementation:

```css
/* Research-calibrated surface values */
--surface-product: rgba(255, 255, 255, 0.03);
--surface-product-hover: rgba(255, 255, 255, 0.055);
--surface-elevated-research: rgba(255, 255, 255, 0.055);
--surface-cta: rgba(255, 255, 255, 0.05);
--border-product: rgba(255, 255, 255, 0.09);
--border-product-hover: rgba(255, 255, 255, 0.15);
--border-cta: rgba(255, 255, 255, 0.15);
--blur-precision: 8px;
```

These tokens use the `research` / `product` / `cta` namespace to distinguish them from the VelariNights-origin tokens, which remain in the file for backward compatibility.

---

## 4. MODULE COMPOSITION SYSTEM

### 4.1 Why the Module System Exists

The module system is the structural grammar that converts token values into spatial objects. Without it, the application is a document. With it, the application is a product.

The module composition system — derived from VelariNights, adapted for research — provides:

1. **Object identity** — content has boundaries, not just spacing
2. **Consistent density** — internal padding is governed by the density system, not ad hoc
3. **State management** — loading, empty, error, and populated states are first-class
4. **Composition hierarchy** — ModuleShell wraps VelariShell wraps ModuleContent; the hierarchy enforces structure
5. **Responsive containment** — modules maintain their DNA at every breakpoint; the grid changes, the module does not

### 4.2 Component Definitions

#### `ModuleShell`

**Source:** Transplanted from VelariNights, `src/components/ui/ModuleShell.tsx`  
**Purpose:** The foundational bounded container. Manages surface type, density, and state.

**Props contract (research-relevant subset):**
```typescript
interface ModuleShellProps {
  surface?: 'flat' | 'solid' | 'glass';  // default: 'solid' (changed from VN default of 'glass')
  density?: 'compact' | 'comfortable' | 'spacious';
  state?: 'loading' | 'empty' | 'error' | 'populated';
  variant?: 'primary' | 'secondary' | 'compact' | 'emphasized';
  emphasized?: boolean;
  header?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
  errorState?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}
```

**Research-site behavioral adaptation:**  
When transplanting ModuleShell, the default `surface` value must be changed from `'glass'` (VelariNights default) to `'solid'`. All other defaults remain.

The `role` prop (VelariNights-specific for guest/creator/owner/admin) is present in the source but produces no visual effect in the research site because the role-accent CSS rules are deliberately absent from `src/theme/theme.css`. The prop may be omitted or left unused — it does not need to be removed.

**The `solid` surface path in ModuleShell renders:**
```
bg-surface-elevated border border-default shadow-lg rounded-2xl
```

This must be overridden with research-calibrated values. See the `ResearchModule` adapter in §4.7.

---

#### `VelariShell`

**Source:** Transplanted from VelariNights, `src/components/ui/VelariShell.tsx`  
**Purpose:** The canonical module container. Wraps ModuleShell with a glass-panel outer and flat-surface inner. Provides the canonical glass border treatment.

**In VelariNights:** VelariShell defaults to the glass-panel pattern as its primary visual expression.

**In the research site:** VelariShell is used ONLY where glass surfaces are explicitly permitted (cart CTA panel). For all other modules, use `ModuleShell` with `surface="solid"` directly, or use the `ResearchModule` adapter (see §4.7).

---

#### `ModuleHeader`

**Source:** Transplanted from VelariNights, `src/components/ui/ModuleHeader.tsx`  
**Purpose:** Canonical internal module header. Provides the overline → title → trailing-action hierarchy.

```typescript
interface ModuleHeaderProps {
  overline?: string;   // Uppercase micro-label (e.g., "Catalog", "Specifications")
  title: string;       // Section/module title
  trailing?: ReactNode; // Optional action (e.g., PillTabs, a count, a button)
}
```

**Visual pattern:**
```
CATALOG                          ← overline: text-[10px] font-medium text-white/40 uppercase tracking-wider
Research Supplies                ← title: text-sm font-semibold text-white
```

**Where to use:** Top of any module that has a section identity. Product catalog header, cart header, form section headers.

**Where NOT to use:** Page-level h1 headings (those use the page header pattern, not ModuleHeader). Hero content.

---

#### `ModuleContent`

**Source:** Transplanted from VelariNights, `src/components/ui/ModuleContent.tsx`  
**Purpose:** Canonical internal padding and vertical rhythm container. All content inside a module must be wrapped in ModuleContent.

```typescript
interface ModuleContentProps {
  spacing?: 'tight' | 'default' | 'relaxed';
  className?: string;
  children: React.ReactNode;
}
```

**Internal padding:** `px-4 py-2` (canonical, locked — do not modify)  
**Vertical rhythm:** `space-y-2` (tight) / `space-y-3` (default) / `space-y-4` (relaxed)

**Rule:** Every module's text/content content must live inside `ModuleContent`. Content that bypasses `ModuleContent` violates the density system and creates spacing inconsistency.

---

#### `PillTabs`

**Source:** Transplanted from VelariNights, `src/components/ui/PillTabs.tsx`  
**Purpose:** App-native tab/filter switcher. Creates the single clearest signal that a UI is application-grade, not website-grade.

**Research adaptation:** The `bg-surface-elevated backdrop-blur-md` container becomes `bg-white/[0.04] backdrop-blur-sm border border-white/[0.09]` — same structural pattern, lower intensity.

**Where to use:** Category/filter switching above product grids. Tab switching within modules that have multiple states.

**Where NOT to use:** Page-level navigation (BottomNav handles this). Section switching between pages. Any context where the tabs would be the primary navigation mechanism.

---

### 4.3 Density System

The density system maps to the `--module-padding` and `--panel-padding` CSS tokens already defined in `src/theme/theme.css`.

| Density | Padding value | Use case |
|---|---|---|
| `compact` | `var(--module-padding-compact)` = 12px | Product cards, small info chips, dense data |
| `comfortable` | `var(--module-padding)` = 16px | Form sections, cart items, standard content |
| `spacious` | `var(--panel-padding)` = 24px | Hero-adjacent modules, primary CTA panels |

**Rule:** Every module must declare an explicit density or inherit from its variant. Ad hoc padding inside modules is forbidden.

---

### 4.4 Object Containment Philosophy

A module must contain a conceptually complete unit of information or interaction. It should not contain a fraction of a concept, and it should not merge two distinct concepts into one container.

**Valid module contents:**
- A product (image, name, description, price) → ProductCard module
- A specification table (all specs for one product) → SpecPanel module
- An inquiry form (all fields + submit) → InquiryForm module
- A cart item list (all line items + quantity controls) → ItemList module

**Invalid module contents:**
- Half a product card (e.g., just the image)
- A mix of a product card and an unrelated call to action
- A form field in isolation (form fields live inside a form module)
- Navigation items (navigation lives in the shell, not in modules)

---

### 4.5 State System

Every module must handle its states explicitly. The `ModuleShell` `state` prop provides loading, empty, error, and populated states as first-class.

**Loading state:** Renders an animated skeleton (3 pulse lines) within the module bounds. No global spinner. State is local to the module.

**Empty state:** Passed via the `emptyState` prop. Must be a meaningful empty state (a label + optional CTA), not a blank space.

**Error state:** Passed via the `errorState` prop. Must communicate what failed and offer a path forward.

**Populated state:** The default. Renders children.

---

### 4.6 Where Modules Apply vs. Where They Must Not

| Context | Module? | Reason |
|---|---|---|
| Product cards (grid) | YES — solid surface | Object identity required for interactive items |
| Spec panel (product detail) | YES — elevated surface (Level 2 within solid) | Data integrity — specs are a distinct information object |
| Product info panel (desktop) | YES — solid surface, lg+ only | Desktop needs containment; mobile stays flat |
| Cart items list (as a group) | YES — solid surface | Container for the line item collection |
| Inquiry form section | YES — glass surface (one per page) | Primary CTA surface |
| Category filter (PillTabs) | NO surface — flat | Filter bar is chrome, not content |
| Landing hero | NO surface — flat | Full-bleed editorial section |
| Landing category rows | NO surface — flat | Hairline row pattern is correct; containment would fight the editorial rhythm |
| Page section headers | NO surface — flat | Headers are chrome, not modules |
| Navigation (header/bottom) | NO surface — chrome | Shell architecture, not module architecture |
| Contact information | NO surface — flat | Hairline DL pattern is correct and complete |
| Related products strip | NO surface — flat | Flat strip is correct for supporting content |

---

### 4.7 ResearchModule Adapter

Because VelariNights' `ModuleShell` uses VelariNights-calibrated surface values, a thin adapter component is required to apply research-calibrated defaults.

**File:** `src/components/ui/ResearchModule.tsx` (new — do not import from VelariNights)

**Purpose:** Wraps ModuleShell with research surface values, correct defaults, and stripped role-system props.

**Contract:**
```typescript
interface ResearchModuleProps {
  surface?: 'solid' | 'elevated' | 'glass' | 'flat';  // maps to research surface hierarchy
  density?: 'compact' | 'comfortable' | 'spacious';
  state?: 'loading' | 'empty' | 'error' | 'populated';
  emphasized?: boolean;
  header?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
  errorState?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}
```

**Surface mappings:**
- `'solid'` → `bg-[var(--surface-product)] border border-[var(--border-product)] rounded-[var(--radius-card)]`
- `'elevated'` → `bg-[var(--surface-elevated-research)] border border-[var(--border-product-hover)] rounded-[var(--radius-card)]`
- `'glass'` → `bg-[var(--surface-cta)] backdrop-blur-[var(--blur-precision)] border border-[var(--border-cta)] rounded-[var(--radius-card)] shadow-glass`
- `'flat'` → no surface classes

**Default surface:** `'solid'`

This component is the standard module primitive for all research site modules. Use `VelariShell` from VelariNights only for the single glass CTA panel on CartPage.

---

## 5. PAGE-BY-PAGE COMPOSITION STRATEGY

### 5.1 Landing (`/`)

**Current strengths:**
- Full-bleed hero with constrained content column — correct architecture
- Large typographic hierarchy — display type is appropriate
- Editorial category rows with hairlines — elegant, scannable
- Hover arrow interaction — correct level of animation

**Current deficiencies:**
- None. The landing page is architecturally complete in its current form.

**Module requirements:** None.

**Intended final composition:**
```
[Full-bleed hero section — flat, no surface]
  overline (gold, uppercase tracking)
  h1 (font-light, tracking-tight)
  body (white/65, leading-relaxed)

[hairline divider]

[Category section — flat, editorial rows]
  overline label ("Catalog")
  [hairline]
  Row: Research Supplies    →
  [hairline]
  Row: Laboratory Equipment →
  [hairline]
```

**Desktop scaling behavior:** The hero and category rows scale with the `max-w-[1100px]` constraint. Full-bleed hairlines remain full-bleed. No grid changes. No module additions.

**Constraint:** DO NOT apply modules to the landing page. The editorial row pattern is the correct front-door grammar. Modulizing it would destroy its clarity.

---

### 5.2 Catalog Pages — ResearchSupplies and LaboratoryEquipment (`/research-supplies`, `/laboratory-equipment`)

**Current strengths:**
- Correct page header hierarchy (overline, h1, description)
- Grid rhythm (1 / 2 / 3 columns) is correctly set
- Token-driven spacing

**Current deficiencies:**
- Product cards have no containment — image + loose text floating on the base plane
- No filter/category switching UI (the page offers no interactive navigation layer)
- Cards do not have object identity — they are image regions, not interactive objects
- Loading/empty/error states exist but are bare text, not module states

**Module requirements:**
1. `ProductCard` → solid surface module (image flush-top, content in ModuleContent, compact density)
2. `PillTabs` → flat filter bar above the grid (no surface on the PillTabs container itself)
3. `ProductGrid` → manages grid layout only; cards manage their own containment

**Intended final composition:**
```
[Page header — flat]
  overline ("Catalog")
  h1 ("Research Supplies")
  description (white/55, max-w-52ch)

[hairline divider]

[PillTabs — flat container, frosted pill switcher]
  All  |  In Stock  |  New Arrivals

[Product grid — 1/2/3 columns]
  ┌──────────────────────────────┐
  │ [image — aspect-square,      │ ← Level 1 solid surface
  │  flush to top, no padding]   │
  │ ─────────────────────────── │ ← internal hairline (border-t border-white/[0.06])
  │ [ModuleContent compact]      │
  │   name (text-sm text-white)  │
  │   description (2-line clamp) │
  │   price or "Inquire"         │
  └──────────────────────────────┘

[loading state: 6-card skeleton grid within ResearchModule bounds]
[empty state: module-wrapped empty label + browse CTA]
```

**Desktop scaling behavior:** Grid goes 3-up at `lg`. Cards are identical on mobile and desktop — same object, same surface, same density. The grid changes; the card does not.

---

### 5.3 ProductPage (`/product/:id`)

**Current strengths:**
- 12-column split layout for desktop — structurally correct
- Hairline spec table — excellent data display
- Thumbnail row with active state — correct gallery pattern
- Mobile sticky add-to-inquiry — correct ergonomic solution
- Breadcrumb navigation — correct hierarchy signal

**Current deficiencies:**
- Info column (right side, `lg:col-span-5`) has no containment on desktop — type floats on black
- Spec table exists without a sub-module container — it reads as an undifferentiated list
- No object-level separation between product description and spec data on desktop

**Module requirements:**
1. Info panel → Level 1 solid surface on `lg+` only; flat on mobile
2. Spec sub-panel → Level 2 elevated surface inside the info panel (desktop only)
3. Mobile: zero structural changes

**Intended final composition:**

```
[Breadcrumb — flat, xs uppercase]

[12-col grid]
  [col-span-7: Image gallery — flat, no module]
    aspect-square image + hairline border
    thumbnail row (scrollable, active state = gold border)

  [col-span-5: Info module — lg: Level 1 solid, mobile: flat]
    overline (gold, category label)
    h1 (font-light, tracking-tight)
    sku (micro, white/35)
    price (xl, font-light)
    short description (sm, white/65)

    ┌── Spec sub-module — Level 2 elevated (lg only) ──┐
    │  Purity      99.4%                               │
    │  Sequence    H-Tyr-D-Ala-...                     │
    │  [hairline rows inside elevated surface]         │
    └──────────────────────────────────────────────────┘

    long description (sm, white/55)
    [Add to Inquiry CTA — gold pill button]

[Related products — flat strip, 3-up grid, no module]
  overline ("Related")
  flat image cards (no containment — this is supporting content)

[Mobile sticky footer — bg-black/80 blur-sm, above BottomNav]
  [Add to Inquiry — full-width gold pill]
```

**Desktop scaling behavior:** The 12/5 grid split is correct. The info panel containment is desktop-only (`lg:` prefix on all surface classes). Mobile remains flat sequential layout.

**Important constraint:** The solid info module surface on desktop must use a low-opacity Level 1 surface value. The info panel must feel like it's separating from the background, not like a card that competes with the product images.

---

### 5.4 CartPage (`/cart`)

**Current strengths:**
- Hairline item list — correct pattern for line items
- Per-item note expansion — correct interaction pattern
- Quantity controls — correct ergonomics
- Success/empty states — well-handled

**Current deficiencies:**
- No spatial separation between item list and inquiry form
- Both sections exist as undifferentiated flat content on the page base
- Desktop is fully single-column — no layout intelligence
- No summary module to anchor the inquiry CTA
- The form fields are individually visible as raw inputs without a containing section

**Module requirements:**
1. Items list → Level 1 solid surface (wrapping the entire hairline list)
2. Inquiry summary/form → Level 3 glass surface (the single glass surface for this page)
3. Desktop: 2-column layout (`col-span-8` items / `col-span-4` summary)
4. Mobile: stacked (items → form), both modules visible

**Intended final composition:**

```
[Page header — flat]
  overline ("Send Inquiry")
  h1 ("Inquiry List")

MOBILE:
  ┌── Items module (Level 1 solid) ──────────────────┐
  │  [item row] ─────────────────────────────────── │
  │  [item row] ─────────────────────────────────── │
  └───────────────────────────────────────────────────┘

  ┌── Inquiry form module (Level 3 glass) ─────────┐
  │  overline ("Your Information")                  │
  │  Name field                                     │
  │  Email / Phone field                            │
  │  Notes field (optional)                         │
  │  [Send Inquiry — gold pill, full-width]         │
  └─────────────────────────────────────────────────┘

DESKTOP (lg+):
  [12-col grid]
  ┌── Items (col-span-8, Level 1 solid) ──────────┐  ┌── Summary (col-span-4, Level 3 glass) ─┐
  │  [item rows with hairlines inside module]      │  │  overline ("Your Information")          │
  │                                                │  │  Name field                             │
  │                                                │  │  Email/Phone field                      │
  │                                                │  │  Notes field                            │
  │                                                │  │  [Send Inquiry — gold pill, w-full]     │
  └────────────────────────────────────────────────┘  └─────────────────────────────────────────┘

EMPTY STATE (no items):
  ┌── Empty module (Level 1 solid) ──────────────┐
  │  "Your inquiry list is empty."                │
  │  [Research Supplies]  [Laboratory Equipment] │
  └───────────────────────────────────────────────┘

SUCCESS STATE: flat, centered, no module — typographic only
```

**Desktop scaling behavior:** The 2-column split is the primary desktop optimization. The items column (`col-span-8`) is the content mass; the summary column (`col-span-4`) is the CTA mass. The glass surface on the summary column is the only glass surface on the entire page.

---

### 5.5 Contact (`/contact`)

**Current strengths:** The hairline definition list (DL) pattern is architecturally complete and tonally correct.

**Current deficiencies:** None.

**Module requirements:** None.

**Constraint:** DO NOT apply module containment to the contact page. The hairline DL is the correct grammar for static contact information. Wrapping it in a surface would create visual weight that this content does not warrant.

---

## 6. DESKTOP SCALING GRAMMAR

### 6.1 The Expanded-App Principle

Desktop is not a different application. It is the same application with more viewport. This means:

- The BottomNav remains on desktop (it's the primary navigation for ALL viewport sizes)
- The max-width constraint (`1100px`) remains — the content column does not grow
- Modules maintain their object identity at all breakpoints
- Layout columns arrange more modules per row, but the modules themselves do not change

### 6.2 Module-Per-Row Scaling

```
Breakpoint   Grid behavior          Module behavior
────────────────────────────────────────────────────────────
< 640px      1 column               Modules stack vertically, full width
640–1023px   2 columns (products)   Modules go 2-up in product grids
1024px+      3 columns (products)   Modules go 3-up in product grids
             2-column (transact.)   Items/form split at lg+ (cart, future)
```

### 6.3 Max-Width Constraints

The `max-w-[1100px]` in `AnimatedPortalShell` is the single max-width authority for all page content. This value must not be changed or overridden by individual pages.

Full-bleed sections (the Landing hero and category hairlines) use a negative margin trick (`-mx-[var(--space-6)]`) to extend to the viewport edge, then re-apply the max-width constraint to the inner content column. This pattern must be preserved as-is.

### 6.4 Responsive Object Behavior

A module that is `w-full` on mobile becomes `[grid column width]` on desktop. The module's internal structure, padding, and density do not change. Only the outer width changes.

There is no "desktop version" of a module. The module has one implementation. The grid decides how wide it is.

### 6.5 Desktop Containment Rules

On desktop, transactional pages (CartPage, future checkout) use explicit column assignments to create spatial hierarchy:

```
Primary content mass:  col-span-7 or col-span-8
Secondary/CTA mass:    col-span-4 or col-span-5
```

The CTA column always sits to the RIGHT on desktop. On mobile, the CTA module falls below the primary content module (natural stacking order).

The CTA column's glass surface is only visible on desktop (where it has the spatial separation needed to earn the glass treatment). On mobile, the glass module still renders but becomes the bottom module in the stack, where it creates a clear CTA boundary at the base of the content.

---

## 7. SHELL ARCHITECTURE

### 7.1 Current Architecture

```
App.tsx
└── BrowserRouter
    └── GlobalSurface                ← full-bleed base background
        ├── GlobalHeader             ← sticky top, h-14, z-40
        └── AnimatedPortalShell      ← max-w-1100, route animation, gutters
            └── Routes               ← page content
    └── BottomNav                    ← fixed bottom, h-16, z-50
```

**This structure is correct and must not change fundamentally.** The separation of chrome (GlobalHeader, BottomNav) from the animated content shell (AnimatedPortalShell) is the right architecture for an app-native experience.

### 7.2 GlobalSurface

**File:** `src/layout/GlobalSurface.tsx`  
**Purpose:** Full-viewport base container. Applies the page background color and base text color.

**Current:** `min-h-screen w-full bg-base-900 text-text-primary`  
**Note:** `bg-base-900` = `#000000` (from Tailwind config). This is correct.  
**Intended evolution:** None. This component is complete.

### 7.3 GlobalHeader

**File:** `src/layout/GlobalHeader.tsx`  
**Purpose:** Sticky top navigation bar. 3-column layout: hamburger / logo / cart.

**Current:** `bg-black border-b border-white/[0.06]`

**Intended evolution (Wave 6):**
```
Current:  bg-black
Evolved:  bg-black/80 backdrop-blur-sm
```

This change makes the header feel like it floats above scrolling content rather than being a fixed block. The blur value is `sm` (8px) — respecting the blur cap. The `bg-black/80` maintains opacity without being fully opaque.

**When to implement:** Wave 6, after Waves 1–5 are complete and validated.

**Current header chrome is not a blocker.** The `bg-black` version is acceptable for all waves.

### 7.4 AnimatedPortalShell

**File:** `src/layout/AnimatedPortalShell.tsx`  
**Purpose:** Route transition wrapper. Reads CSS tokens for animation duration and easing. Applies the content column constraints.

**Content column classes:** `mx-auto w-full max-w-[1100px] pt-2 pb-24 px-[var(--space-6)]`

- `pb-24` clears the fixed BottomNav
- `pt-2` provides breathing room below the GlobalHeader
- `px-[var(--space-6)]` = 24px horizontal gutter

**Intended evolution:** None. This component is architecturally complete. The route transition animation (opacity/y) is correct.

**Do not add** page-level padding or max-width overrides inside route pages. `AnimatedPortalShell` is the single authority for content column geometry.

### 7.5 BottomNav

**File:** `src/layout/BottomNav.tsx`  
**Purpose:** Fixed bottom primary navigation. 4 tabs: Landing / Research Supplies / Laboratory Equipment / Contact.

**Current:** `bg-black border-t border-white/[0.06]` — solid, no blur.

**Phase 2 spec note preserved:** "solid surface + hairline only — no glass, no blur." This is correct for all current waves.

**Intended evolution (Wave 6, deferred):**
```
Current:  bg-black border-t border-white/[0.06]
Future:   bg-black/80 backdrop-blur-sm border-t border-white/[0.06]
```

Match the header surface treatment for shell cohesion. Not urgent.

**Tab indicator:** Active tab uses `text-gold`. Inactive tabs use `text-white/55`. This pattern is correct and must not change.

---

## 8. MODULE INTRODUCTION WAVES

Each wave is atomic: it can be implemented and validated independently. Never merge waves. Each wave must be validated before the next begins.

---

### Wave 1 — Infrastructure

**Objective:** Create the foundational utilities and CSS additions that all subsequent waves depend on. No visual changes to the user-facing application.

**Files affected:**

| Action | File |
|---|---|
| CREATE | `src/lib/utils.ts` |
| PATCH | `src/theme/theme.css` |
| INSTALL | `@radix-ui/react-slot` (npm) OR remove `asChild` from Button source |

**`src/lib/utils.ts` content:**
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**`src/theme/theme.css` additions** (append after existing rules, before the closing):
```css
/* Research surface tokens */
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

/* Utility classes for module surfaces */
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

/* Utility classes from VelariNights theme.css — required by transplanted primitives */
.bg-surface-base     { background-color: var(--color-surface-base); }
.bg-surface-elevated { background-color: var(--color-surface-elevated); }
.bg-surface-overlay  { background-color: var(--color-surface-overlay); }
.text-content-primary   { color: var(--color-content-primary); }
.text-content-secondary { color: var(--color-content-secondary); }
.text-content-tertiary  { color: var(--color-content-tertiary); }
.border-default { border-color: var(--color-border-default); }
.border-subtle  { border-color: var(--color-border-subtle); }
.border-strong  { border-color: var(--color-border-strong); }
```

**Expected visual outcome:** No user-facing visual changes. Infrastructure only.

**Regression risks:** None. Purely additive.

**Validation:** Run `npm run build` — zero TypeScript errors. Verify theme.css is imported and variables are accessible in browser DevTools.

---

### Wave 2 — ProductCard Module Containment

**Objective:** Extract `ProductCard` from `ProductGrid.tsx` into a standalone file and apply solid surface containment. This is the highest-impact single change in the system — it converts image regions into bounded objects.

**Files affected:**

| Action | File |
|---|---|
| CREATE | `src/components/ui/ResearchModule.tsx` |
| CREATE | `src/components/catalog/ProductCard.tsx` |
| MODIFY | `src/components/ProductGrid.tsx` — import new ProductCard |

**ProductCard composition:**
```
┌── research-surface-solid ─────────────────────────────────┐
│  [aspect-square image, overflow-hidden, flush to top]      │
│  ── border-t border-white/[0.06] ─────────────────────── │
│  [ModuleContent density="compact"]                         │
│    name (text-sm font-medium text-white tracking-tight)    │
│    description (text-xs text-white/45 line-clamp-2)        │
│  └─────────────────────────────────────────────────────── │
└────────────────────────────────────────────────────────────┘
```

**Hover behavior:**
- Border brightens: `border-white/[0.09]` → `border-white/[0.15]`
- Background lifts: `rgba(255,255,255,0.03)` → `rgba(255,255,255,0.055)`
- Image scales: `scale-[1.03]` (already present — keep)
- Name color: transitions to gold on hover (already present — keep)
- Transition: `var(--duration-fast) var(--easing-easeInOut)`

**Loading state:** 
Skeleton card: replace image + text with animated `bg-white/10 animate-pulse` blocks within the same card boundaries. The card maintains its shape during loading — no layout shift.

**Regression risks:**
- Grid layout: zero risk — `ProductGrid` manages the grid; card manages its own surface
- Existing hover interactions: image scale and name color already exist — preserve them
- Link behavior: `<Link>` wraps the entire card — this should wrap the module container

**Validation:**
- Mobile: single-column grid, cards have visible solid surface separation
- SM: 2-up grid, cards aligned correctly
- LG: 3-up grid, consistent card heights via CSS grid
- Hover: solid surface brightens on hover
- Loading: skeleton renders within card bounds (no spinner)

---

### Wave 3 — PillTabs Filter Bar

**Objective:** Add app-native filter/category switching to catalog pages using PillTabs.

**Files affected:**

| Action | File |
|---|---|
| CREATE | `src/components/ui/PillTabs.tsx` (transplant + adapt) |
| MODIFY | `src/pages/ResearchSupplies.tsx` |
| MODIFY | `src/pages/LaboratoryEquipment.tsx` |

**PillTabs research adaptation:**

The VelariNights PillTabs uses `bg-surface-elevated backdrop-blur-md`. For research:
```
Container: bg-white/[0.04] backdrop-blur-sm border border-white/[0.09] rounded-2xl p-1.5
Active tab: bg-white/[0.08] text-white rounded-xl shadow-sm
Inactive tab: text-white/55 hover:text-white/80
```

**Initial filter state for catalog pages:**
```
All  |  In Stock  |  New Arrivals
```

Note: The actual filtering logic should use the existing `useProducts` hook or be stubbed with a `console.log` if backend filtering is not yet wired. The visual component is the deliverable for Wave 3 — the filtering functionality can be wired in Wave 3b.

**Regression risks:**
- Page header: `PillTabs` inserts between the existing header and the product grid — no structural changes to either
- Product grid: untouched
- URL state: if filter state should be URL-driven (e.g., `?filter=in-stock`), defer this to a separate pass

**Validation:**
- PillTabs renders below the page header and above the product grid
- Active tab has visible selected state
- Transition between tabs is smooth (`var(--duration-fast)`)
- Container does not visually compete with the page header or the product grid

---

### Wave 4 — CartPage Module Restructure

**Objective:** Convert CartPage from flat stacked layout to a 2-column module-composed layout on desktop, with solid/glass surface containment on both mobile and desktop.

**Files affected:**

| Action | File |
|---|---|
| MODIFY | `src/pages/CartPage.tsx` — significant layout restructure |

**Implementation approach:**

This wave modifies the most complex page in the app. It must be approached as a layout restructure, not a style change. All existing business logic (form state, validation, submit, quantity controls, per-item notes) must be preserved exactly. Only the layout and surface treatment change.

**Desktop layout:**
```tsx
<div className="grid grid-cols-1 lg:grid-cols-12 gap-[var(--space-6)] py-[var(--space-8)]">
  {/* Items column */}
  <div className="lg:col-span-8">
    <div className="research-surface-solid overflow-hidden">
      {/* existing hairline item rows rendered inside this container */}
    </div>
  </div>

  {/* Inquiry summary/form column */}
  <div className="lg:col-span-4">
    <div className="research-surface-glass sticky top-[calc(56px+var(--space-4))]">
      {/* existing form fields + submit */}
    </div>
  </div>
</div>
```

**The `sticky` summary column:** On desktop, the inquiry summary/form panel should use `sticky top-[calc(56px+var(--space-4))]` so it stays visible as the items column scrolls. `56px` = GlobalHeader height + 2px.

**Mobile:** The grid collapses to 1 column. Items render first (solid surface), form renders below (glass surface). The glass form on mobile loses none of its CTA prominence — it's the last thing the user reaches before submitting.

**Regression risks (HIGH):**
- Form logic: the `handleSubmit`, validation, touched state, and success/error state are untouched — they move into the new layout structure without modification
- Per-item notes: the note expansion logic is self-contained per item — no change
- Success state: renders outside the grid layout entirely — no change
- Empty state: renders outside the grid layout — no change
- Mobile sticky footer: the ProductPage sticky footer is unrelated; this is CartPage only

**Validation:**
- Mobile: items stacked (solid surface), form below (glass surface)
- Desktop: 2-column layout, form is sticky on the right
- All existing form functionality works identically
- Submit triggers, validation, success state, error state all function correctly
- Glass surface renders correctly (backdrop-filter visible, border visible)
- One glass surface on screen — no other glass elements

---

### Wave 5 — ProductPage Info Panel (Desktop Only)

**Objective:** Apply solid surface containment to the product info column on desktop. No mobile changes.

**Files affected:**

| Action | File |
|---|---|
| MODIFY | `src/pages/ProductPage.tsx` — info column surface only |

**Implementation approach:**

The product info column (`lg:col-span-5`) gets a research-surface-solid wrapper on desktop only:

```tsx
<div className="lg:col-span-5 flex flex-col">
  {/* Existing flat content on mobile */}
  {/* lg: wraps in solid surface */}
  <div className="lg:research-surface-solid lg:p-[var(--space-6)]">
    {/* ... existing info content ... */}
    
    {/* Spec sub-panel — desktop only, elevated surface */}
    {product.specs.length > 0 && (
      <div className="lg:research-surface-elevated lg:overflow-hidden lg:mb-[var(--space-8)]">
        <dl>
          {/* existing hairline spec rows */}
        </dl>
      </div>
    )}
    
    {/* ... remaining info content ... */}
  </div>
</div>
```

**Important:** The surface wrapper uses `lg:` prefix on ALL surface classes. On mobile, the column remains completely flat. Do not add any surface classes that apply below the `lg` breakpoint.

**Regression risks (LOW):**
- Mobile layout: completely unchanged
- Desktop image column: completely unchanged
- Related products strip: completely unchanged
- Mobile sticky CTA: completely unchanged

**Validation:**
- Mobile: product page looks identical to current
- Desktop (`lg+`): info panel has visible surface separation from the background
- Spec sub-panel reads as a distinct information object within the info panel
- The solid info panel does not visually compete with the product image

---

### Wave 6 — Shell Chrome Refinement

**Objective:** Upgrade the GlobalHeader surface from solid black to frosted black. Optionally upgrade BottomNav to match.

**Files affected:**

| Action | File |
|---|---|
| MODIFY | `src/layout/GlobalHeader.tsx` — header surface only |
| MODIFY | `src/layout/BottomNav.tsx` — optional, evaluate after header |

**GlobalHeader change:**
```
Current:  className="sticky top-0 z-40 bg-black border-b border-white/[0.06]"
Target:   className="sticky top-0 z-40 bg-black/80 backdrop-blur-sm border-b border-white/[0.06]"
```

`backdrop-blur-sm` = 4px blur (Tailwind default). This is LOWER than the research blur cap (8px) — appropriate for chrome that should be subtle. The header blur should not be the visual focus; it should be a background behavior.

**Regression risks (MINIMAL):**
- The header structure, layout, and all interactive elements are unchanged
- Cart badge: unchanged
- Logo link: unchanged
- Hamburger: unchanged

**Validation:**
- Scroll any content-rich page; the header should appear to float above scrolling content
- No content "bleeds through" the header in an unintended way at any scroll position

---

## 9. DESIGN SYSTEM TRANSPLANT RULES

### 9.1 Permitted Extractions from VelariNights

These files may be lifted from VelariNights and adapted for the research site:

| File | Action |
|---|---|
| `src/ui/theme/types.ts` | Safe lift — zero deps, TypeScript type definitions only |
| `src/ui/theme/tokens.ts` | Safe lift — imports types.ts only |
| `src/ui/theme/cssVariables.ts` | Safe lift — DOM utility functions, no app logic |
| `src/ui/theme/presets/classy-dark.ts` | Safe lift — the single canonical preset |
| `src/components/ui/motionTokens.ts` | Safe lift — zero deps, JS motion constants |
| `src/components/ui/motionUtils.ts` | Safe lift — imports motionTokens only |
| `src/components/ui/ModuleShell.tsx` | Safe lift — must change default surface to 'solid' |
| `src/components/ui/VelariShell.tsx` | Safe lift — use only for glass CTA surfaces |
| `src/components/ui/ModuleHeader.tsx` | Safe lift — zero deps |
| `src/components/ui/ModuleContent.tsx` | Safe lift — imports cn utility only |
| `src/components/ui/GlassAccent.tsx` | Safe lift — zero deps |
| `src/components/ui/Button.tsx` | Upgrade existing — richer variants, loading, asChild |
| `src/components/ui/PillTabs.tsx` | Safe lift — research color adaptation required |
| `src/components/ui/Badge.tsx` | Safe lift — minor reconciliation |
| `src/components/ui/Select.tsx` | Safe lift — form primitive |
| `src/components/ui/Textarea.tsx` | Safe lift — form primitive |
| `src/components/ui/Toggle.tsx` | Safe lift — form primitive |
| `src/components/ui/ButtonGroup.tsx` | Safe lift — layout primitive |
| `src/components/ui/NoiseBackground.tsx` | Adapt — remove pill wrapper; use for atmospheric hero layers only |

### 9.2 Forbidden Extractions — Do Not Import

The following must never enter the research site codebase under any circumstances:

**App Logic:**
```
src/dal/**                     — Supabase data access layer
src/store/**                   — Zustand app state stores
src/lib/auth/**                — Authentication logic
src/providers/**               — App-level providers (QueryClient, etc.)
src/hooks/**                   — Data hooks (queries, mutations)
src/adapters/**                — Data adapters
src/pages/**                   — Route pages
```

**Role / Permission System:**
```
src/components/admin/**
src/components/portal/**
src/components/door/**
src/components/mission-control/**
src/dal/roles/**
```

**Event / Booking / Ticketing System:**
```
src/components/booking/**
src/components/event/**
src/components/events/**
src/components/tickets/**
src/components/payments/**
src/components/split-pay/**
src/components/passes/**
src/components/receipts/**
```

**Social / Discovery:**
```
src/components/social/**
src/components/groups/**
src/components/discovery/**
src/components/map/**
src/components/talent/**
```

**Ticket / Card Variant System:**
```
src/ui/variants/**             — ALL variant files (holo, role, season, card frame)
src/ui/theme/holo.tokens.ts
src/ui/theme/season/**
```

**Multi-Theme Preset System:**
```
src/ui/theme/presets/tech-*.ts
src/ui/theme/presets/industrial-*.ts
src/ui/theme/presets/retro95-*.ts
```

**App-Coupled UI Components:**
```
src/components/ui/WizardShell.tsx           — booking wizard
src/components/ui/GlassCalendarShell.tsx    — booking calendar
src/components/ui/OTPInput.tsx              — phone auth
src/components/ui/UsernameSearchInput.tsx   — social feature
src/components/ui/InlineUpsellBanner.tsx    — premium upsell
src/components/ui/DateTimeInput.tsx         — event scheduling
src/components/theme/ThemeControls.tsx      — admin theme switcher
```

**Superseded by research-site versions:**
```
src/components/ui/AnimatedPortalShell.tsx   — research version is superior
src/ui/theme/ThemeProvider.tsx              — research version is simpler and correct
```

### 9.3 Anti-Contamination Rules

When lifting code from VelariNights:

1. **Never copy imports verbatim.** All `@/lib/utils` imports must resolve to `src/lib/utils.ts` in the research site.

2. **Never copy multi-theme logic.** The research site has one theme (`classy-dark` with a `classy-light` toggle). Any preset registry or `ThemeFamily` switching logic from VelariNights must be stripped.

3. **Never copy role-aware logic.** The `ModuleRole` type (`guest | creator | owner | admin`) exists in `ModuleShell.tsx` but produces no visual effect in the research site. It may be present but must never be used programmatically.

4. **Never copy event-specific CSS classes.** Any class that contains `card-flip`, `card-shimmer`, `card-glow`, `scan-flash`, `door-scanner`, `holo`, or `role-accent` must be excluded.

5. **Never copy VelariNights `theme.css` wholesale.** The research site's `theme.css` is a clean, forward-compatible version. Importing VelariNights' `theme.css` would introduce deprecated tokens, role-accent classes, scan animations, and deprecated semantic aliases.

---

## 10. REFERENCE-DRIVEN DESIGN WORKFLOW

### 10.1 Principle

No visual change should be implemented without an explicit reference anchor — a screenshot, a defined component from the blueprint, or a verbatim specification from this document. "Looks good" is not a sufficient implementation criterion.

### 10.2 Reference Hierarchy

When making a visual decision, consult references in this order:

1. **This document (COMPOSITION_SYSTEM_BLUEPRINT.md)** — highest authority
2. **VelariNights screenshots** — for understanding how the component system behaves at scale
3. **Figma assets** (if available in `/figma/`) — canonical design references
4. **VelariNights source code** — for implementation patterns only, never for values

### 10.3 Screenshot Ingestion Process

When screenshots are provided as visual references:

1. Read the screenshot using the Read tool (the model can view images)
2. Identify which components from this blueprint are present
3. Note any deviations from this document's specifications
4. Flag deviations before implementing — do not silently adopt them
5. Document the reference source in the implementation comment

### 10.4 Anti-Drift Rules

**Before implementing any visual change:**
- Identify the relevant section in this document
- Read the exact specification values
- Use those values, not visual approximations

**When a component "looks right" but uses different values:**
- Use the document values, not the visual approximation
- The document values are calibrated for the research aesthetic
- Visual approximations drift toward VelariNights' louder aesthetic over time

**The drift failure mode:** When implementing without this document, models tend toward the "more obvious" design decision — higher opacity, more blur, more shadows. These choices each individually look reasonable but collectively recreate the nightlife aesthetic. This document prevents cumulative drift.

### 10.5 Approval Flow

No visual system change may be implemented without explicit user approval. This includes:
- Changing surface opacity values
- Changing blur values
- Adding new surface levels not defined in §3
- Modifying the shell architecture
- Adding new navigation elements
- Introducing animation patterns not defined in this document

Implementation of content (product data, copy, images) does not require architectural approval.

---

## 11. HARD CONSTRAINTS

These are absolute prohibitions. No context, no exception.

### 11.1 Surface Constraints

- **NEVER** use `backdrop-filter: blur()` greater than `8px` on any surface in the research site
- **NEVER** apply glass treatment to more than one element per screen state
- **NEVER** nest glass surfaces (no glass inside glass)
- **NEVER** use `rgba(255,255,255,0.14)` or higher as a module background — this is VelariNights intensity
- **NEVER** add ambient glow effects to content modules (the `velari-ambient-glow` class is for landing hero only, if used at all)
- **NEVER** apply unbounded surfaces (every surface must have a defined border-radius)

### 11.2 Aesthetic Constraints

- **NEVER** introduce gradients on content surfaces (gradient-gold and gradient-olive in `tailwind.config.js` exist for button variants only, not for background treatments)
- **NEVER** add decorative elements (noise textures, grain overlays, pattern fills) without explicit architectural approval
- **NEVER** use purple (`#A78BFA`, `--color-accent`) as a primary accent — gold is the sole accent color
- **NEVER** reproduce the VelariNights nightlife palette (neon colors, high-saturation accents, atmospheric gradients)
- **NEVER** add role-based visual indicators (colored left-border stripes, role badge colors)

### 11.3 Architecture Constraints

- **NEVER** make the Landing page or Contact page more complex — they are complete
- **NEVER** add navigation elements outside the GlobalHeader and BottomNav
- **NEVER** create page-level layout patterns that override the `AnimatedPortalShell` content column
- **NEVER** create a module that nests deeper than 2 surface levels (Level 1 → Level 2; no Level 3 nesting)
- **NEVER** use the multi-theme preset system — the research site has one theme

### 11.4 Style Anti-Patterns

- **NO** SaaS dashboard aesthetic (sidebar navigation, data-dense KPI cards, metrics grids)
- **NO** generic Tailwind component library aesthetic (shadcn/ui defaults without customization)
- **NO** Shopify/WooCommerce storefront aesthetic (product grids with add-to-cart buttons and price tags as primary UI)
- **NO** component improvisation — every new component must map to a definition in this document or must be explicitly approved

### 11.5 Motion Constraints

- **NEVER** use animation duration greater than `var(--duration-slower)` (500ms) for any interaction-triggered animation
- **NEVER** add decorative animations (floating elements, parallax, continuous motion) to content modules
- **NEVER** animate size or layout properties (width, height, padding, margin) — only opacity, transform, and color
- All motion must respect `prefers-reduced-motion` via the CSS block in `src/theme/theme.css`

---

## 12. IMPLEMENTATION SAFETY RULES

### 12.1 Additive-First Migration

Every wave is additive. New components are created. Existing components are upgraded, not replaced wholesale.

The sequence for upgrading an existing component:
1. Read the existing component completely
2. Identify what changes and what stays
3. Make targeted edits — do not rewrite the file
4. Preserve all existing prop names and defaults
5. Run the build and verify no type errors
6. Validate on mobile first, then desktop

### 12.2 Low-Risk Sequencing

Waves 1–3 carry zero regression risk (they are purely additive).
Waves 4–5 carry low-to-medium regression risk (they modify existing pages).
Wave 6 carries minimal regression risk.

Never implement Wave 4 before Waves 1–3 are validated.  
Never implement Wave 5 before Wave 4 is validated.  
Never implement Wave 6 at the same time as any other wave.

### 12.3 No Broad Rewrites

If implementing a wave requires rewriting more than ~50 lines of an existing file, stop and reassess. Broad rewrites carry high regression risk and indicate that the wave is likely trying to accomplish too much in one pass.

### 12.4 Mobile-First Verification

Every visual change must be verified on a mobile viewport (375px width) before being considered complete. The mobile experience is canonical — if it breaks on mobile, the implementation is incorrect regardless of how it looks on desktop.

Use browser DevTools responsive mode with `iPhone 14` or equivalent (390px × 844px) as the mobile reference viewport.

### 12.5 Desktop Validation Requirements

After mobile verification, validate at:
- `640px` — SM breakpoint (2-column product grid)
- `1024px` — LG breakpoint (3-column product grid, 2-column transactional)
- `1280px` — standard desktop (max-width constraint kicks in, content is centered)

### 12.6 Token-Only Styling Rules

All hardcoded pixel values and color values must use CSS custom properties where a token exists. The following hardcoded values are permitted in inline CSS and Tailwind classes:

**Permitted hardcoded values:**
- Tailwind opacity shortcuts: `white/[0.06]`, `white/40`, `black/80` (where no token equivalent exists)
- Layout-specific values: `max-w-[1100px]`, `top-[calc(56px+var(--space-4))]`
- Ratio values: `aspect-square`

**Forbidden hardcoded values:**
- Animation durations in ms (use `var(--duration-fast)` etc.)
- Color hex codes in component styles (use `var(--color-*)` tokens)
- Border-radius values (use `var(--radius-*)` tokens)
- Shadow values (use `var(--shadow-*)` tokens)
- Font sizes outside the Tailwind `text-*` scale (use `var(--text-*)` tokens for semantic roles)

---

## 13. FUTURE SYSTEMS (INTENTIONALLY DEFERRED)

The following systems are explicitly NOT part of the current implementation scope. They are noted here so that future models do not attempt to implement them without explicit direction.

### Authentication and User Profiles
The `AdminGate` component (`src/pages/admin/AdminGate.tsx`) exists as a placeholder. No authentication system, user profile pages, login flows, or role-based access control should be implemented. The `GlobalHeader` accepts a `role` prop but it defaults to `'guest'` and no role-switching is implemented.

### Invoice and Order Workflows
The inquiry system (CartPage → Supabase Edge Function) is the complete commerce workflow for this phase. No order confirmation pages, invoice generation, payment processing, or fulfillment workflows are in scope.

### Advanced Filtering and Search
Wave 3 introduces PillTabs for basic category filtering. Full-text search, faceted filtering, price range filtering, and sort systems are deferred.

### Admin Expansion
The admin pages (`AdminList`, `AdminEdit`) are minimal scaffolds for product management. No admin analytics, inventory management, order management, or admin design system work is in scope.

### Backend Complexity
The Supabase schema and Edge Functions are sufficient for the current inquiry workflow. No new database tables, functions, or API endpoints should be added without explicit architectural direction.

### Multi-Theme System
The research site uses one theme (classy-dark with a light-mode toggle). The ThemeProvider is intentionally simplified relative to VelariNights. No additional theme presets, theme switcher UI, or theme customization systems should be introduced.

### NoiseBackground and Atmospheric Hero
`NoiseBackground.tsx` from VelariNights may eventually be adapted for use in a future landing page enhancement. It is not part of any current wave and should not be implemented until explicit direction is given.

---

## 14. FINAL NORTH STAR

The intended final feeling of the VS Research Labs product, when all waves are complete:

You open the app on your phone. The screen is black, almost entirely. The header is a precision bar — a logo centered, a cart icon to the right, minimal. You tap "Research Supplies" in the bottom navigation. The page transitions with a short, purposeful animation — not a fade-in, not a slide, a precise opacity-and-y movement that feels like an instrument changing state.

The catalog appears. The product cards are dark, contained objects — each one a bounded rectangle sitting slightly above the page. You can feel where one card ends and another begins. A filter strip sits above the grid: frosted pills, small, precise. You tap "In Stock." The grid updates.

You tap a product. The detail page opens. On mobile: image, then information, sequential and clear. On your laptop: the image is on the left, large. On the right, a contained panel — solid, darker than the page, slightly elevated. Inside it: the product name in light-weight type, a specification table with hairline rows, a gold pill button at the bottom. The button is the only warm thing on the screen.

You tap "Add to Inquiry." You navigate to the cart. On mobile: your items, contained in a dark module, then a frosted form panel below it. On desktop: items on the left, form on the right — the form panel has a gentle frosted glass treatment, the only glass surface in view. You fill in your name and email. You tap "Send Inquiry."

Nothing about this experience feels like a website. It feels like a piece of software. It feels like it was built for precision, for repeat workflows, for people who know what they're doing and need the interface to get out of the way.

It is restrained. It is precise. It is dark. It is, deliberately, almost nothing — and that restraint is the premium signal.

---

*End of COMPOSITION_SYSTEM_BLUEPRINT.md*

*This document is authoritative. Any implementation that contradicts this document is incorrect. Any future architectural decision that affects the systems described here must be documented as an update to this file before implementation begins.*
