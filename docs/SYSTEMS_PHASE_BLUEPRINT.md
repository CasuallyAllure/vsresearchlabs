# SYSTEMS_PHASE_BLUEPRINT.md
## VS Research Labs — Systems Phase Architecture
### Minimum Viable Operational Procurement Stack

---

## GOVERNING PRINCIPLE

This system serves a small, serious research procurement organization — not a software company. Every architectural decision should be evaluated against the question: "Does a real procurement desk need this?"

The standard for inclusion is operational necessity, not technical elegance.
The standard for exclusion is restraint, not laziness.

---

## 1. ARCHITECTURE IMPLIED BY THE CURRENT FRONTEND

The frontend's data contracts already define the required backend. Reading the existing types, hooks, and payload shapes surfaces the following implied architecture:

### 1.1 Products
The frontend expects:
- A queryable list of products with optional category filtering
- Per-product detail by `id`
- Admin CRUD (create, update, delete)
- All fields in the current `Product` type including procurement-specific fields (`batchReference`, `lotNumber`, `abbreviation`, `family`, `variants`, etc.)

**Implied backend:** A `products` table with all procurement fields, readable by anon, writable by authenticated admin only.

### 1.2 Inquiries
The frontend sends:
```
{ name, contact, notes, items: [{ product: { id, name, category }, quantity, note }] }
```

**Implied backend:** An `inquiries` table + `inquiry_items` join table. The `send-inquiry` function should write to these tables before sending email. The `VSR-REQ-*` reference ID should be generated server-side and stored.

### 1.3 Documents
The frontend expects:
- A list of documents queryable by type and issuer
- Per-document detail by `id`
- All fields in the current `Document` type
- Actual file access (implied by thumbnailUrl and the document detail UX)

**Implied backend:** A `documents` table mirroring the current `Document` interface. Supabase Storage bucket for document PDFs and thumbnails.

### 1.4 Admin Auth
The frontend already calls `useProductAdmin()` and submits to a protected form. The `AdminGate` component pattern is a placeholder for real session auth.

**Implied backend:** Supabase Auth with a single admin user role. Email magic link is appropriate; no OAuth complexity needed.

---

## 2. MINIMUM VIABLE OPERATIONAL ARCHITECTURE

This is the smallest set of systems that makes the platform operationally real. Each component directly addresses a current fake system or critical risk.

### 2.1 Schema (Supabase PostgreSQL)

#### `inquiries` table
```sql
create table inquiries (
  id               uuid primary key default gen_random_uuid(),
  reference_id     text unique not null,         -- VSR-REQ-YYMMDD-NNN, server-generated
  submitted_at     timestamptz default now(),
  name             text not null,
  contact          text not null,
  organization     text,
  notes            text,
  status           text not null default 'open', -- open | reviewed | quoted | closed | declined
  intake_channel   text not null default 'web-portal',
  item_count       integer not null,
  responded_at     timestamptz,
  internal_notes   text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
```

#### `inquiry_items` table
```sql
create table inquiry_items (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  product_id   text not null,                    -- product.id at time of submission
  product_sku  text not null,                    -- snapshot: sku at submission
  product_name text not null,                    -- snapshot: name at submission
  category     text,
  quantity     integer not null check (quantity > 0),
  note         text,
  created_at   timestamptz default now()
);
```

Inquiry items store a snapshot of product data at the time of submission — not a live foreign key reference. This is intentional: products may be renamed, repriced, or deleted after an inquiry is filed. The inquiry record must remain accurate to the moment it was submitted.

#### Extended `products` table
The current migration defines a minimal product schema. The production schema must include all fields present in the frontend `Product` type:

```sql
alter table products add column if not exists abbreviation        text;
alter table products add column if not exists family              text;
alter table products add column if not exists variants            jsonb;
alter table products add column if not exists batch_reference     text;
alter table products add column if not exists lot_number          text;
alter table products add column if not exists manufacturer        text;
alter table products add column if not exists country_of_origin   text;
alter table products add column if not exists storage_condition   text;
alter table products add column if not exists shelf_life_months   integer;
alter table products add column if not exists unit_of_measure     text;
alter table products add column if not exists lead_time_days      integer;
alter table products add column if not exists testing_standard    text;
alter table products add column if not exists shipping_condition  text;
alter table products add column if not exists cas_number          text;
alter table products add column if not exists molecular_weight    text;
alter table products add column if not exists short_description   text;
alter table products add column if not exists long_description    text;
alter table products add column if not exists abbreviation        text;
alter table products add column if not exists featured            boolean default false;
```

