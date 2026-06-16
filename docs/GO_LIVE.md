# Go-Live Checklist — VS Research Labs

A linear checklist to take this site from "works on my laptop" to
"running on vsresearchlabs.com with a real admin and real inventory."
You'll bounce between four services: **Supabase**, **Resend**,
**Cloudflare**, and your **domain registrar**.

Each phase has a clear "Done when:" line so you can tell whether to
move on. Estimated wall-clock times assume you don't get stuck — add
buffer if any of these services are new to you.

> **Order matters.** Resend domain verification can take an hour for DNS
> to propagate, so kick that off first. Phases 1 and 2 can run while
> you wait.

---

## ⚡ Already live? Apply the latest changes (~5 commands)

Use this when the site is already running and you just need to ship the
backend work from recent sessions. The frontend is already deployed via
Cloudflare on every push — **nothing here touches the frontend.** This is
"Motion 1": make the order module + bot protection actually live.

If a command says you're not linked, run once and retry:

```bash
supabase link --project-ref ufaajzfuppohbxebftwp
```

### Step 1 — Turnstile secret (bot protection)

Set the Cloudflare Turnstile **secret** — it must come from the **same
widget** as your `VITE_TURNSTILE_SITE_KEY`, or verification rejects every
visitor:

```bash
supabase secrets set TURNSTILE_SECRET=<secret-from-the-same-widget>
```

> `VITE_TURNSTILE_SITE_KEY` is baked in at **build time**, so it only
> applies to a Cloudflare build that ran *after* you set it. If unsure,
> trigger a fresh deploy (any push, or Cloudflare Pages → Retry deployment).

### Step 2 — Apply database migrations

```bash
supabase db push
```

It lists every unapplied migration and asks to confirm — say **yes**.
Pending from recent sessions includes:

- `007`–`013` — compound video, bulk import, media bucket, invoice
  breakdown, variant pricing, order tracking, order receipt + revert
- `014_order_events` — append-only order notes/history timeline
- `015_order_line_edits` — admin write access to edit itemized lines
- `016_client_order_invoice` — public TrackOrder invoice totals + itemized

### Step 3 — Deploy the edge functions

Simplest — deploy them all:

```bash
supabase functions deploy
```

What it covers (and why they need a redeploy): `send-order-invoice`
(now renders the optional "Order Notes" card for send-with-notes),
`resolve-video` (clip thumbnails), `send-receipt`, `send-contact`,
`place-order`, `send-inquiry` (Turnstile secret + code), plus
`send-shipment-notification` / `send-delivered-notification`.

### Step 4 — Verify it all works

- **Bot protection:** submit the Contact form — still goes through, now
  actually verified server-side.
- **Order notes:** open an order → save a note → reload → it persists
  (this is migration `014`; before it, notes only showed for the session).
- **Edit itemized:** order → Itemized → **Edit** → change/add/remove a
  line → **Save itemized** — saves without a "needs migration 015" error.
- **Send with notes:** order → Send to client / Re-notify → **Send with
  notes** → the email arrives with an "Order Notes" card.
- **Receipt:** mark a test order delivered → branded paid receipt emails;
  "View / Resend receipt" works on the order.
- **Clip thumbnails:** Admin → Catalog · Inventory → Clip → paste a
  TikTok link → Fetch → a thumbnail appears (resolve-video + media bucket).
- **Public tracking:** `/track` with order# + ZIP shows totals + paid
  flag; order# + ZIP reveals itemized lines (migration `016`).

**Done when:** every line above checks. That's Motion 1 complete — the
order module is live, correct-to-deploy, and bot-protected. (Pricing
truth, customer pay-confirm link, and cc-to-self are later motions.)

---

## Prerequisites — accounts you need

Skip any you already have. Use the same email for all of them — easier
to manage.

| Service | URL | Purpose | Cost |
|---|---|---|---|
| Supabase | supabase.com | Database + Auth + Edge Functions | Free tier covers this |
| Cloudflare | cloudflare.com | Static hosting + DNS | Free tier covers this |
| Resend | resend.com | Outbound email | Free up to 3k emails/month |
| Domain | (registrar of choice) | `vsresearchlabs.com` | ~$10–15/year |

> If you don't have a domain yet, register one **first** (Cloudflare
> Registrar or Namecheap are easy). Everything else assumes you own
> one.

---

## Phase 0 — Resend domain verification (~15 min active, then wait)

