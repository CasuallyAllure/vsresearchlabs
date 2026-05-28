# SYSTEMS_PHASE_AUDIT.md
## VS Research Labs — Current-State Systems Audit
### Post-Refinement Phase · Systems Phase Entry Point

---

## 1. SYSTEMS INVENTORY — WHAT ACTUALLY EXISTS

### 1.1 Frontend Layer (Complete)
The presentation layer is production-quality. Every public-facing route is stable, coherent, and institutionally calibrated. This layer requires no further work before backend systems are built.

| Surface | Route | Status |
|---|---|---|
| Landing | `/` | Complete |
| Research Supplies | `/research-supplies` | Complete |
| Laboratory Equipment | `/laboratory-equipment` | Complete |
| Catalog | `/catalog` | Complete |
| Product Detail | `/product/:id` | Complete |
| Inquiry List | `/cart` | Complete |
| Contact | `/contact` | Complete |
| Documentation Archive | `/documentation` | Complete |
| Document Detail | `/documentation/:id` | Complete |
| Admin List | `/admin` | Scaffold only |
| Admin Edit | `/admin/new`, `/admin/:id/edit` | Scaffold only |

### 1.2 Data Layer (Local-First, Not Persisted)

**Products:** Read from `src/data/products.json` via Zustand store + localStorage. Admin CRUD mutates localStorage only. Product data is per-device, per-browser. A `products` table exists in the Supabase migration but is never queried.

**Documents:** Read from `src/data/documents.json` directly. In-memory only. No write path. No database table. No file storage.

**Cart / Inquiry List:** Zustand store persisted to localStorage. Cleared on submission. No server-side record created at any point.

### 1.3 Backend Layer (Minimal)

**Active Edge Functions:** One — `send-inquiry/index.ts`
- Receives inquiry payload (name, contact, notes, items[])
- Validates and sanitizes input
- Sends business notification via Resend
- Sends buyer confirmation copy (if contact is a valid email)
- Returns `{ success, userCopySent, contactIsEmail }`
- **No database write occurs at any point**

**Deleted Edge Functions (confirmed gone from git status):**
- `create-checkout-session` — Stripe checkout, removed
- `stripe-webhook` — Stripe webhook handler, removed

**Database Schema (defined, not connected to frontend):**
- `products` table — defined, RLS configured, never queried by frontend
- `product_supplier_links` table — service-role-only, not exposed via API

### 1.4 Authentication
- `VITE_ADMIN_PASSPHRASE` env var checked client-side in `AdminGate` component
- Passphrase stored and checked in localStorage/sessionStorage
- No Supabase Auth integration
- No session management
- No server-side auth verification

### 1.5 Email Infrastructure
- Resend API, called from Edge Function only
- Inline HTML templates in `send-inquiry/index.ts`
- No template library, no shared email system
- No inquiry reference ID included in emails (the VSR-REQ-* ID is generated client-side after success and never sent to Resend)

---

## 2. FAKE SYSTEMS MAP

These systems have a real visual presence in the product but no operational substance behind them.

### 2.1 Inquiry Record System — FAKE
**What it looks like:** After submission, a `VSR-REQ-YYMMDD-NNN` reference ID appears on screen in a formal intake record with operational metadata (channel, processing node, classification status, estimated response window).

**What actually happens:** The reference ID is generated locally using `Math.floor(Date.now() / 1000) % 1000`. It is never transmitted to the Edge Function. It is never stored anywhere. It is not included in the confirmation emails. If the buyer closes the tab, the record is gone.

**Risk level:** High — the visual posture implies traceability that does not exist. If a buyer presents this reference ID for follow-up, the business has no way to look it up.

### 2.2 Inventory Persistence — FAKE
**What it looks like:** The admin can create, edit, and delete products. Changes appear immediately.

**What actually happens:** All mutations write to localStorage in the browser that performed the edit. The change does not appear in any other browser, device, or incognito session. The seed JSON in the repository is the only canonical product list. There is no database synchronization. The `products` Supabase table is never written to or read from.

**Risk level:** Critical — any operational use of the admin will result in a product catalog that only one person can see, which silently diverges from every other user's view.