#### `documents` table
```sql
create table documents (
  id                       text primary key,
  product_abbreviation     text not null,
  product_name             text not null,
  document_type            text not null,
  batch_id                 text not null,
  issued_date              date not null,
  thumbnail_url            text,
  storage_path             text,                -- Supabase Storage path
  issuer                   text,
  issued_by                text,
  page_count               integer,
  file_size_kb             integer,
  expires_at               date,
  document_version         text,
  standard_reference       text,
  reviewed_at              date,
  instrument_id            text,
  document_control_status  text default 'CONTROLLED',
  supersedes               text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
```

### 2.2 RLS Policies

```sql
-- Inquiries: anon cannot read or list. Authenticated admin can read all.
-- The Edge Function uses service role key to write (bypasses RLS).
alter table inquiries enable row level security;
alter table inquiry_items enable row level security;

create policy "Inquiries readable by admin only"
  on inquiries for select
  using (auth.role() = 'authenticated');

create policy "Inquiry items readable by admin only"
  on inquiry_items for select
  using (auth.role() = 'authenticated');

-- Documents: publicly readable, admin-writable.
alter table documents enable row level security;

create policy "Documents readable by everyone"
  on documents for select using (true);

create policy "Documents writable by admin only"
  on documents for all
  using (auth.role() = 'authenticated');
```

### 2.3 Updated `send-inquiry` Edge Function