You want to do this first because DNS records take time to propagate.

1. Sign up at **resend.com**.
2. Domains → **Add Domain** → enter `vsresearchlabs.com`.
3. Resend shows you a list of DNS records to add (TXT + MX + CNAMEs for
   DKIM/SPF). Copy them.
4. Add those records at your registrar (or in Cloudflare DNS if your
   domain is on Cloudflare). All TXT/MX/CNAME records.
5. Click **Verify DNS Records** in Resend. May say "pending" for up
   to an hour — that's normal. Continue with Phase 1 while waiting.
6. Once verified, **API Keys** → **Create API Key** → name it
   `vsresearchlabs-prod` → copy the key starting with `re_`. Save it
   in a password manager. You won't be able to see it again.

**Done when:** Resend dashboard shows your domain as "Verified" (green)
and you have a `re_` API key saved.

---

## Phase 1 — Supabase backend (~30 min)

### 1.1 Create the project (skip if you already have one)

1. supabase.com → **New Project**.
2. Name: `vsresearchlabs-prod`
3. Database password: generate a strong one, save in password manager.
4. Region: pick the one closest to your buyers (US-East / US-West).
5. Wait ~2 min for provisioning.

### 1.2 Apply database migrations

#### Step 1 — Check what's already there

In **SQL Editor → New query**, paste and **Run**:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You'll get a list of tables that already exist. Match it against one of
the three scenarios below.

#### Step 2 — Pick your scenario, paste the right migration(s)

For each scenario, "paste" means: open the file in your editor, copy
the whole thing, paste into Supabase **SQL Editor → New query**, click
**Run**, and wait for the green "Success" banner before moving to the
next file.

**Scenario A — fresh project** (no tables, or only `products`)
Run all three, in this exact order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_inquiries.sql`
3. `supabase/migrations/003_inventory_ops.sql`

**Scenario B — you already see `products`, `inquiries`, `inquiry_items`**
Only run:

1. `supabase/migrations/003_inventory_ops.sql`

**Scenario C — you also see `admin_users`, `orders`, `product_stock`, `stock_movements`**
Everything's already applied. Skip to step 1.3.

#### Step 3 — Verify before moving on

Re-run the check query from Step 1. You should see all of these
tables in the list:

- `admin_users`
- `inquiries`
- `inquiry_items`
- `order_lines`
- `orders`
- `product_stock`
- `product_supplier_links`
- `products`
- `stock_movements`

#### Common errors when applying migrations

| Error message | What it means | Fix |
|---|---|---|
| `relation "X" already exists` | That migration was applied previously | Skip that file, move to the next |
| `function is_admin() does not exist` | Migrations ran out of order | Re-run from scratch in 001→002→003 order |
| `type "order_status" already exists` | 003 was partially applied | Drop the enum manually then re-run (ping me) |
| `permission denied for schema auth` | RLS / role issue on some plans | Tell me — there's a workaround |

If you get any other red error, paste it verbatim and I'll diagnose.

**Done when:** the verify query in Step 3 lists all nine tables.

### 1.3 Install the Supabase CLI on your laptop

```bash
# macOS:
brew install supabase/tap/supabase

# Or via npm:
npm install -g supabase
```

### 1.4 Link the CLI to your project

In the repo root:

```bash
supabase login              # opens browser, authorize
supabase link --project-ref YOUR_PROJECT_REF
```

You can find `YOUR_PROJECT_REF` in **Project Settings → General** — it's
the short string in your project URL (`https://<ref>.supabase.co`).

### 1.5 Set Edge Function secrets

