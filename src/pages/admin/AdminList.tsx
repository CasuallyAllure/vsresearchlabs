/**
 * AdminList
 * Phase 4 — Admin Scaffold (local-first CRUD).
 *
 * Lists every product in the local store with row-level Edit / Delete
 * actions, plus catalog-level Import / Export / Reset to Seed. No auth,
 * no backend. Mutations route through useProductAdmin (the only sanctioned
 * seam to the productStore).
 *
 * Phase 2 invariants preserved: no glass surfaces, hairlines only.
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProducts, useProductAdmin } from '../../hooks/useProducts';
import type { Product } from '../../types/product';

type ImportMessage =
  | { kind: 'idle' }
  | { kind: 'success'; count: number }
  | { kind: 'error'; message: string };

/** Lightweight runtime guard. We don't need full schema validation here —
 *  just enough to refuse obviously bad payloads. */
function isProductLike(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.category === 'string' &&
    typeof v.sku === 'string'
  );
}

export function AdminList() {
  const { products } = useProducts();
  const { remove, setAll, resetToSeed } = useProductAdmin();

  const [importMsg, setImportMsg] = useState<ImportMessage>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleDelete(product: Product) {
    const ok = window.confirm(
      `Delete "${product.name}"? This cannot be undone.`
    );
    if (!ok) return;
    remove(product.id);
  }

  function handleExport() {
    const json = JSON.stringify(products, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vsresearchlabs-products-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input so the same file can be re-selected.
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () =>
      setImportMsg({ kind: 'error', message: 'Failed to read file.' });
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        if (!Array.isArray(parsed)) {
          setImportMsg({
            kind: 'error',
            message: 'Import must be a JSON array of products.',
          });
          return;
        }
        const valid = parsed.every(isProductLike);
        if (!valid) {
          setImportMsg({
            kind: 'error',
            message:
              'One or more entries are missing required fields (id, name, category, sku).',
          });
          return;
        }
        const ok = window.confirm(
          `Import ${parsed.length} product(s)? This replaces the current catalog.`
        );
        if (!ok) {
          setImportMsg({ kind: 'idle' });
          return;
        }
        setAll(parsed as Product[]);
        setImportMsg({ kind: 'success', count: parsed.length });
      } catch (err) {
        setImportMsg({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Invalid JSON.',
        });
      }
    };
    reader.readAsText(file);
  }

  function handleReset() {
    const ok = window.confirm(
      'This will discard all admin changes and reload the shipped seed. Continue?'
    );
    if (!ok) return;
    resetToSeed();
    setImportMsg({ kind: 'idle' });
  }

  return (
    <section className="py-[var(--space-8)]">
      {/* Header */}
      <header className="mb-[var(--space-8)] flex flex-col sm:flex-row sm:items-end sm:justify-between gap-[var(--space-4)]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
            Admin
          </p>
          <h1 className="text-3xl sm:text-4xl font-light text-ink tracking-tight">
            Products
          </h1>
          <p className="mt-[var(--space-2)] text-xs text-ink/45">
            {products.length} product{products.length === 1 ? '' : 's'} in
            local catalog.
          </p>
        </div>
        <Link
          to="/admin/new"
          className="inline-block px-[var(--space-6)] py-[var(--space-3)] rounded-full bg-gold text-ink text-xs uppercase tracking-[0.25em] font-medium hover:bg-gold-light transition-colors"
        >
          + New Product
        </Link>
      </header>

      {/* Catalog actions */}
      <div className="mb-[var(--space-10)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.25em] text-ink/40 mb-[var(--space-4)]">
          Catalog Actions
        </p>
        <div className="flex flex-wrap gap-[var(--space-3)]">
          <button
            type="button"
            onClick={handleImportClick}
            className="px-[var(--space-5)] py-[var(--space-2-5)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors"
          >
            Import JSON
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-[var(--space-5)] py-[var(--space-2-5)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-[var(--space-5)] py-[var(--space-2-5)] rounded-full border border-red-500/30 text-xs uppercase tracking-[0.25em] text-red-400/80 hover:text-red-300 hover:border-red-500/50 transition-colors"
          >
            Reset to Seed
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
            aria-hidden="true"
          />
        </div>

        {importMsg.kind === 'error' && (
          <p
            role="alert"
            className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.2em] text-red-400"
          >
            {importMsg.message}
          </p>
        )}
        {importMsg.kind === 'success' && (
          <p className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.2em] text-gold">
            Imported {importMsg.count} product
            {importMsg.count === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      {/* Table */}
      {products.length === 0 ? (
        <div className="py-[var(--space-12)] text-center">
          <p className="text-sm text-ink/55 mb-[var(--space-4)]">
            No products in the catalog.
          </p>
          <Link
            to="/admin/new"
            className="text-xs uppercase tracking-[0.25em] text-gold hover:text-gold-light transition-colors"
          >
            Create the first product →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink/[0.1]">
                <th className="py-[var(--space-3)] pr-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  Name
                </th>
                <th className="py-[var(--space-3)] pr-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  SKU
                </th>
                <th className="py-[var(--space-3)] pr-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  Category
                </th>
                <th className="py-[var(--space-3)] pr-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  Featured
                </th>
                <th className="py-[var(--space-3)] pr-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  Stock
                </th>
                <th className="py-[var(--space-3)] text-right text-[11px] uppercase tracking-[0.25em] text-ink/40 font-normal">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-ink/[0.06] align-middle"
                >
                  <td className="py-[var(--space-4)] pr-[var(--space-4)]">
                    <Link
                      to={`/product/${product.id}`}
                      className="text-sm text-ink hover:text-gold transition-colors"
                    >
                      {product.name}
                    </Link>
                  </td>
                  <td className="py-[var(--space-4)] pr-[var(--space-4)] text-xs font-mono text-ink/55">
                    {product.sku}
                  </td>
                  <td className="py-[var(--space-4)] pr-[var(--space-4)] text-xs text-ink/55">
                    {product.category.replace(/-/g, ' ')}
                  </td>
                  <td className="py-[var(--space-4)] pr-[var(--space-4)] text-xs text-ink/55">
                    {product.featured ? '✓' : '—'}
                  </td>
                  <td className="py-[var(--space-4)] pr-[var(--space-4)] text-xs text-ink/55 tabular-nums">
                    {product.stock === null ? '—' : product.stock}
                  </td>
                  <td className="py-[var(--space-4)] text-right whitespace-nowrap">
                    <Link
                      to={`/admin/${product.id}/edit`}
                      className="text-[11px] uppercase tracking-[0.25em] text-ink/70 hover:text-ink transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(product)}
                      className="ml-[var(--space-4)] text-[11px] uppercase tracking-[0.25em] text-red-400/70 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
