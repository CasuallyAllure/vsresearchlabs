/**
 * Order payload types + validation/normalization for place-order.
 *
 * Deliberately free of Deno globals and remote imports (like priceCheck.ts)
 * so vitest can pin the boundary validation (tests/unit/orderPayload.test.ts)
 * and tsc can typecheck it. The handler turns an { ok: false } result into the
 * same jsonResponse(error, status) it always returned — messages and statuses
 * here are byte-identical to the pre-extraction inline checks.
 */

import { EMAIL_REGEX, clampQty, clampCents } from "./orderFormat.ts";
import { sanitizeAttestation } from "./sanitizeAttestation.ts";

export interface OrderItemPayload {
  product: { id: string; name: string; category: string | null; sku?: string };
  quantity: number;
  note?: string;
  unitPriceCents?: number;
  /** true = fast ship, false = standard (drop-ship). Drives the email badges. */
  fast?: boolean;
}

export interface OrderPayload {
  name: string;
  contact: string;
  organization?: string;
  notes?: string;
  ship_street?: string;
  ship_city?: string;
  ship_state?: string;
  ship_zip?: string;
  ship_country?: string;
  items: OrderItemPayload[];
  /** Promo/affiliate code. Validated + priced SERVER-SIDE via validate_coupon —
   *  the client never supplies a discount amount, only the code. */
  coupon_code?: string;
  /** Stackable promo codes — the buyer may apply more than one. Superset of
   *  `coupon_code`; each is validated + priced SERVER-SIDE and stacked
   *  (additive off the original subtotal, capped so the order never < $0). */
  coupon_codes?: string[];
  /** What the cart preview showed as the LAUNCH DAY BOGO discount, in cents.
   *  ADVISORY ONLY — it never influences the price. The server recomputes BOGO
   *  from its own catalog and its own clock; this field exists solely so that
   *  when the server grants nothing and the buyer was shown something (the
   *  classic case: the promo window closed while the cart sat open), the
   *  response can say so in plain language instead of the buyer silently
   *  paying more than the cart quoted. Flag, never block. */
  expected_bogo_cents?: number;
  /** Client-generated UUID, stable across retries of the SAME checkout —
   *  a seen key returns the existing order instead of creating a duplicate. */
  idempotency_key?: string;
  /** Research-use disclaimer acceptance captured by the entry gate —
   *  re-sanitized here and stored on the order as the compliance trail. */
  research_attestation?: {
    accepted_at?: string;
    disclaimer_version?: number;
    industry?: string;
    age_21_confirmed?: boolean;
    research_use_confirmed?: boolean;
  };
}

export interface ValidatedOrder {
  name: string;
  contact: string;
  organization: string;
  notes: string;
  shipStreet: string;
  shipCity: string;
  shipState: string;
  shipZip: string;
  shipCountry: string;
  attestation: Record<string, unknown> | null;
  items: OrderItemPayload[];
  /** Initial values — the handler may append server-generated free lines later. */
  itemCount: number;
  grossSubtotalCents: number;
  contactIsEmail: boolean;
  cleanPayload: OrderPayload;
}

export type ValidateOrderResult =
  | { ok: false; error: string; status: number }
  | { ok: true; value: ValidatedOrder };

function reject(error: string, status = 400): ValidateOrderResult {
  return { ok: false, error, status };
}

export function validateOrderPayload(payload: OrderPayload): ValidateOrderResult {
  const name         = (payload.name ?? "").trim();
  const contact      = (payload.contact ?? "").trim();
  const organization = (payload.organization ?? "").trim();
  const notes        = (payload.notes ?? "").trim();
  const shipStreet   = (payload.ship_street  ?? "").trim().slice(0, 200);
  const shipCity     = (payload.ship_city    ?? "").trim().slice(0, 120);
  const shipState    = (payload.ship_state   ?? "").trim().slice(0,  60);
  const shipZip      = (payload.ship_zip     ?? "").trim().slice(0,  20);
  const shipCountry  = (payload.ship_country ?? "US").trim().slice(0,  60);
  const attestation  = sanitizeAttestation(payload.research_attestation);
  const rawItems: unknown[] = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];

  if (!name)                     return reject("Name is required.");
  if (name.length > 120)         return reject("Name too long.");
  if (!contact)                  return reject("Contact is required.");
  if (contact.length > 200)      return reject("Contact too long.");
  if (organization.length > 200) return reject("Organization too long.");
  if (notes.length > 4000)       return reject("Notes too long.");
  if (rawItems.length === 0)     return reject("Order must contain at least one item.");
  if (rawItems.length > 100)     return reject("Too many items in order.");

  const items: OrderItemPayload[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") return reject("Malformed item.");
    const r = raw as Record<string, unknown>;
    const product = (r.product ?? null) as Record<string, unknown> | null;
    if (!product || typeof product !== "object") return reject("Item missing product details.");
    const productId   = typeof product.id === "string" ? product.id : "";
    const productName = typeof product.name === "string" ? product.name.trim() : "";
    if (!productId || !productName) return reject("Item product must include id and name.");
    // Bound the line name. It is the text the price check resolves a dose from,
    // and that resolution is superlinear in the name's length when a dose token
    // repeats — an uncapped name is a cheap way to burn CPU inside the handler
    // (a 128 KB name of repeated dose tokens already costs ~0.5s, and the promo
    // planner resolves the same line a second time). The longest real cart-line
    // name in the catalog is 51 chars; 200 matches the ship_street bound and
    // leaves an order of magnitude of headroom. Reject rather than truncate —
    // a silently shortened name is a wrong invoice, and every honest client is
    // far under this.
    if (productId.length > 200 || productName.length > 200) {
      return reject("Item product details too long.");
    }
    const category = typeof product.category === "string" ? product.category : null;
    const sku      = typeof product.sku === "string" ? product.sku.trim() : "";
    const noteRaw  = typeof r.note === "string" ? r.note.trim() : "";
    items.push({
      product: { id: productId, name: productName, category, sku: sku || undefined },
      quantity: clampQty(r.quantity),
      note: noteRaw.length > 0 ? noteRaw.slice(0, 1000) : undefined,
      unitPriceCents: clampCents(r.unitPriceCents),
      fast: typeof r.fast === "boolean" ? r.fast : undefined,
    });
  }

  const itemCount = items.reduce((s, i) => s + clampQty(i.quantity), 0);
  const grossSubtotalCents = items.reduce((s, i) => s + clampCents(i.unitPriceCents) * clampQty(i.quantity), 0);
  const contactIsEmail = EMAIL_REGEX.test(contact);
  const cleanPayload: OrderPayload = {
    name, contact,
    organization: organization || undefined,
    notes: notes || undefined,
    ship_street:  shipStreet  || undefined,
    ship_city:    shipCity    || undefined,
    ship_state:   shipState   || undefined,
    ship_zip:     shipZip     || undefined,
    ship_country: shipCountry || undefined,
    items,
  };

  return {
    ok: true,
    value: {
      name, contact, organization, notes,
      shipStreet, shipCity, shipState, shipZip, shipCountry,
      attestation, items, itemCount, grossSubtotalCents, contactIsEmail, cleanPayload,
    },
  };
}