From the same terminal:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set RESEND_FROM_EMAIL='VS Research Labs <inquiries@vsresearchlabs.com>'
supabase secrets set INQUIRY_TO_EMAIL=inquiries@vsresearchlabs.com
supabase secrets set ALLOWED_ORIGIN='*'
```

> The `*` is intentional for now — we'll lock it down to your real
> domain in Phase 3.6. Trying to set the locked-down version before
> Cloudflare gives you a URL would just block your own testing.

Verify:

```bash
supabase secrets list
```

You should see all four secrets listed.

### 1.6 Deploy the three Edge Functions

```bash
supabase functions deploy send-inquiry
supabase functions deploy send-order-invoice
supabase functions deploy send-shipment-notification
```

Each one takes ~30 seconds. Verify in **Edge Functions** → all three
show **Status: Active**.

**Done when:** all three functions are deployed and the four secrets
are set.

---

## Phase 2 — Deploy frontend to Cloudflare Pages (~20 min)

### 2.1 Push your latest code to GitHub

```bash
# In repo root
git status              # check there are no surprises
git add .
git commit -m "Pre-launch build"
git push origin main
```

### 2.2 Connect repo to Cloudflare Pages

1. dash.cloudflare.com → **Workers & Pages** → **Create application**.
2. **Pages** tab → **Connect to Git**.
3. Authorize GitHub if first time → pick `vsresearchlabs` repo →
   **Begin setup**.
4. Project name: `vsresearchlabs`
5. **Framework preset:** None
6. **Build command:** `npm run build`
7. **Build output directory:** `dist`
8. **Root directory:** (leave blank)
9. **Environment variables (Production)** → add:
   - `VITE_SUPABASE_URL` = `https://YOUR_REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (from Supabase: **Project Settings →
     API → Project API keys → `anon` `public`**)
   - `NODE_VERSION` = `20`
10. **Save and Deploy**.

First build takes ~3–4 minutes. You'll get a URL like
`vsresearchlabs.pages.dev`.

**Done when:** that `*.pages.dev` URL loads your landing page and you
can navigate to `/research-supplies/biopeptide` and see the catalog.

---

## Phase 3 — Custom domain + CORS lockdown (~15 min)

### 3.1 Point domain at Cloudflare Pages

1. Your project in Cloudflare Pages → **Custom domains** tab.
2. **Set up a custom domain** → enter `vsresearchlabs.com`.
3. If your domain is on Cloudflare: records are added automatically.
4. If your domain is elsewhere: Cloudflare gives you a CNAME — add it
   at your registrar. May take 10–15 min to propagate.

### 3.2 Also add the `www` subdomain (optional but standard)

Same screen → **Set up a custom domain** → `www.vsresearchlabs.com`.

### 3.3 Lock down CORS on the Edge Functions

Now that you know your live origin, restrict it:

```bash
supabase secrets set ALLOWED_ORIGIN=https://vsresearchlabs.com
supabase functions deploy send-inquiry
supabase functions deploy send-order-invoice
supabase functions deploy send-shipment-notification
```

(Re-deploy is required for the env var change to take effect.)

**Done when:** `https://vsresearchlabs.com` serves the site over HTTPS,
and submitting a test inquiry from your live URL succeeds.

---

## Phase 4 — Create your admin user (~10 min)

### 4.1 Create the auth user

Supabase Dashboard → **Authentication** → **Users** → **Add user** →
**Create new user**:

- Email: your real admin email
- Password: strong, save in password manager
- **Auto Confirm User**: ✅

### 4.2 Copy the user ID

Click the row of your newly-created user → copy the **UID** field.

### 4.3 Grant admin role

**SQL Editor** → new query → paste (replace placeholders):

```sql
insert into admin_users (user_id, email, display_name, active)
values (
  '<paste UID here>',
  'you@vsresearchlabs.com',
  'Raymond',
  true
);
```

Click **Run**. You should see "Success. 1 row inserted."

### 4.4 Sign in to your live admin

Visit `https://vsresearchlabs.com/admin` → enter your email + password.

