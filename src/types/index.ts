// ─── Product ───
export type {
  Product,
  ProductCategory,
  ProductType,
  ResearchClassification,
  ProductSpec,
  ProductVariant,
  ProductStudy,
  StudyModel,
} from './product';
export { deriveProductDose } from './product';

// ─── Document (Wave 9 — Documentation Library Foundation) ───
export type { Document, DocumentTypeLabel } from './document';

import type { Product } from './product';

// ─── Cart Item ───
export interface CartItem {
  product: Product;
  quantity: number;
  /** Optional per-item note submitted alongside the inquiry. */
  note?: string;
}