### 2.3 Document System — FAKE
**What it looks like:** A complete documentation archive with thumbnails, metadata panels, provenance fields, batch IDs, document control status, issuer names, and per-document detail pages.

**What actually happens:** All 10 documents are hardcoded in `src/data/documents.json`. The `thumbnailUrl` values point to SVG paths (`/docs/coa.svg`, etc.) that are likely placeholder assets. There is no document storage system, no upload mechanism, no PDF viewing, no actual file access. The "View document" affordance implied by the UI goes nowhere — there are no actual documents.

**Risk level:** High — the documentation system is the primary institutional trust signal. Sending a buyer to `/documentation/:id` to find no actual document severely damages credibility.

### 2.4 Document Control Status — FAKE
**What it looks like:** Every document carries `documentControlStatus: "CONTROLLED"`. The Microcentrifuge calibration shows `supersedes: "CEN-CAL-2025-Q3-RevA"`. These appear in the identifier band of each document detail page.

**What actually happens:** These are display fields in a JSON seed file. There is no document control workflow, no versioning system, no QC approval chain, no supersession mechanism. "CONTROLLED" is a label applied uniformly to all documents with no operational meaning.

**Risk level:** Medium — creates false impression of regulatory compliance posture.

### 2.5 Batch Tracking — FAKE
**What it looks like:** Products carry `batchReference`, `lotNumber`, `casNumber`, `molecularWeight`, `testingStandard`, `shippingCondition`, `storageCondition`, `shelfLifeMonths` — a complete procurement metadata profile.

**What actually happens:** All fields are static values in `src/data/products.json`. There is no inventory receiving system, no batch issuance process, no lot management, no expiry tracking, no reorder logic. The batch references in documents (`SEM-2026-031`) match the product data by manual editorial coordination, not by system linkage.

**Risk level:** Medium — operationally harmless at presentation layer, but cannot scale to real operations without a real batch system.

### 2.6 Admin Authentication — FAKE
**What it looks like:** A passphrase gate at `/admin`. The page will not render without the correct passphrase.

**What actually happens:** The passphrase check is entirely client-side. The passphrase is stored in `VITE_ADMIN_PASSPHRASE`, which is a Vite environment variable embedded in the JavaScript bundle at build time. Anyone who inspects the bundle source or disables JavaScript can access the admin. There is no server-side session, no JWT, no role check.

**Risk level:** Critical — this is not security. It is a visibility filter.

### 2.7 Stock / Availability — FAKE
**What it looks like:** Products carry a `stock` field. The admin form allows setting stock values.

**What actually happens:** Stock values are display data only. No product page shows stock levels to buyers. No inquiry submission decrements stock. The field has no operational effect.

**Risk level:** Low — does not mislead buyers, but creates false sense of inventory management readiness.

---

## 3. PRODUCTION RISK MAP

Risks are rated on operational impact if the system were to accept real procurement inquiries today.

### Critical Risks

**CR-1: No inquiry persistence**
Every submitted inquiry exists only in Resend's sent-mail log and the buyer's email inbox (if contact was an email address). If Resend delivery fails, the inquiry is permanently lost. The business has no inquiry database. There is no way to audit inquiries, search by reference ID, track response status, or generate procurement reports.

**CR-2: Admin writes to localStorage only**
Any product catalog changes made in the admin interface are invisible to every other user. Two staff members on different computers will see different product catalogs with no indication that divergence has occurred. The Supabase `products` table is vestigial — defined but never used.

**CR-3: Admin authentication is client-side only**
The passphrase gate can be bypassed trivially. The admin route is a public URL. Any user can access and mutate the product catalog if they can find or guess the URL and bypass the client-side check.

### High Risks

**HR-1: Reference IDs are not transmitted or stored**
The `VSR-REQ-YYMMDD-NNN` reference ID appears in the intake record and in the buyer confirmation copy, but it is never sent to the Resend email template and never stored anywhere. If a buyer cites this ID to follow up on their inquiry, the business cannot look it up.

**HR-2: No document files exist**
The documentation archive presents 10 documents with full archival metadata. None of these documents are accessible as actual files. A buyer who navigates to a document detail page expecting to download or view a PDF will find only metadata.

