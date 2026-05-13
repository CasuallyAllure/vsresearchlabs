# VS Research Labs — Build Blueprint
> Extracted from VelariNights-APP design system · Ready for standalone repo

---

## What This Is

A dropshipping e-commerce site for peptide accessories (pen cases, carry cases, injection accessories). Products are sourced from AliExpress via blind dropshipping. Customers pay via Stripe, orders are auto-fulfilled through DSers or AliExpress DS API, and packages ship with no supplier branding.

**Domain:** VS Research Labs (vsresearchlabs.com)
**Tone:** Clean, premium, clinical-minimal — like a biotech brand, not a storefront
**Stack:** React + TypeScript + Vite + Tailwind CSS + GSAP + Supabase + Stripe

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + custom CSS variables (glass system) |
| Animation | GSAP + ScrollTrigger (landing) · Framer Motion (UI micro-interactions) |
| Font | Inter (Google Fonts) |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| Payments | Stripe Checkout |
| Email | Resend (transactional) |
| Fulfillment | DSers (AliExpress automation) |
| Hosting | Vercel or Netlify |

---

## Project File Tree

```
vsresearchlabs/
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── package.json
├── .env.example
│
├── src/
│   ├── main.tsx
│   ├── App.tsx                        ← Routes: / (landing) + /store + /product/:id + /cart + /order/:id
│   ├── index.css                      ← Glass system, animations, global styles
│   │
│   ├── components/
│   │   ├── ui/
│   │   │   ├── GlassCard.tsx          ← Core glass surface primitive
│   │   │   ├── Button.tsx             ← CVA-based button variants
│   │   │   ├── Badge.tsx              ← Status/category badges
│   │   │   ├── Modal.tsx              ← Centered + bottom-sheet modals
│   │   │   ├── Input.tsx              ← Glass-styled text input
│   │   │   ├── Chip.tsx               ← Filter pill chips
│   │   │   └── Spinner.tsx            ← Loading spinner
│   │   │
│   │   ├── layout/
│   │   │   ├── Shell.tsx              ← Full-page dark shell (replaces VelariShell)
│   │   │   ├── Navbar.tsx             ← Sticky glass navbar: Logo | Nav | Cart icon
│   │   │   └── Footer.tsx             ← Minimal footer: links, disclaimer, copyright
│   │   │
│   │   ├── landing/
│   │   │   ├── HeroSection.tsx        ← GSAP: headline fade-up, ambient glow, CTA
│   │   │   ├── ProductPreview.tsx     ← GSAP ScrollTrigger: 3 featured products slide in
│   │   │   ├── HowItWorksSection.tsx  ← 3-step process (Order → Fulfilled → Delivered)
│   │   │   ├── DisclaimerBanner.tsx   ← "For research purposes only" sticky banner
│   │   │   └── TrustBar.tsx           ← Icons: Secure Checkout · Fast Shipping · Research Grade
│   │   │
│   │   └── store/
│   │       ├── ProductGrid.tsx        ← Responsive grid, maps product cards
│   │       ├── ProductCard.tsx        ← Glass card: image, name, price, add-to-cart
│   │       ├── FilterBar.tsx          ← Chip-based category filters
│   │       ├── ProductDetail.tsx      ← Full product page: images, description, quantity, CTA
│   │       ├── Cart.tsx               ← Bottom-sheet cart drawer
│   │       ├── CartItem.tsx           ← Individual cart row
│   │       └── OrderConfirmation.tsx  ← Post-checkout confirmation screen
│   │
│   ├── lib/
│   │   ├── stripe.ts                  ← createCheckoutSession() helper
│   │   ├── supabase.ts                ← Supabase client init
│   │   └── resend.ts                  ← sendOrderConfirmationEmail() helper
│   │
│   ├── hooks/
│   │   ├── useCart.ts                 ← Zustand cart store (add, remove, clear, total)
│   │   └── useProducts.ts             ← Fetch products from Supabase
│   │
│   ├── types/
│   │   └── index.ts                   ← Product, Order, CartItem type definitions
│   │
│   └── pages/
│       ├── Landing.tsx                ← Assembles landing sections
│       ├── Store.tsx                  ← Assembles store: FilterBar + ProductGrid
│       ├── ProductPage.tsx            ← Wraps ProductDetail
│       ├── CartPage.tsx               ← Wraps Cart
│       └── OrderPage.tsx              ← Wraps OrderConfirmation
│
└── supabase/
    ├── functions/
    │   ├── create-checkout-session/   ← Stripe checkout session Edge Function
    │   └── stripe-webhook/            ← Handle payment_intent.succeeded → insert order
    └── migrations/
        └── 001_initial.sql            ← products, orders, order_items tables
```

---

## Design System (Extracted from VelariNights)

