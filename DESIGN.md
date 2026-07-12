# VS Research Labs — DESIGN.md

> The design language of VS Research Labs (researchvault / vsresearchlabs.com), in the
> [awesome-design-md](https://github.com/voltagent/awesome-design-md) format. Drop this in,
> tell a coding agent "build me a page that matches DESIGN.md," and the output stays on-brand.
>
> **Source of truth:** `src/theme/theme.css` (CSS variables) + `tailwind.config.js`. If a value
> here ever disagrees with `theme.css`, `theme.css` wins — update this file to match.
>
> **⚠ 2026 UPDATE:** `docs/DESIGN_2026_BLUEPRINT.md` supersedes this file on SURFACES,
> RADIUS, ELEVATION, and GLASS: procurement modules are now 14px-radius floating modules
> (`--radius-procurement: 14px`), content cards use the layered `--elev-*` ramp, fixed/sticky
> chrome may use `.glass-panel`, chips are pills, and 10px is the type floor. The "flat
> editorial, never glassy" doctrine in §6 below is RETIRED. Palette, fonts, voice, and the
> price-path rules in this file still govern.

---

## 1. Visual Theme & Atmosphere

**Cream editorial · scientific instrument.** A warm off-white research dossier, not a neon lab.
The mood is a high-end specimen plate: quiet paper surfaces, classical serif headlines, monospace
identifiers, and restrained gold/teal accents drawn from the DNA·V brand mark. Near-black "display
case" insets hold the live 3D molecule and product vials so the science reads as the hero while the
page around it stays calm and institutional.

Design tenets: **restraint is a governor, not the mission** — every surface earns its ink. Flat
editorial shadows over glows. Motion is procedural and gated behind `prefers-reduced-motion`; the
static composition is always the accessible default.

A **black-and-silver dark mode** mirrors every token via `html[data-theme="dark"]`; gold and teal
are kept warm so they hold on black.

---

## 2. Color Palette & Roles

### Surfaces (light)
| Token | Hex | Role |
|---|---|---|
| `--color-surface-base` | `#F4EFE6` | Page cream |
| `--color-surface-elevated` | `#FBF9F4` | Cards / panels |
| `--color-surface-overlay` | `#FFFFFF` | Topmost / inputs |
| `--color-surface-sunken` | `#ECE6DA` | Recessed wells |
| `--color-display-base` | `#16130F` | Near-black display inset (molecule / vial bay) |

### Content
| Token | Hex | Role |
|---|---|---|
| `--color-content-primary` | `#1A1714` | Primary text (warm near-black) |
| `--color-content-secondary` | `#6B635A` | Secondary text |
| `--color-content-tertiary` | `#9A9186` | Tertiary / captions |
| `--color-content-inverse` | `#F4EFE6` | Text on dark/gold |

### Accents — Gold (primary) & Teal (secondary)
| Token | Hex | Role |
|---|---|---|
| `--color-accent-gold` | `#B5904B` | Primary action, brand gold |
| `--color-accent-gold-light` | `#C7A463` | Hover |
| `--color-accent-gold-dark` | `#8C6A2A` | Active / pressed |
| `--color-accent-teal` | `#3B6C6A` | Links, info, secondary accent (muted teal — deliberately NOT a vivid "hyper blue") |
| `--color-accent-teal-light` | `#6F9C9A` | Teal light |
| `--color-accent-teal-dark` | `#244E4D` | Teal hover/pressed |

### Status
`success #2E7D5B` · `warning #B5740B` · `error #B23A3A` · `info #34727A` — each with a `…Muted`
low-alpha fill for badges/callouts.

### Borders
Ink-on-cream hairlines: `subtle rgba(26,23,20,.06)` · `default .12` · `strong .22`. In Tailwind:
`border-ink/[0.08]`, `border-ink/15`, etc.

> **Category accent mapping** (keep consistent everywhere): peptides → gold · nootropics → teal ·
> skincare → grey · lab equipment → neutral.

---

## 3. Typography

| Family | Variable | Use |
|---|---|---|
| **Cormorant Garamond** (serif) | `--font-display` | Headlines, wordmark, hero display |
| **Inter** (sans) | `--font-sans` | Body, UI, labels |
| **IBM Plex Mono** (mono) | `--font-mono` | Identifiers (SKU/lot/order #), eyebrows, tabular data |

**Voice patterns — keep it THIN & minimal. Default to lighter weights; reserve `font-medium`+ for
genuine inline keyword emphasis or functional scannability, never for display type or buttons.**
- **Eyebrow / overline:** mono or sans, `text-[10px]–[11px]`, `uppercase`, `tracking-[0.22em]–[0.3em]`, `text-ink/45`.
- **Headline / page title:** `font-light` (uniform — NOT two-tone weight), `clamp(1.5rem, 2.8vw, 2rem)`,
  `leading-[1.1]`, `tracking-[-0.02em]`. A subtle color step (`text-ink/85` → `text-ink`) is fine; a
  weight step is not.
- **Product names / card & overlay headings:** `font-normal` (not medium).
- **Buttons:** `font-normal` (set in the `<Button>` primitive).
- **Body:** `13px–14px`, `leading-relaxed`, `text-ink/70–85`, max width `~58–64ch`.
- **Identifiers:** mono, `tabular-nums`, `11px–13px`.

---

## 4. Component Styling

### Inputs (`src/components/ui/Field.tsx`)
- Surface `bg-base-700` (white), `border border-ink/12`, **`rounded-[10px]`** (soft/premium, not 2px),
  `px-[14px] py-[11px]`, `text-[14px]`, with a faint inset `shadow-[inset_0_1px_2px_rgba(26,23,20,0.035)]`.
- Hover: `hover:border-ink/20`. **Focus: gold ring** — `focus:border-gold/70 focus:ring-2 focus:ring-gold/15`,
  `focus:outline-none`. The gold ring is the high-end tell; don't go back to a plain border darken.
- Label above: `text-[11px] uppercase tracking-[0.22em] text-ink/55`, with ` — required` in normal case.
- Error: `border-red-500/55` + `focus:ring-red-500/15`; uppercase `text-[11px] tracking-[0.2em] text-red-400` line beneath.

### Buttons — ALWAYS the `<Button>` primitive (`src/components/ui/Button.tsx`)
Never hand-roll a button. Use `<Button variant size>` so the look can't drift.
- **Register:** pill (`rounded-full`), `uppercase`, `tracking-[0.14em]`, min text `10px`, slim height.
  **No `translateY` lift, no sheen sweep.** Hover brightens/deepens only.
- **Variants:** `primary` (refined gold **gradient**, `.cta-mint`) · `secondary` (teal/ink outline,
  `.cta-holo`) · `ghost` (quiet text action).
- **`primary` gold is a gradient, NOT a flat fill:** `linear-gradient` gold-light → gold → gold-dark,
  with `inset 0 1px 0 rgba(255,255,255,.24)` top highlight + a tight `0 2px 6px` contact shadow.
  Hover = `filter: brightness(1.045)`. This is the "billion-dollar" depth — flat gold reads cheap.
- **Sizes (slim):** `sm` (px-16 py-7, 10px) · `md` (px-20 py-9, 10.5px) · `lg` (px-26 py-11, 11px).
- **Polymorphic:** `<button>` by default; pass `to=` for a router `Link`, `href=` for an `<a>`.
- Reserve `tracking-[0.25em]+` for micro eyebrows, never buttons.
- `.cta-*-sheen` classes are retired no-ops. Subtle gradient + contact shadow = good; sheen sweep,
  hover-lift, and ambient neon glow = retired, don't reintroduce.

### Card / panel
- `.holo-surface` — elevated cream, `border-ink/[0.06]`, soft `0 1px 2px` shadow; hover deepens border + lift.
- `.research-surface-solid` — procurement module: `--surface-product` fill, `--radius-procurement` (4px), a lit top inset edge + soft drop ("dark-saber" lift). Use for line items, receipts, data modules.
- Radii: cards `--radius-card` (24px); procurement modules `4px`; pills `9999px`.

### Links
Teal, `underline underline-offset-4 decoration-teal/30 hover:decoration-teal/60`.

---

## 5. Layout Principles

- **Spacing:** 4px base scale via `--space-*` (`space-2`=8 … `space-24`=96). Always reference tokens
  (`py-[var(--space-10)]`), never raw px in JSX.
- **Mobile-first**, single-column; promote to 2-col with `sm:grid-cols-2 gap-[var(--space-4)]`.
- **Measure:** prose capped `max-w-[58ch]–[64ch]`; forms/cards `max-w-[27rem]–[44ch]`, centered.
- **Page rhythm:** eyebrow → headline → body → content. The page eyebrow/title should sit **close to
  the header** — list/category pages use `pt-[var(--space-4)] pb-[var(--space-8)]` on the outer
  `<section>` (NOT `py-[var(--space-8)]`, which floats the title too far down). Keep the eyebrow→title
  gap tight (`mb-[var(--space-2)]`) and constrain the subtitle (`max-w-[60ch]`).
- **Mobile control rows:** never cram search + filters + toggles into one row on a phone. Stack the
  search full-width on its own row, controls beneath (`flex-col gap-2 sm:flex-row`), as in
  `ClassificationFilter`.

---

## 6. Depth & Elevation

Flat editorial, never glassy-glowy. Use the token shadow ramp `--shadow-xs … --shadow-2xl`.
Signature lift = a hairline lit top edge (`inset 0 1px 0 rgba(255,255,255,.7)`) + a soft long drop
(`0 10px 28px -16px rgba(26,23,20,.18)`). Display insets are the only near-black surfaces; everything
else is paper.

---

## 7. Do's and Don'ts

**Do**
- Use `effectiveTierPriceCents` for any catalog/cart price (never raw formula price).
- Keep the DNA·V mark crisp and still; only its three orbital bodies may animate.
- Gate all motion behind `prefers-reduced-motion: no-preference`.
- Reference design tokens (`var(--…)`, `text-ink`, `bg-base-800`) so dark mode flips for free.

**Don't**
- Hardcode hex in components or `tailwind.config` — bind to CSS vars.
- Add glows, neon, heavy gradients, or bouncy spring-overshoot UI (Tron era is retired).
- Introduce new accent colors outside the gold/teal/status set.
- Let headlines exceed ~3 lines or body exceed ~64ch.

---

## 8. Responsive Behavior

Breakpoints follow Tailwind (`sm 640 · md 768 · lg 1024`). Forms collapse to one column below `sm`.
A floating bottom nav (frosted pill) is the primary mobile affordance; the top bar is
`[hamburger] [centered logo] [cart]`. Test every screen at mobile (375) and desktop, in **both**
light and dark (`html[data-theme="dark"]`).

---

## 9. Agent Prompt Guide

When generating UI for this project:

> Build it in the **VS Research Labs cream-editorial** system. Page on `--color-surface-base` cream.
> Eyebrow in uppercase wide-tracked mono/sans `text-ink/45`; headline in Cormorant serif or
> Inter-light with a mixed-weight two-tone line; body `13–14px text-ink/75` capped ~60ch. Inputs via
> `Field` (`bg-base-700`, `border-ink/15`, `rounded-sm`). Primary action = gold `.cta-mint` pill,
> uppercase `tracking-[0.25em]`. Links teal. Cards `.holo-surface` / data modules
> `.research-surface-solid`. Spacing only from `--space-*`. Colors only from `--color-*` tokens so
> dark mode works. No glows, no neon, no new accent colors. Gate motion behind reduced-motion.

**Quick color reference:** cream `#F4EFE6` · card `#FBF9F4` · ink `#1A1714` · gold `#B5904B` ·
teal `#34727A` · display inset `#16130F`.
