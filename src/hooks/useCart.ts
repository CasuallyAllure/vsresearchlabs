import { create } from 'zustand';
import type { CartItem, Product } from '../types';

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

export const useCart = create<CartStore>((set, get) => ({
  items: [],

  add: (product) =>
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.product.id === product.id
              ? { ...i, quantity: i.quantity + 1 }
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
              i.product.id === productId ? { ...i, quantity } : i
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
      (sum, item) => sum + item.product.price_cents * item.quantity,
      0
    ),

  itemCount: () =>
    get().items.reduce((sum, item) => sum + item.quantity, 0),
}));
