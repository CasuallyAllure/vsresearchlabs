# DESIGN 2026 BLUEPRINT — VS Research Labs

> **Status: ACTIVE design direction of record (2026-07).** Supersedes the "flat editorial,
> never glassy" doctrine in DESIGN.md §6 and the 4px procurement-radius register. Everything
> else in DESIGN.md (palette, fonts, voice, price-path rules) still applies.
>
> Derived from the installed design skills (ui-ux-pro-max, web-design-guidelines,
> emil-design-eng, high-end-visual-design, redesign-existing-projects,
> make-interfaces-feel-better, gpt-taste, impeccable) + a full 4-agent audit of every surface.

## 0. Mission

Kill the early-2000s "spec sheet" read (sharp 4px corners, 1px hairline grids, 8–10px
uppercase mono everywhere, zero elevation, dense bordered tables) and replace it with a
**2026 register: floating glass-adjacent modules, soft 14–24px radii, layered diffused
elevation, generous Claude-app spacing** — while KEEPING:

- The **silver/graphite/cream monochrome palette** exactly as-is (owner-confirmed). No new hues.
- The **brand fonts** (Cormorant Garamond / Inter / IBM Plex Mono). The skills would swap
  Inter; the brand identity is locked, so the 2026 feel comes from surfaces + spacing instead.
- Dark mode (`html[data-theme="dark"]`), category color mapping, red compliance text,
  stock-status colors.
- ALL business logic. **This is a styling-only pass**: className/markup/CSS changes only.
  Never touch handlers, props, data flow, price paths (`effectiveTierPriceCents`),
  `variantProduct`, RPC calls, print behavior.

## 1. TOKEN LAYER (theme.css — single source of cascade)

### 1.1 Radius (retuned)
```
--radius-procurement: 14px;   /* WAS 4px — this one change reshapes ~40 files */
--radius-card: 24px;          /* unchanged; use for hero/floating modules */
--radius-module: 20px;        /* NEW — standard content card */
--radius-field: 12px;         /* NEW — inputs/selects/textareas */
--radius-chip: 9999px;        /* chips/badges are pills now, not 2–4px rects */
```
Concentric rule: nested radius = outer − padding (`rounded-[calc(20px-8px)]` inside a
`rounded-[20px] p-2` shell). Never the same radius on parent and child.

### 1.2 Elevation (tinted, layered, one light source from above)
```
--elev-1: 0 1px 2px rgba(30,28,24,0.04), 0 4px 16px -6px rgba(30,28,24,0.08);
--elev-2: 0 2px 4px rgba(30,28,24,0.05), 0 14px 36px -10px rgba(30,28,24,0.12);
--elev-3: 0 8px 32px rgba(30,28,24,0.10), 0 28px 72px -18px rgba(30,28,24,0.20);
/* dark theme overrides: same structure, rgba(0,0,0,0.45/0.55/0.65) */
```
Shadows are warm-tinted on cream, deep neutral on black — never raw `rgba(0,0,0,.3)` in light.

### 1.3 Glass (new utilities; blur ONLY on fixed/sticky/overlay chrome)
```
Light: background rgba(255,253,248,0.65); backdrop blur(16px) saturate(150%);
       border 1px rgba(20,20,20,0.08); inset 0 1px 0 rgba(255,255,255,0.6) + --elev-2.
Dark:  background rgba(22,22,24,0.60); blur(16px) saturate(160%);
       border 1px rgba(255,255,255,0.10); inset 0 1px 1px rgba(255,255,255,0.08) + --elev-3.
```
- `.glass-panel` — header/drawers/modals/sheets/sticky filter bars/dropdown menus ONLY.
- `.floating-module` — the new standard content card: **solid** elevated fill (no
  backdrop-filter — perf), `--radius-module`, inset top highlight, `--elev-1`,
  hover → `--elev-2` + border deepen (interactive only). Replaces the visual role of
  `.research-surface-solid`; the old class itself gets retuned (radius/border/shadow)
  so all existing usage upgrades for free.
- Glass must always have all three: blur + 1px border + inset highlight. Never bare
  transparency. Never backdrop-blur on scrolling content containers.

### 1.4 Type floor (LEGIBILITY — the #2 dated signal)
- **Nothing below `text-[10px]`. Ever.** Existing 7/8/8.5/9/9.5px → 10px minimum (dense
  admin meta may stay 10px; prefer 11px).
- Eyebrows/captions: `text-[10px]–[11px] uppercase`, tracking capped at `0.22em`
  (0.25–0.3em only for the single page-level eyebrow).
- Body: 13px floor, prefer 14px. Section labels: consider 11px sentence-case
  `text-ink/55 font-medium` instead of uppercase micro-caps where it's not an eyebrow.
- Keep `font-mono tabular-nums` for all identifiers/prices (brand DNA — stays).

