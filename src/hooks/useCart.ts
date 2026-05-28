import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem, Product } from '../types';

const MAX_QTY = 999;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.floor(n)));
}

interface CartStore {
  items: CartItem[];
  add: (product: Product) => void;
  remove: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setItemNote: (productId: string, note: string) => void;
  clear: () => void;
  total: () => number;
  itemCount: () => number;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

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

      clear: () => set({ items: [] }),

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
      name: 'vsresearchlabs.cart.v1',
      storage: createJSONStorage(() => localStorage),
      // Only persist the line items; derived selectors stay in memory.
      partialize: (state) => ({ items: state.items }),
    }
  )
);
