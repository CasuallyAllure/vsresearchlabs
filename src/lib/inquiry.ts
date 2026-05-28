/**
 * Inquiry Record — S1 (Inquiry Persistence)
 *
 * Reference IDs are now server-authoritative. The Edge Function generates
 * and persists the reference ID; the client receives it in the API response
 * and uses it to render the intake document.
 *
 * `generateInquiryRecord` no longer derives a local reference ID.
 * It accepts a `server` argument carrying the server-returned authoritative
 * values and merges them with the local form state to build the display record.
 */

import type { CartItem } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InquiryLineItem {
  sku: string;
  name: string;
  quantity: number;
  category: string;
  note?: string;
}

export interface InquiryRecord {
  referenceId: string;
  /** ISO 8601 timestamp returned by the server (DB created_at). */
  submittedAt: string;
  contactSummary: {
    name: string;
    contact: string;
    organization: string;
  };
  itemCount: number;
  procurementSummary: InquiryLineItem[];
  estimatedResponseWindow: string;
  intakeChannel: string;
  processingNode: string;
  classificationStatus: string;
}

/** Server-authoritative fields returned by the send-inquiry Edge Function. */
export interface InquiryServerData {
  /** Server-generated reference ID — format VSR-REQ-YYMMDD-NNN. */
  referenceId: string;
  /** ISO 8601 timestamp from the DB row's created_at column. */
  submittedAt: string;
  intakeChannel: string;
  processingNode: string;
  classificationStatus: string;
}

export interface InquiryRecordInput {
  name: string;
  contact: string;
  organization: string;
  items: CartItem[];
}

// ─── Generator ────────────────────────────────────────────────────────────────

export function generateInquiryRecord(
  input: InquiryRecordInput,
  server: InquiryServerData,
): InquiryRecord {
  return {
    referenceId: server.referenceId,
    submittedAt: server.submittedAt,
    contactSummary: {
      name:         input.name,
      contact:      input.contact,
      organization: input.organization,
    },
    itemCount: input.items.reduce((sum, i) => sum + i.quantity, 0),
    procurementSummary: input.items.map((i) => ({
      sku:      i.product.sku,
      name:     i.product.name,
      quantity: i.quantity,
      category: i.product.category.replace(/-/g, ' '),
      note:     i.note?.trim() || undefined,
    })),
    estimatedResponseWindow: '1–2 business days',
    intakeChannel:        server.intakeChannel,
    processingNode:       server.processingNode,
    classificationStatus: server.classificationStatus,
  };
}