### Color Palette
```css
/* Paste into src/index.css :root */
--color-bg: #000000;
--color-bg-elevated: #0a0a0a;
--color-bg-overlay: #121212;

--color-text-primary: #ffffff;
--color-text-secondary: #b3b3b3;
--color-text-tertiary: #666666;

--color-border: rgba(255, 255, 255, 0.1);
--color-border-strong: rgba(255, 255, 255, 0.2);

--color-accent: #C4A35A;          /* Gold — use for CTAs, prices, highlights */
--color-accent-hover: #D4B896;
--color-accent-dark: #8B7355;

--color-success: #10b981;
--color-warning: #f59e0b;
--color-error: #ef4444;

/* Glass */
--glass-tint: rgba(255, 255, 255, 0.14);
--glass-blur: 16px;
--glass-blur-heavy: 24px;
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
--glass-shadow-hover: 0 16px 48px rgba(0, 0, 0, 0.6);
```

### Glass Card (core pattern — copy everywhere)
```css
.glass-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  transition: box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
.glass-card:hover {
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}
```

### Tailwind Config Extensions
```js
// tailwind.config.js
extend: {
  colors: {
    base: { 900: '#000', 800: '#0a0a0a', 700: '#121212', 600: '#1a1a1a' },
    gold: { light: '#D4B896', DEFAULT: '#C4A35A', dark: '#8B7355' },
    text: { primary: '#fff', secondary: '#b3b3b3', tertiary: '#666' },
  },
  borderRadius: {
    card: '20px',
    'card-sm': '12px',
  },
  backgroundImage: {
    'gradient-gold': 'linear-gradient(135deg, #D4B896 0%, #C4A35A 50%, #8B7355 100%)',
  },
  backdropBlur: {
    glass: '16px',
    'glass-heavy': '24px',
  },
}
```

### Key Animations (paste into index.css)
```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
@keyframes glow-breathe {
  0%, 100% { box-shadow: 0 0 60px 15px rgba(196, 163, 90, 0.08); }
  50%       { box-shadow: 0 0 80px 25px rgba(196, 163, 90, 0.14); }
}
@keyframes sheet-enter {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes modal-enter {
  from { transform: scale(0.95); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.animate-fade-up    { animation: fade-up 400ms cubic-bezier(0, 0, 0.2, 1) forwards; }
.animate-glow       { animation: glow-breathe 8s ease-in-out infinite; }
.animate-sheet      { animation: sheet-enter 300ms cubic-bezier(0, 0, 0.2, 1); }
.animate-modal      { animation: modal-enter 250ms cubic-bezier(0.34, 1.56, 0.64, 1); }
```

---

## Component Specs

### GlassCard.tsx
```tsx
// Props: children, className?, onClick?, glow?: boolean
// Base: bg-white/5 backdrop-blur-glass border border-white/10 rounded-card
// Hover: shadow upgrade
// glow prop: adds animate-glow class
```

### Button.tsx
```tsx
// Variants (CVA):
//   primary   → bg-gradient-gold text-black font-semibold
//   secondary → bg-white/10 text-white border border-white/10
//   ghost     → text-white/70 hover:text-white hover:bg-white/5
//   danger    → bg-red-500/20 text-red-400 border border-red-500/20
// Sizes: sm (h-8), md (h-10, default), lg (h-12)
// Active state: scale-[0.98], transition-transform duration-100
```

### Navbar.tsx
```tsx
// Sticky top-0, z-50
// Background: bg-black/80 backdrop-blur-glass border-b border-white/5
// Left: "VS RESEARCH LABS" in tracking-widest text-sm font-light
// Center (desktop): nav links → Store, About, Research
// Right: cart icon with item count badge (gold dot)
```

### HeroSection.tsx (GSAP)
```tsx
// Full viewport height
// Background: radial gradient from #0a0a0a center, black edges
// Animated gold particle field or subtle noise texture
// GSAP timeline on mount:
//   - Overline "RESEARCH GRADE ACCESSORIES" fade-up, delay 0.2s
//   - H1 "Engineered for Precision" fade-up, delay 0.4s
//   - Subtext fade-up, delay 0.6s
//   - CTA buttons fade-up, delay 0.8s
//   - Ambient gold glow on container, delay 1s
// CTA: "Shop Now" (primary/gold) + "Learn More" (ghost)
```

### ProductCard.tsx
```tsx
// GlassCard wrapper, hover: scale(1.02) transition
// Image: aspect-square, object-cover, rounded-card-sm
// Badge top-right: category chip
// Bottom: product name (text-white), price (text-gold font-semibold)
// "Add to Cart" ghost button, appears on hover
```

### Cart.tsx (bottom sheet)
```tsx
// Fixed bottom-0, full width, max-h-[80vh]
// Background: bg-base-800 border-t border-white/10
// animate-sheet on open
// Backdrop: bg-black/60 backdrop-blur-sm
// Footer: subtotal + "Checkout" primary button → calls createCheckoutSession()
```

