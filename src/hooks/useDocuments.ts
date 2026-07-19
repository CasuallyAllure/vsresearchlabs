/**
 * Document Hooks — Local-First
 * R6 — Documentation Archive Maturity.
 *
 * Mirrors the useProducts architecture: synchronous local-data read,
 * memoized filtering. No Zustand store — the document dataset is
 * read-only in Wave 9 and small enough to filter in-memory cheaply.
 *
 * Public contract:
 *   useDocuments(filters?)              → { documents, total }
 *   useDocument(id)                     → { document, error }
 *   useDocumentsByProduct(abbreviation) → Document[]
 *   useDocumentsByBatch(batchId, excludeId?) → Document[]
 *   useDocumentFilterOptions()          → { types, issuers }
 *   getDocumentStatus(doc)              → 'active' | 'expired'
 */

import { useMemo } from 'react';
import documentsData from '../data/documents.json';
import type { Document } from '../types';

const ALL: Document[] = documentsData.documents as unknown as Document[];

/**
 * True when any record in `list` is an illustrative placeholder rather than
 * an issued quality record. Surfaces use this to decide whether to render
 * the "sample archive — in preparation" seal. Single source of truth so the
 * gallery, the detail page and the product slots cannot drift apart.
 */
export function hasSamplePlaceholders(list: readonly Document[]): boolean {
  return list.some((d) => d.isSamplePlaceholder);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export type DocumentStatus = 'active' | 'expired';

export function getDocumentStatus(doc: Document): DocumentStatus {
  if (!doc.expiresAt) return 'active';
  return doc.expiresAt >= isoToday() ? 'active' : 'expired';
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface DocumentFilters {
  type?: string;
  issuer?: string;
  status?: 'all' | DocumentStatus;
}

// ─── useDocuments ─────────────────────────────────────────────────────────────

export function useDocuments(filters?: DocumentFilters) {
  const type   = filters?.type;
  const issuer = filters?.issuer;
  const status = filters?.status;

  const documents = useMemo(() => {
    let list = ALL;
    if (type && type !== 'all') {
      list = list.filter((d) => d.documentType === type);
    }
    if (issuer && issuer !== 'all') {
      list = list.filter((d) => d.issuer === issuer);
    }
    if (status && status !== 'all') {
      list = list.filter((d) => getDocumentStatus(d) === status);
    }
    return list;
  }, [type, issuer, status]);

  return { documents, total: ALL.length };
}

// ─── useDocument ──────────────────────────────────────────────────────────────

export function useDocument(id: string | undefined) {
  const document = useMemo(() => {
    if (!id) return null;
    return ALL.find((d) => d.id === id) ?? null;
  }, [id]);

  const error: string | null = !id
    ? 'Missing document id.'
    : document === null
      ? 'Document not found.'
      : null;

  return { document, error };
}

// ─── useDocumentsByProduct ────────────────────────────────────────────────────

export function useDocumentsByProduct(abbreviation: string | undefined) {
  return useMemo(() => {
    if (!abbreviation) return [];
    return ALL.filter((d) => d.productAbbreviation === abbreviation);
  }, [abbreviation]);
}

// ─── useDocumentsByBatch ──────────────────────────────────────────────────────

/** Returns sibling documents sharing the same batchId, excluding `excludeId`. */
export function useDocumentsByBatch(batchId: string | undefined, excludeId?: string) {
  return useMemo(() => {
    if (!batchId) return [];
    return ALL.filter((d) => d.batchId === batchId && d.id !== excludeId);
  }, [batchId, excludeId]);
}

// ─── useDocumentFilterOptions ─────────────────────────────────────────────────

export function useDocumentFilterOptions() {
  return useMemo(() => {
    const types = [...new Set(ALL.map((d) => d.documentType))].sort();
    const issuers = [
      ...new Set(ALL.map((d) => d.issuer).filter((i): i is string => Boolean(i))),
    ].sort();
    return { types, issuers };
  }, []);
}
