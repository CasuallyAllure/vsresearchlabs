import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { siteConfig } from '../config';
import type { CartItem, Product } from '../types';

const MAX_QTY = 999;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.floor(n)));
}

/** A promo code the buyer applied in the cart. Snapshot of the server's
 *  validate_coupon response — display/preview only. place-order re-validates
 *  and re-prices the code server-side; nothing here is trusted for billing. */
export interface AppliedCoupon {
  code: string;
  kind: 'percent' | 'fixed' | 'free_item';
  percent: number | null;
  amountCents: number | null;
  freeSku: string | null;
  freeDose: string | null;
  freeLabel: string | null;
  minSubtotalCents: number;
  /** Member-gated code (048) — only a signed-in account holder can redeem. */
  requiresAccount: boolean;
}

interface CartStore {
  items: CartItem[];
  /** Applied promo codes (stackable). Snapshots for display only — place-order
   *  re-validates + re-prices every code server-side. */
  coupons: AppliedCoupon[];
  add: (product: Product) => void;
  remove: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setItemNote: (productId: string, note: string) => void;
  /** Add a code if it isn't already applied (dedupe by code). */
  addCoupon: (coupon: AppliedCoupon) => void;
  removeCoupon: (code: string) => void;
  clear: () => void;
  total: () => number;
  itemCount: () => number;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      coupons: [],

      add: (product) =>
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product.id === product.id
                  ? { ...i, quantity: clampQty(i.quantity + 1) }
                  : i
              ),
            };
          }
          return { items: [...state.items, { product, quantity: 1 }] };
        }),

      remove: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.product.id !== productId),
        })),

      updateQuantity: (productId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.product.id !== productId)
              : state.items.map((i) =>
                  i.product.id === productId
                    ? { ...i, quantity: clampQty(quantity) }
                    : i
                ),
        })),

      setItemNote: (productId, note) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.product.id !== productId) return i;
            const trimmed = note.trim();
            if (trimmed.length === 0) {
              // Clear the note entirely so payloads stay clean.
              const { note: _drop, ...rest } = i;
              void _drop;
              return rest;
            }
            return { ...i, note: trimmed };
          }),
        })),

      addCoupon: (coupon) =>
        set((state) =>
          state.coupons.some((c) => c.code === coupon.code)
            ? state
            : { coupons: [...state.coupons, coupon] }
        ),

      removeCoupon: (code) =>
        set((state) => ({
          coupons: state.coupons.filter((c) => c.code !== code),
        })),

      clear: () => set({ items: [], coupons: [] }),

      total: () =>
        get().items.reduce(
          (sum, item) =>
            sum + (item.product.priceCents ?? 0) * item.quantity,
          0
        ),

      itemCount: () =>
        get().items.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: siteConfig.storage.cartKey,
      storage: createJSONStorage(() => localStorage),
      // v1: single `coupon` became a stackable `coupons` array. Migrate old
      // persisted carts so a returning buyer keeps (or cleanly drops) their code.
      version: 1,
      migrate: (persisted, version) => {
        if (persisted && typeof persisted === 'object' && version < 1) {
          const { coupon, ...rest } = persisted as Record<string, unknown> & {
            coupon?: AppliedCoupon | null;
          };
          return { ...rest, coupons: coupon ? [coupon] : [] };
        }
        return persisted as Partial<CartStore>;
      },
      // Persist line items + applied promos; derived selectors stay in memory.
      partialize: (state) => ({ items: state.items, coupons: state.coupons }),
    }
  )
);