### 1.5 Spacing
Keep the 4px token scale. Direction: **more air** — cards `p-5`→`p-6` where cramped, section
gaps `space-4`→`space-6`, list rows `py-3`→`py-4`. Replace "hairline divider between
touching boxes" with **gap + separate floating modules** wherever the list is short
(≤6 items); keep `divide-y` inside a single module for long data lists but soften to
`divide-ink/[0.05]` and add row padding.

### 1.6 Color discipline
All the hardcoded hex found in audit (`#2E7D5B #B23A3A #B5904B #8C6A2F #34727A #8a6d34`,
inline rgba badges) must route through `--color-status-*` / accent tokens or Tailwind
token classes. EXCEPTION: `InvoiceDocument.tsx` print palette + CartPage `print:*`
classes are functional print fidelity — DO NOT TOUCH.

## 2. COMPONENT PRIMITIVES (single source, no drift)

- **Button** (`components/ui/Button.tsx`) — stays the only button. Retune: min-height
  `sm:32px / md:38px / lg:44px`, `:active` scale(0.98) 140ms, visible
  `focus-visible:ring-2`. Every hand-rolled pill (`rounded-full border border-ink/30
  px-2.5 py-[3px] text-[8.5px]` in admin/account/cart) is replaced by `<Button>`.
- **Field** (`components/ui/Field.tsx`) — THE input. `--radius-field`, inset shadow,
  silver focus ring (`focus:ring-2 ring-gold/20` — reads silver now). Contact, CartPage,
  CartDrawer, TrackOrder, and the 3 divergent admin field styles all converge on it
  (or copy its exact classes where the primitive doesn't fit, e.g. selects/textareas —
  add `SelectField`/`TextAreaField` variants in Field.tsx if needed).
- **OrderStatusChip + statusChipStyles** — one shared `StatusChip`: `rounded-full px-2.5
  py-1 text-[10px] tracking-[0.14em]`, token status colors, optional leading dot. Kill the
  4 duplicated `statusChipStyles()` copies (AdminCustomers, AdminCustomerDetail,
  AdminInquiries, CustomerAccountPanels).
- **Modals/ConfirmModal/ModuleModal/OrderModal/InvoiceDocument shell** — scrim
  `bg-ink/50 backdrop-blur-[8px]`; panel `.glass-panel rounded-[24px] --elev-3`; enter
  `scale(0.96→1)+opacity 200ms ease-out` gated by reduced-motion. (InvoiceDocument: only
  the modal CHROME/backdrop may change — the printable doc inside stays untouched.)
- **Tables → responsive DataList grammar.** Promote AdminInventory's `md:hidden` card
  fallback into the norm: every `min-w-[480–1000px]` table (admin Orders/Coupons/AuditLog/
  StockHistory/Import/Inquiries/OrderView, catalog InventoryTable) renders stacked
  label/value floating cards below `md:`; desktop keeps the table but: container
  `.floating-module` + `rounded-[14px] overflow-hidden`, `th` 10–11px `tracking-[0.14em]
  py-3`, `td py-3 text-[12px]`, row hover `bg-ink/[0.02]`, no `border-collapse` hard grid
  look. 44px min row tap height on admin.
- **Progress/status bars** — step bars go `h-[6px] rounded-full` with 10px labels,
  soft track `bg-ink/[0.08]`.

## 3. MOTION (crisp, not bouncy)

- Durations: press 120–160ms · dropdown 180ms · modal/drawer 200–280ms; exits ~70% of enter.
- Easing: custom ease-out `cubic-bezier(0.23,1,0.32,1)`; drawers `cubic-bezier(0.32,0.72,0,1)`.
  Never `transition: all`, never `ease-in`, never animate layout props — transform/opacity only.
- Hover states gated `@media (hover:hover)`. Everything gated by `prefers-reduced-motion`
  (the global reduce block already exists — keep it).
- DnaVMark stays still (brand rule). No glows/neon/scanlines/sheens — retired stays retired.

## 4. PER-SURFACE PRESCRIPTIONS

