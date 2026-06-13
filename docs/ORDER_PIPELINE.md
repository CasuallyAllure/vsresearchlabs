# Order → Invoice → Admin pipeline

Auto-invoice checkout: a buyer's cart becomes a recorded **order** and they
get a **branded invoice email** with Zelle/PayPal (Friends & Family)
instructions + their order number. The order is recorded and shows up in
admin (Orders, Customers, Reports).

## What was added (frontend — already on the branch, builds clean)

- `src/components/brand/BrandStamp.tsx` — the header wordmark as a static
  stamp graphic (themeable ink). On the order receipt.
- `public/brand-stamp.svg` — dark-ink standalone stamp (rasterize → PNG for
  the email if you want an image instead of the built-in text mark).
- `src/lib/payment.ts` + `src/components/order/PaymentInstructions.tsx` —
  on-screen payment instructions (mirrors the email).
- `src/pages/CartPage.tsx` — checkout now calls `place-order`, shows the
  order number, total, "invoice emailed", and the payment instructions.

## What was added (backend — needs deploy to your Supabase)

- `supabase/functions/place-order/index.ts` — on checkout: insert inquiry
  (history + customer trigger) → create `orders` row (status `invoice_sent`,
  amount = sum of cart line prices) → insert `order_lines` → email the buyer
  the branded invoice + email the business a copy.

No new migration is needed — it writes to existing tables (`inquiries`,
`inquiry_items`, `orders`, `order_lines`).

## Go-live steps

1. **Set the payment handles + email config.**
   - Frontend (`.env` / Cloudflare Pages):
     `VITE_ZELLE_HANDLE`, `VITE_PAYPAL_HANDLE`
   - Supabase secrets (Edge Functions → Manage secrets, or `supabase secrets set`):
     `ZELLE_HANDLE`, `PAYPAL_HANDLE` (match the VITE ones),
     `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `INQUIRY_TO_EMAIL`,
     `ALLOWED_ORIGIN`, and optionally `BRAND_STAMP_URL` (hosted PNG of the stamp).

2. **Deploy the function:**
   ```
   supabase functions deploy place-order
   ```

3. **Smoke test (end-to-end):**
   - Add a product → checkout → fill name + a real **email** → Place Order.
   - Expect: on-screen order number `VSR-ORD-…`, total, payment instructions;
     an invoice email arrives with the same; a business copy arrives.
   - Admin → **Orders**: the new order appears (status `invoice_sent`).
   - Admin → **Customers**: the buyer appears / order_count bumped.
   - Admin → **Reports**: export Orders / Order Lines — the order is in the data.
   - Confirm payment manually → admin marks paid → fulfilled (stock decrements,
     shipment email) per the existing flow.

## Notes / follow-ups

- **Pricing is placeholder.** Line prices come from the site's per-tier
  placeholder values (`src/lib/pricing.ts`). When real prices land, the
  invoice totals follow automatically. The edge function trusts client line
  prices for now — acceptable because payment is verified manually against
  the order number; recompute server-side from a trusted source before
  billing real money at scale.
- **Cart doesn't track which tier** was selected (it keys items by product),
  so a line prices off the product's default dose. Making the cart
  tier-aware is a separate enhancement.
- The order is created with no `created_by` (web order, no admin user) and is
  not written to `audit_log` (only admin RPCs write audit rows). The order
  row itself is the record of truth; admin actions on it are audited.
