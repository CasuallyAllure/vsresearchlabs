// ─── Product ───
export type { Product, ProductCategory, ProductSpec } from './product';

import type { Product } from './product';

// ─── Cart Item ───
export interface CartItem {
  product: Product;
  quantity: number;
  /** Optional per-item note submitted alongside the inquiry. */
  note?: string;
}

// ─── Order ───
export interface Order {
  id: string;
  stripe_session_id: string | null;
  customer_email: string;
  customer_name: string | null;
  shipping_address: Record<string, unknown> | null;
  status: 'pending' | 'paid' | 'fulfilled' | 'shipped' | 'delivered';
  total_cents: number | null;
  created_at: string;
}

// ─── Order Item ───
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price_cents: number;
}