**HR-3: CORS policy too permissive**
`send-inquiry` uses `Access-Control-Allow-Origin: "*"`. In production, this should be restricted to the actual deployment domain.

**HR-4: No rate limiting on inquiry submission**
The `send-inquiry` function has no rate limiting. An automated script can trigger hundreds of business notification emails and exhaust the Resend quota.

### Medium Risks

**MR-1: No input validation on product IDs**
The `send-inquiry` function validates item shape (id, name required) but does not cross-reference product IDs against the actual product database. A buyer could submit a fabricated product ID and it would be processed.

**MR-2: Reference ID collision**
The `VSR-REQ-YYMMDD-NNN` format uses `Date.now() / 1000 % 1000` for the sequence, giving 1000 possible values per day. Two inquiries submitted within the same second will get the same reference ID.

**MR-3: Admin form missing procurement-critical fields**
The admin edit form does not expose: `abbreviation`, `family`, `variants`, `batchReference`, `lotNumber`, `casNumber`, `molecularWeight`, `testingStandard`, `storageCondition`, `shelfLifeMonths`, `leadTimeDays`. Products created through the admin will have incomplete procurement metadata.

**MR-4: No reduced-motion coverage on skeleton loading**
`ProductCardSkeleton` uses `animate-pulse` (CSS `@keyframes`) without `motion-safe:` variant protection. Not a security or data risk, but an accessibility gap.

---

## 4. OPERATIONAL STATE SIMULATION MAP

A summary of which operational states are simulated vs. real.

| Operational Concept | UI Implies | Actual State |
|---|---|---|
| Inquiry reference tracking | Reference ID, intake record, filed status | Client-generated, never stored |
| Inquiry status lifecycle | OPEN classification | No status machine exists |
| Document archive | 10 classified, controlled documents | JSON seed file, no files |
| Batch documentation linkage | CoA linked to batch ID | Editorial consistency only |
| Document control | CONTROLLED status, supersession | Display labels only |
| Inventory persistence | Admin CRUD | localStorage per-device |
| Stock tracking | `stock` field in schema | No operational effect |
| Procurement traceability | Batch refs, lot numbers | Static display data |
| Admin security | Passphrase gate | Client-side only |
| Inquiry confirmation email | Reference ID in copy | ID never sent to Resend |

---

## 5. EXISTING ARCHITECTURE THAT IS CORRECT AND SHOULD BE PRESERVED

These decisions are architecturally sound and should not be revisited:

- **Supabase as backend platform** — correct choice; Edge Functions + PostgreSQL + Storage is appropriate for this scale
- **Resend for transactional email** — correct; lightweight, developer-oriented, appropriate
- **Local-first hook architecture** — `useProducts`, `useDocuments` hooks with `loading`/`error` return shapes are already forward-compatible with a Supabase data source; the swap is a hook internals change with no component changes required
- **Zustand for cart state** — correct; persisted localStorage cart with clean interface
- **RLS on `product_supplier_links`** — correct supplier-confidentiality posture; should be preserved and extended to the inquiry table
- **Inquiry-only model (no checkout)** — correct operational decision; the system should never become a transactional e-commerce platform
- **Edge Function for inquiry submission** — correct boundary; all server-side logic belongs here, not in the browser

---

## 6. SYSTEM BOUNDARY SUMMARY

```
┌─────────────────────────────────────────────────────┐
│  BROWSER (current state)                            │
│                                                     │
│  products.json ──→ Zustand ──→ all product UI       │
│  documents.json ──→ in-memory ──→ all doc UI        │
│  useCart (localStorage) ──→ inquiry list            │
│                                                     │
│  On submission:                                     │
│    POST /send-inquiry ──→ Resend ──→ business email │
│                       └──→ buyer email (if email)   │
│                       └──→ (nowhere else)           │
│                                                     │
│  /admin:                                            │
│    AdminGate (passphrase check) ──→ local CRUD only │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  SUPABASE (current state)                           │
│                                                     │
│  products table ──────── defined, never used        │
│  product_supplier_links ─ defined, never used       │
│  send-inquiry function ── active, email-only        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The gap between the institutionally-credible presentation layer and the actual backend infrastructure is the primary architectural problem the Systems Phase must close.