**Done when:** you land on the Admin Dashboard with the 5 stat cards
(all zeros at first — that's expected).

---

## Phase 5 — Seed inventory + test the full loop (~20 min)

### 5.1 Hydrate the catalog

Admin Dashboard → **Seed catalog stock** button. This walks every SKU
in `products.json` and the biopeptide manifest, creating a stock row at
0 for each. Idempotent — safe to re-run after adding new SKUs.

You'll see "Inserted N · Skipped 0" when done. Total ~180 SKUs.

### 5.2 Enter real stock for items you actually have

Go to **Inventory**. For each SKU you have in stock:

1. Click **Adjust**
2. Reason: **Restock received**
3. Delta: positive number (e.g. `+10`)
4. Notes: lot number / supplier (optional)
5. **Apply**

Every adjust writes to `stock_movements`. Visit **Stock History** to
verify.

### 5.3 Test the full ops loop on yourself

This is the most important step — exercise the whole flow before any
real customer hits it.

1. Open `https://vsresearchlabs.com` in a fresh browser (or incognito).
2. Add an in-stock item to the inquiry cart from the biopeptide
   inventory modal.
3. Submit an inquiry to yourself.
4. Verify two emails arrive: one to `INQUIRY_TO_EMAIL` (business
   notification) and one to your buyer email (confirmation).
5. In `/admin/inquiries`, expand the row → **Create order**.
6. On the order detail page, paste any URL (e.g. `https://example.com/test`)
   for invoice URL, type `1.00` for amount → **Send invoice + email**.
7. Check your inbox for the payment-instructions email. Verify the
   PayPal F&F / Zelle copy reads correctly.
8. Click **Mark paid**.
9. Click **Confirm fulfilled** with tracking `TEST123`.
10. Verify:
    - You receive the "Your order has shipped" email
    - **Stock History** shows a `-N` row with reason `order_fulfilled`
    - **Inventory** shows the SKU's on_hand decremented
    - **Orders** shows the order in `fulfilled` state
    - **Dashboard** counters reflect the new state

**Done when:** every line above is checked. You now know the system
works end-to-end with your real email + real Supabase + real DNS.

---

## Daily ops cheat-sheet

Once you're live, here's the inquiry-to-shipped loop:

```
1. New inquiry email lands in your inbox       (automatic)
2. /admin/inquiries → expand row → "Create order"
3. Generate an invoice in PayPal / Stripe / wherever, copy the link
4. Order detail → paste URL + amount → "Send invoice + email"
   → Buyer gets payment-instructions email     (automatic)
5. WAIT for payment to arrive in your PayPal/Zelle
   (no webhook for these methods — you check manually)
6. Once funds confirmed: order detail → "Mark paid"
7. Pack and ship the order via your carrier of choice
8. Order detail → enter tracking → "Confirm fulfilled"
   → Stock decrements + audit logged           (automatic)
   → Buyer gets shipment notification           (automatic)
```

Average steady-state time per order, once practiced: ~3 minutes.

---

## What's automatic vs what you do manually

| Step | Automated? | How |
|---|---|---|
| Inquiry submission → DB + your email | ✅ | `send-inquiry` |
| Inquiry → Order | ❌ | You click "Create order" |
| Invoice generation (PayPal/Stripe link) | ❌ | External tool, paste link |
| Invoice email to buyer | ✅ | `send-order-invoice` |
| **Payment verification** | ❌ | PayPal F&F / Zelle have no webhook |
| Stock decrement on fulfill | ✅ | `confirm_order_fulfilled` RPC |
| Shipment notification to buyer | ✅ | `send-shipment-notification` |
| Audit log per state change | ✅ | `stock_movements` |

---

## Troubleshooting

**"Backend not configured" message on `/admin`**
→ Cloudflare Pages env vars aren't set or build hasn't picked them up.
   In Pages → Settings → Environment variables, confirm
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set for
   **Production**, then trigger a redeploy (Deployments → Retry deploy).

**"This account is not authorized for admin access"**
→ User exists in Auth but not in `admin_users`. Re-run the INSERT
   from Phase 4.3.

**Sign-in spins forever**
→ Cloudflare Pages → Functions → check the browser console. Usually a
   CORS issue. Confirm `ALLOWED_ORIGIN` matches your domain exactly
   (no trailing slash).

**Edge Function returns "Email service not configured"**
→ `RESEND_API_KEY` not set in Supabase secrets. Re-run
   `supabase secrets set RESEND_API_KEY=…` and redeploy the function.

**Resend says emails delivered but they're not arriving**
→ Check spam. If from non-`vsresearchlabs.com` address, the domain
   isn't verified. Re-check DNS records.

**`Insufficient stock for SKU X` on Confirm Fulfilled**
→ Stock would go negative. Either restock that SKU first, or cancel
   the line. Nothing decremented — the transaction rolled back.

**Stock count looks wrong**
→ Stock History is the source of truth. Replay shows every change.
   If reality and DB disagree, do an Adjust → reason `physical_count`
   → notes "reconciliation YYYY-MM-DD".

---

## Future automations (skip for v1)

- **Low-stock email alert** — Postgres trigger when `on_hand < reorder_at`
- **Stale invoice auto-cancel** — cron to cancel `invoice_sent` orders >7 days idle
- **Daily ops digest** — morning email summarizing yesterday's activity
- **Stripe webhook → auto mark paid** — only if you take Stripe payments

Each is a small Edge Function + Postgres trigger — ~30 min of work
each. Mention when you want them.