The function must be updated to:
1. Generate the reference ID server-side (not client-side)
2. Write to `inquiries` and `inquiry_items` before sending email
3. Include the reference ID in both business and buyer emails
4. Return the server-generated reference ID in the response payload
5. Lock CORS origin to the production domain
6. Add rate limiting (IP-based, or via Supabase's built-in throttling)

The database write must precede the email send. If the write fails, return an error. If the write succeeds but the email fails, the inquiry is still recorded — operational continuity is maintained.

### 2.4 Supabase Storage

One bucket: `documents`

```
documents/
  thumbnails/     -- small preview images served publicly
  pdfs/           -- full document PDFs, access-controlled
```

Thumbnail access: public. PDF access: admin-only or signed URL with expiry. This allows the documentation archive to surface thumbnails publicly while protecting the full documents behind auth.

### 2.5 Admin Authentication

Replace the `VITE_ADMIN_PASSPHRASE` gate with Supabase Auth:
- Email magic link (no password management)
- Single user (or a small defined list)
- Server-side session via Supabase Auth; `AdminGate` checks session state from `supabase.auth.getSession()` instead of localStorage passphrase
- All admin mutations must use the authenticated Supabase client (respects RLS)
- The service role key must never be exposed to the browser

### 2.6 Frontend Data Migration

The frontend's hook layer is already forward-compatible. The migration is purely in hook internals:

**`useProducts` / `useProduct`:** Replace `useProductStore(s => s.products)` reads with Supabase client query. The `loading` and `error` fields in the return shape were stubbed for exactly this migration.

**`useDocuments` / `useDocument`:** Replace `documentsData` import with Supabase client query.

**`useProductAdmin`:** Replace localStorage mutations with authenticated Supabase mutations.

No component changes are required. The hook interface contract is unchanged.

---

## 3. SEQUENCED SYSTEMS ROADMAP

Ordered by operational priority. Each phase must be complete and production-stable before the next begins.

### S1 — Inquiry Persistence (Highest priority)
**Goal:** Every submitted inquiry is recorded in the database before the email is sent.

**Scope:**
- New migration: `inquiries` + `inquiry_items` tables with RLS
- Updated `send-inquiry` function: DB write + server-generated reference ID
- Include reference ID in email templates
- Return server reference ID in API response
- Update `generateInquiryRecord` in the frontend to accept server-returned ID instead of generating one locally

**Not in scope for S1:** Inquiry status UI, admin inbox, lifecycle management.

**Why first:** This is the only change that protects real operational data from permanent loss. Everything else is usability and scale.

---

### S2 — Admin Authentication
**Goal:** Admin route is server-secured, not just obscured.

**Scope:**
- Supabase Auth wired into the application
- `AdminGate` updated to check live session from `supabase.auth.getSession()`
- Admin mutations use authenticated client (validates against RLS)
- Remove `VITE_ADMIN_PASSPHRASE` from .env.example
- Email magic link flow is sufficient; no OAuth, no password management

**Not in scope for S2:** Admin inbox, document upload, inquiry management UI.

**Why second:** Without real auth, any admin interface changes made in S3+ are insecure.

---

### S3 — Inventory Database
**Goal:** Product catalog lives in Supabase. Admin CRUD persists to the database. Frontend reads from Supabase.

**Scope:**
- Extended `products` migration (all procurement fields)
- Seed migration to populate the products table from the current JSON
- `useProducts` / `useProduct` hooks repointed to Supabase
- `useProductAdmin` mutations repointed to authenticated Supabase writes
- Admin form updated to expose: `abbreviation`, `family`, `variants`, `batchReference`, `lotNumber`, and other procurement-critical fields
- Remove product store's localStorage persistence (now redundant)
- Remove `src/data/products.json` from the frontend bundle after migration confirmed

**Not in scope for S3:** Document upload, inquiry management.

---

### S4 — Document Storage
**Goal:** Real documents are stored in Supabase Storage. The documentation archive surfaces actual files.

**Scope:**
- Supabase Storage bucket: `documents` (thumbnails public, PDFs auth-gated)
- `documents` table migration
- Seed migration to populate documents table from current JSON
- Upload flow in admin: file picker → Storage upload → metadata record insert
- `useDocuments` / `useDocument` hooks repointed to Supabase
- Document detail page updated: thumbnail from Storage signed URL; PDF link from Storage signed URL
- Remove `src/data/documents.json` from frontend bundle after migration

**Not in scope for S4:** Document versioning, approval workflows, QC system.

---

### S5 — Inquiry Lifecycle
**Goal:** Internal staff can see, review, and update inquiry status.

**Scope:**
- Admin inquiry list: tabular view of all inquiries, sorted by `submitted_at` desc
- Inquiry detail view: full contact + line items + notes + timestamps
- Status update: Open → Reviewed → Quoted → Closed / Declined
- Internal notes field on inquiry record
- `responded_at` timestamp recorded on first status change
- Filter by status

**Not in scope for S5:** Outbound quote generation, automated responses, CRM integration, buyer portal.

**The admin inquiry view must follow the same institutional register as the public-facing system.** It is a procurement intake desk, not a CRM.

---

## 4. PROCUREMENT WORKFLOWS IMPLIED BUT NOT YET IMPLEMENTED

These workflows are implied by the current frontend UX but have no backend support.

| Workflow | Current State | Required Backend |
|---|---|---|
| Inquiry submission → confirmation | Email only | DB persistence (S1) |
| Inquiry follow-up by reference ID | Not possible (ID not stored) | DB persistence (S1) |
| Admin reviews new inquiries | Not possible | Admin auth (S2) + inquiry lifecycle (S5) |
| Product catalog update | localStorage only | Inventory database (S3) |
| Document upload and publication | Not possible | Document storage (S4) |
| Inquiry status progression | Not possible | Inquiry lifecycle (S5) |
| Batch documentation linkage | Editorial only | Document storage (S4) + product linkage |

---

## 5. NEVER BUILD LIST

These systems are explicitly excluded. They would introduce scope, complexity, or posture that conflicts with the system's institutional character.

**Never build:**
- Buyer accounts / buyer portal / buyer login
- Payment processing / checkout / Stripe (removed and confirmed deleted)
- CRM or contact management system
- Marketing email / newsletters / broadcast campaigns
- Inventory forecasting or automated reorder
- Public API or developer platform
- Real-time stock notifications
- Multi-tenant architecture (this is one organization's system)
- Customer review or rating system
- Referral or affiliate program
- AI-powered inquiry routing or response generation
- Complex approval workflow engine (two-step review is sufficient)
- Analytics dashboards (inquiry counts and status totals are sufficient; no charting)
- Mobile application
- Third-party marketplace or channel integrations
- Automated quote generation
- ERP integration
- Public-facing account portal for buyers

The system serves a small, operationally serious procurement desk. When in doubt, the question is: "Would a real procurement desk at a research institution need this?" Not: "Would this be impressive to build?"

---

## 6. OPERATIONAL REALISM ASSESSMENT

### What makes this system operationally real today:
- The inquiry submission pipeline works end-to-end (form → validation → email)
- The email templates are well-structured and institutionally appropriate
- The product data is operationally dense and internally consistent
- The document metadata is credible and properly structured
- The inquiry intake record is visually complete

### What makes this system operationally fake today:
- Inquiries are not persistent — they exist only in Resend's logs
- Product catalog is per-device — two staff members see different data
- Documents are metadata only — no actual files exist
- Admin security is cosmetic — no server-side session
- Reference IDs are not tracked anywhere

### Gap to operational reality:
Three engineering phases. S1 closes the most critical gap (inquiry persistence). S2 closes the most dangerous gap (admin security). S3 closes the most visible gap (inventory persistence). S4 closes the most credibility-undermining gap (document void). S5 closes the operational lifecycle gap (inquiry tracking).

A system that has completed S1–S3 is operationally real for its primary purpose: receiving, recording, and processing research procurement inquiries.

---

## 7. INSTITUTIONAL SCALABILITY ASSESSMENT

The system is designed for a small, serious procurement operation. "Institutional scalability" in this context means:

**Can the system be operated by a 3–5 person team without a software engineering background?**

After S1–S3: **Yes, marginally.** Products can be managed, inquiries are recorded, emails are sent. The admin interface is functional but sparse.

After S4–S5: **Yes, comfortably.** Full procurement lifecycle from inquiry receipt to status close. Documentation can be published and maintained. Batch records can be filed.

**Does the system require ongoing engineering to operate?**

After S1–S5: **No.** A non-technical admin can manage the product catalog, upload documents, and track inquiry status without touching code. The Supabase dashboard provides a direct data escape hatch for any edge case not covered by the admin UI.

**Can the system handle a real inquiry volume?**

After S1 (rate limiting included): **Yes, for a procurement-scale operation.** This is not a consumer-facing e-commerce platform. Hundreds of inquiries per week is a realistic ceiling; the architecture handles this comfortably.

---

## 8. PRODUCTION DEPLOYMENT READINESS ASSESSMENT

### Pre-S1 (current state)
**Production ready: No.**
Inquiries are not persistent. Admin is insecure. Product catalog is per-device.

### Post-S1
**Production ready: Conditionally.**
Inquiries are now persistent and traceable. The system can receive real inquiries without losing data. Not production-ready for admin operations (still insecure), but safe for public-facing inquiry flow.

### Post-S2
**Production ready: Yes, for limited operations.**
Admin access is secured. Product data can be safely managed (still localStorage, but securely gated).

### Post-S3
**Production ready: Yes, for full catalog operations.**
Multi-device admin, persistent inventory, synchronized product display. The core operational loop is complete.

### Post-S4–S5
**Production ready: Yes, for full operations.**
Document archive has real content. Inquiry lifecycle is trackable. The platform operates as described by its institutional presentation.

---

## 9. DEPLOYMENT ARCHITECTURE

No changes to the current deployment model are required. The existing architecture is appropriate:

- **Frontend:** Vite static build, deployed to Vercel or Netlify
- **Backend:** Supabase managed PostgreSQL + Edge Functions + Storage
- **Email:** Resend
- **Auth:** Supabase Auth (magic link)

No additional infrastructure is required at any phase.

**Environment variables required at full production:**

```
# Frontend
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Edge Functions (server-side only, never in frontend)
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
INQUIRY_TO_EMAIL=
RESEND_FROM_EMAIL=
ALLOWED_ORIGIN=           # production domain, for CORS lockdown
```

**Remove entirely:**
```
VITE_ADMIN_PASSPHRASE=    # replaced by Supabase Auth in S2
```

---

## 10. WHAT THE ADMIN INTERFACE ACTUALLY NEEDS

The admin interface should be treated as internal operational tooling, not as a product surface. It does not need to feel premium. It needs to be:

- **Reliable:** mutations persist correctly and immediately
- **Legible:** state is always clear (what exists, what was changed, when)
- **Recoverable:** deletes are soft-deletable or confirm-gated; nothing is silently irreversible

### Admin surfaces required by the end of the Systems Phase:

| Surface | Current State | Required State |
|---|---|---|
| Product list | Exists (local) | Exists (database) |
| Product create/edit | Exists (local, missing procurement fields) | Exists (database, all fields) |
| Product delete | Exists (local) | Exists (database, with confirmation) |
| Inquiry list | Does not exist | Required in S5 |
| Inquiry detail | Does not exist | Required in S5 |
| Inquiry status update | Does not exist | Required in S5 |
| Document list | Does not exist | Required in S4 |
| Document upload | Does not exist | Required in S4 |
| Document delete | Does not exist | Required in S4 |

The admin surfaces should follow the same visual language as the rest of the system. No dashboard theater, no analytics panels, no activity feeds. A list → detail → edit pattern is sufficient for all three domains.

---

## 11. SYSTEMS PHASE GOVERNANCE

### Allowed without re-authorization:
- Schema migrations that implement the architectures described in S1–S5
- Edge Function updates that implement the architectures described in S1–S5
- Hook internals changes that repoint data sources from local JSON to Supabase
- Admin form field additions for procurement metadata already in the `Product` type
- RLS policy additions consistent with the access patterns described above

### Requires explicit authorization:
- Any new public-facing routes
- Any new data types not implied by the existing frontend contracts
- Any email template changes (voice and register must be reviewed)
- Any change to the inquiry submission payload shape
- Any change to the document control classification system
- Any new admin surface not in the required surfaces list above
- Any third-party service integration

### Hard stops — never authorized without separate architectural review:
- Buyer-facing authentication
- Payment processing
- Anything on the Never Build list
- Public API endpoints
- Multi-tenant data isolation

---

*This blueprint was produced at the close of the Refinement Phase (R0–R11) and defines the Systems Phase architecture. It should be treated as a living document — updated when phases complete and when operational realities require revision.*
