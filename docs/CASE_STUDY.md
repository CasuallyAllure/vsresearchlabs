# VS Research Labs — Case Study

> A full-stack research-supply storefront with a real operations back-office —
> not a brochure site. Bespoke design system, a live compound-intelligence
> layer backed by real scientific data, and an admin console that runs the
> business end-to-end: inquiries → orders → invoicing → fulfillment → branded
> receipts, with inventory, audit logging, and bulk import.

**Stack:** React + TypeScript + Vite · Tailwind (custom token system) · Supabase
(Postgres, Auth, RLS, SECURITY DEFINER RPCs, Edge Functions/Deno) · Resend
(transactional email) · three.js / react-three-fiber · Cloudflare Pages.

---

## The problem

A research-peptide and lab-equipment business needed more than a catalog. It
needed to actually *operate*: take structured inquiries, convert them to orders,
send branded invoices, verify manual payments, track fulfillment and delivery,
issue receipts, manage stock, and keep an audit trail — all without a
bookkeeper-grade ERP and without a developer in the loop for routine changes.

The site also had to *earn trust* in a regulated, skeptical space: real
scientific data, documented batch references, and "research use only" framing
throughout — no hype furniture.

## What was built

**Storefront**
- A cream "editorial-instrument" design system (custom Tailwind tokens, not a
  theme) with a consistent typographic + motion grammar.
- A **Compound Intelligence** layer: per-compound mechanism, receptor activity,
  pricing tiers, regulatory posture, and a **real molecular structure viewer** —
  2D structures resolved from PubChem (CID-verified so the wrong molecule is
  never shown) and a genuine **experimental 3D peptide** rendered from RCSB PDB
  coordinates (e.g. retatrutide, chain P of the 8YW3 cryo-EM structure).
- Inquiry-led cart → checkout that creates a real order and emails a branded
  invoice with payment instructions.
- Public order **tracking** page (carrier + status, ZIP-gated to prevent
  order-number enumeration).

**Operations back-office (the differentiator)**
- A full admin console: dashboard, inquiries, orders, customers, inventory,
  bulk import, reports, stock log, audit log, system health, catalog editor.
- An **order pipeline state machine** — pending → invoiced → paid → shipped →
  delivered → receipt — with per-row quick actions and a one-click path through
  each stage, plus a **revert/flag** safety net that restocks and records a
  "compromised/reverted" marker if a payment goes bad.
- **Branded transactional emails** (invoice, shipment, paid receipt) rendered
  server-side from canonical order data so amounts can't be spoofed.
- **Inventory** with per-SKU and per-dose stock/price overrides, plus a
  **bulk CSV/XLSX importer** for stock, pricing, visibility, and per-compound
  "cited clip" videos.
- Every mutation routes through an admin-gated `SECURITY DEFINER` RPC and writes
  an **audit-log** row.

## Engineering highlights

- **Dependency-free spreadsheet export.** A real `.xlsx` workbook hand-built
  from OOXML + a minimal store-method ZIP with a from-scratch CRC32 — no
  libraries. CSV + XLSX from one typed `(columns, rows)` spec.
- **Real structure resolution.** PubChem PUG-REST with a curated, *verified*
  name→CID map (the naive name search returns impurities and analogs — caught
  and rejected). A build step extracts real atom coordinates from a PDB chain
  for the 3D viewer.
- **Server-side media hosting.** An edge function expands TikTok short links,
  reads oEmbed, and re-hosts the (expiring) thumbnail into Supabase Storage so
  posters never rot.
- **Trust-by-construction backend.** RLS + `SECURITY DEFINER` RPCs + audit
  logging; invoice/receipt amounts always recomputed server-side from the order,
  never the client.
- **Performance.** Route-level code-splitting with the heavy three.js viewer
  lazy-loaded into its own chunk — it's fetched after paint, on the landing
  only, and never on admin/product routes.

## Quality bar

- **Bundle:** initial critical path ≈ **155 kB gzipped** (React + Supabase core
  + app shell); the 949 kB 3D visualization is a lazy, landing-only chunk.
  Vendor split for independent caching.
- **Resilience:** top-level error boundary (branded fallback, never a white
  screen) and a real 404.
- **SEO/social:** Open Graph + Twitter cards, sitemap, robots, JSON-LD
  Organization schema, per-route titles.
- **Accessibility:** keyboard-dismissible menus, focus-visible throughout,
  skip-to-content link, reduced-motion handling.

## Possible extensions

- Read-only "guest admin" role (RLS-scoped) so the back-office can be explored
  in a portfolio without sharing credentials.
- Stripe (or other PSP) integration behind the existing order pipeline — the
  state machine and emails are already in place; only the payment capture step
  changes.
- A bespoke 1200×630 social share card.

---

*For research use only — not for human or veterinary use.*