### Wave 2 — Public
| Surface | Fix |
|---|---|
| ProductPage | **Worst offender.** Sharp 0-radius inline-bordered panels → `.floating-module` columns (`rounded-[20px]`, elev-1, `p-6`); internal hairline-stacked sections get breathing room (`py-5`), keep mono identifiers; 8–9px labels → 10–11px. |
| Catalog / InventoryTable | Desktop table → DataList grammar (§2); search input → Field classes; result-count label 11px. |
| Category pages + ClassificationFilter | Filter bar → `rounded-full` glass-lite bar (`bg-ink/[0.03] border-ink/[0.08] rounded-full`), controls ≥40px tall; CompactProductTile → `rounded-[14px]`, 8/8.5px labels → 10px, dose chips → pills. |
| ProductCard | Radius cascades free (14px); image bay `rounded-[10px] overflow-hidden` inset; add-btn label 10px+, ≥40px hit area. |
| ResearchSuppliesHub | Full-width hairline row list → floating module rows (`.floating-module p-6` each, `gap-4`), keep serif titles + arrow. |
| DocumentDetail / DocumentCard / DocumentSlot | dl hairline rows → grouped inside one floating module with `divide-y divide-ink/[0.05] rounded-[20px]`; thumbnail `rounded-[14px]`; DocumentCard keeps registration ticks (brand charm) but 14px+ radius. |
| Contact | Delete local field clone → shared `Field`/`TextAreaField`; topic buttons → pill toggles ≥44px. |
| Landing | Already best-spaced. RouteRow cards inherit new radius; hero CTAs → `<Button>`; keep editorial numerals + module rhythm. |
| GlobalFooter | 8.5–9px → 10–11px; keep single border-t. |
| Legal/NotFound/Documentation/Research | Inherit tokens; bump micro-type; PillTabs fine as-is. |

### Wave 3 — Shop + Account
| Surface | Fix |
|---|---|
| CartPage | Columns become floating modules (cascade); inputs → Field classes (12px radius + ring); square thumbs → `rounded-[10px]`; ship badges → pills with token colors (kill inline rgba styles); **print view untouched**. |
| CartDrawer | Panel = `.glass-panel`; 8.5px headers → 10px; thumbs `rounded-[8px]`; inputs → Field classes; checkbox → styled `accent-gold` 16px+; CTAs → `<Button fullWidth>`. |
| TrackOrder | Modules cascade; address inputs → Field classes; step bar §2 grammar; 8.5px labels → 10px. |
| Account suite | Mostly cascades. AccountLayout crumb 8.5px → 10px; hand-rolled empty-state buttons → `<Button>`; AccountRewards `KIND_CLASS` hex → status tokens; OrderStatusChip → StatusChip pill. |

### Wave 4 — Admin (375px is the floor; Compact Chrome direction stays)
| Surface | Fix |
|---|---|
| AdminLayout | Command bar text 8.5px → 10px; nav dropdown menu → `.glass-panel rounded-[16px]`; sign-out/back ≥40px hit areas (visual size can stay compact — extend hit area via padding/pseudo). |
| AdminFilterBar | Trigger ≥40px tall; menu → glass-panel; option rows py-2.5 text-[12px]. |
| All min-w tables | DataList grammar (§2): mobile card fallback + softened desktop table. Priority: Inventory (already has fallback — restyle it), Orders, Coupons, AuditLog, StockHistory, Import, Inquiries. |
| OrderView | 7–9px chips/labels → 10px floor; status bar → §2 progress grammar; line-item list rounded-[14px]; **printable invoice table untouched**. |
| Field consolidation | AdminEdit `rounded-lg bg-ink/40`, CouponPicker `rounded-[8px]`, ConfirmModal/NewOrder/CustomerAccountPanels `rounded-sm` → one Field grammar (12px + ring). |
| Pills → Button | Every `py-[3px] text-[8.5px]` pill → `<Button size="sm">` (32px+). |
| StatusChips | → shared StatusChip; kill hardcoded hex. |
| StatModules/PerformanceSummary | KPI tiles cascade; keep the clean KPI register (it's already the most modern admin surface). |

## 5. HARD BANS (from the skills — reject in review)

Sharp <10px corners on cards/inputs · text below 10px · `transition: all` · `ease-in` ·
animating width/height/top/left · backdrop-blur on scrolling content · glass without
border+highlight · hardcoded hex outside print docs · `window.confirm/prompt` (iOS no-op) ·
hover-only affordances · tap targets <40px on admin/mobile · new accent colors · neon/glow/
scanline/sheen effects · `h-screen`/`100vh` (use `min-h-[100dvh]`) · removing focus rings ·
`user-scalable=no` · color-only status meaning (pair dot/label) · pure #000 backgrounds.

## 6. DO-NOT-TOUCH LIST (functional)

- `InvoiceDocument.tsx` printable doc internals: `@media print` visibility block,
  `.print-doc`/`.no-print`, border-collapse table, hardcoded print palette, hard corners.
- CartPage `print:*` classes and receipt print behavior.
- All business logic, hooks, RPC calls, price paths, cart flows, Turnstile, auth.
- `theme.css` dark-theme channel structure (extend it, never fork it).
- DnaVMark / logo assets; category color mapping; compliance red text.

## 7. VERIFICATION GATE (every wave)

1. `npx tsc --noEmit` + `npm run build` green.
2. Preview at 1280px AND 375px, light AND dark (`html[data-theme="dark"]`).
3. web-design-guidelines audit pass on changed surfaces (focus rings, contrast on glass
   ≥4.5:1, touch targets, reduced-motion).
4. No hard-ban violations (§5). No logic diffs (`git diff` shows className/markup only).