---

## Database Schema (supabase/migrations/001_initial.sql)

```sql
-- Products (managed manually or via Supabase dashboard)
create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price_cents integer not null,          -- store in cents
  category    text,                      -- 'pen-cases' | 'carry-cases' | 'accessories'
  images      text[],                    -- array of image URLs
  aliexpress_url text,                   -- source URL (private, not shown to customer)
  in_stock    boolean default true,
  created_at  timestamptz default now()
);

-- Orders
create table orders (
  id              uuid primary key default gen_random_uuid(),
  stripe_session_id text unique,
  customer_email  text not null,
  customer_name   text,
  shipping_address jsonb,
  status          text default 'pending', -- pending | paid | fulfilled | shipped | delivered
  total_cents     integer,
  created_at      timestamptz default now()
);

-- Order items
create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders(id),
  product_id uuid references products(id),
  quantity   integer not null,
  price_cents integer not null
);
```

---

## Edge Functions

### create-checkout-session (supabase/functions/create-checkout-session/index.ts)
```
POST body: { items: [{ product_id, quantity }], success_url, cancel_url }

1. Fetch product prices from DB
2. Build Stripe line_items array
3. Create Stripe Checkout Session (mode: 'payment', shipping_address_collection: enabled)
4. Return { url: session.url }
```

### stripe-webhook (supabase/functions/stripe-webhook/index.ts)
```
Listens for: checkout.session.completed

1. Verify Stripe signature
2. Extract session + line items
3. Insert order + order_items into DB
4. Send confirmation email via Resend
5. Return 200
```

---

## Fulfillment Flow (DSers)

1. Sign up at dsers.com, connect your AliExpress account
2. Import products from AliExpress into DSers product catalog
3. Connect DSers to your store via API (or manually map orders)
4. When an order comes in:
   - DSers dashboard shows it as "Awaiting Order"
   - Click "Order" or enable auto-order (paid plan)
   - DSers places the AliExpress order using your saved payment method
   - AliExpress tracking number syncs back automatically
5. Your webhook receives tracking → updates order status → emails customer

**Blind shipping setup:**
- In DSers product settings → "Supplier Note": *"Please do not include any AliExpress branding, packing slip, or pricing information."*
- Most suppliers comply. Message them directly on AliExpress to confirm before going live.

---

## Environment Variables (.env.example)

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # Edge Functions only, never expose to client
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
VITE_STRIPE_PUBLISHABLE_KEY=
RESEND_API_KEY=
```

---

## Package Dependencies

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.0",
    "gsap": "^3.12.5",
    "framer-motion": "^11.2.10",
    "zustand": "^4.5.2",
    "@supabase/supabase-js": "^2.43.0",
    "@stripe/stripe-js": "^3.4.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.2.12"
  }
}
```

---

## Build Order for IDE Claude

Execute in this order — each step depends on the previous:

1. **Init project** — `npm create vite@latest . -- --template react-ts`, install deps
2. **tailwind.config.js** — paste extended config from this blueprint
3. **src/index.css** — paste full design system (CSS vars + glass classes + animations)
4. **src/types/index.ts** — Product, Order, CartItem interfaces
5. **src/lib/supabase.ts** — client init
6. **src/lib/stripe.ts** — createCheckoutSession helper
7. **src/hooks/useCart.ts** — Zustand store
8. **src/hooks/useProducts.ts** — Supabase fetch
9. **src/components/ui/** — GlassCard → Button → Badge → Input → Chip → Modal → Spinner
10. **src/components/layout/** — Shell → Navbar → Footer
11. **src/components/landing/** — HeroSection → ProductPreview → HowItWorksSection → TrustBar → DisclaimerBanner
12. **src/components/store/** — ProductCard → ProductGrid → FilterBar → ProductDetail → CartItem → Cart → OrderConfirmation
13. **src/pages/** — Landing → Store → ProductPage → CartPage → OrderPage
14. **src/App.tsx** — wire up React Router routes
15. **supabase/migrations/001_initial.sql** — run in Supabase dashboard
16. **supabase/functions/** — create-checkout-session + stripe-webhook
17. **Deploy** — push to Vercel, add env vars, configure Stripe webhook endpoint

---

## Notes for IDE Claude

- Keep **dark mode only** — no light mode toggle
- **No new pages beyond the 5 listed** — everything lives in drawer/modal patterns
- The gold accent (`#C4A35A`) is the only color on dark surfaces — use it sparingly
- All cards use the `.glass-card` pattern — no solid white/colored backgrounds
- GSAP is landing-only — use Framer Motion for UI interactions (cart open/close, modals)
- The disclaimer "For Research Purposes Only — Not for Human Use" must appear in: footer, product pages, and DisclaimerBanner
- `aliexpress_url` column in products table is **never** sent to the frontend — server-side only
- Stripe Checkout handles all payment UI — do not build a custom card form
