/**
 * AdminEdit
 * Phase 4 — Admin Scaffold (local-first CRUD).
 *
 * Single component handles both create (`/admin/new`) and edit
 * (`/admin/:id/edit`) modes via the presence of a route :id param.
 *
 * Mutations route through useProductAdmin only — never directly through
 * the productStore.
 *
 * Mutations route through useProductAdmin only — canonical fields only.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProduct, useProductAdmin } from '../../hooks/useProducts';
import type { Product, ProductCategory, ProductSpec } from '../../types/product';

const CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: 'research-supplies', label: 'Research Supplies' },
  { value: 'laboratory-equipment', label: 'Laboratory Equipment' },
];

interface FormState {
  sku: string;
  name: string;
  slug: string;
  category: ProductCategory;
  shortDescription: string;
  longDescription: string;
  imagesText: string;
  specsText: string;
  tagsText: string;
  priceCentsText: string;
  stockText: string;
  featured: boolean;
}

interface FieldErrors {
  sku?: string;
  name?: string;
  slug?: string;
  shortDescription?: string;
  longDescription?: string;
  priceCentsText?: string;
  stockText?: string;
}

const EMPTY_FORM: FormState = {
  sku: '',
  name: '',
  slug: '',
  category: 'research-supplies',
  shortDescription: '',
  longDescription: '',
  imagesText: '',
  specsText: '',
  tagsText: '',
  priceCentsText: '',
  stockText: '',
  featured: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseImages(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseSpecs(text: string): ProductSpec[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { label: line, value: '' };
      return {
        label: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      };
    });
}

function specsToText(specs: ProductSpec[]): string {
  return specs.map((s) => `${s.label}: ${s.value}`).join('\n');
}

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function productToForm(p: Product): FormState {
  return {
    sku: p.sku,
    name: p.name,
    slug: p.slug,
    category: p.category,
    shortDescription: p.shortDescription,
    longDescription: p.longDescription,
    imagesText: (p.images ?? []).join('\n'),
    specsText: specsToText(p.specs ?? []),
    tagsText: (p.tags ?? []).join(', '),
    priceCentsText: p.priceCents === null ? '' : String(p.priceCents),
    stockText: p.stock === null ? '' : String(p.stock),
    featured: p.featured,
  };
}

/**
 * Derive a procurement-style abbreviation from a SKU string.
 * Convention: VSR-{CAT}-{ABBREV}-{NNN} → ABBREV.
 * Falls back to the first three uppercase chars of the SKU if the
 * convention isn't followed.
 */
function deriveAbbreviation(sku: string): string {
  const parts = sku.split('-').filter((p) => p.length > 0);
  if (parts.length >= 3) return parts[2].toUpperCase();
  return sku.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'NEW';
}

/**
 * Default family label used when admin creates a new product without
 * an explicit family. Seed-curated products carry richer values
 * ("GLP-1 Agonist", "Solvent", etc.); this is only a placeholder.
 */
function deriveFamilyDefault(category: ProductCategory): string {
  return category === 'research-supplies' ? 'Research Supply' : 'Laboratory Equipment';
}

function generateId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // Fallback (very unlikely path in modern browsers).
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = typeof id === 'string' && id.length > 0;

  const { product, error: loadError } = useProduct(isEdit ? id : undefined);
  const { add, update, remove } = useProductAdmin();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydrate the form when entering edit mode and product loads.
  useEffect(() => {
    if (isEdit && product) {
      setForm(productToForm(product));
    }
  }, [isEdit, product]);

  // Synthetic id for the create flow. Stable across renders.
  const newId = useMemo(generateId, []);
  const productId = isEdit && product ? product.id : newId;

  // Auto-suggest slug on name blur if slug is empty.
  function handleNameBlur() {
    if (form.slug.trim().length === 0 && form.name.trim().length > 0) {
      setForm((f) => ({ ...f, slug: slugify(f.name) }));
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (form.sku.trim().length === 0) next.sku = 'SKU is required.';
    if (form.name.trim().length === 0) next.name = 'Name is required.';
    if (form.slug.trim().length === 0) next.slug = 'Slug is required.';
    if (form.shortDescription.trim().length === 0)
      next.shortDescription = 'Short description is required.';
    if (form.longDescription.trim().length === 0)
      next.longDescription = 'Long description is required.';

    if (form.priceCentsText.trim().length > 0) {
      const n = Number(form.priceCentsText);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        next.priceCentsText = 'Price must be a non-negative integer (cents).';
    }
    if (form.stockText.trim().length > 0) {
      const n = Number(form.stockText);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        next.stockText = 'Stock must be a non-negative integer.';
    }
    return next;
  }

  function buildProduct(): Product {
    const now = new Date().toISOString();
    const priceCents =
      form.priceCentsText.trim().length === 0
        ? null
        : Number(form.priceCentsText);
    const stock =
      form.stockText.trim().length === 0 ? null : Number(form.stockText);

    const createdAt = isEdit && product ? product.createdAt : now;

    const trimmedSku = form.sku.trim();

    // Wave 7c — abbreviation/family/variants are required schema fields
    // but the admin form does not yet expose them as inputs. Preserve any
    // values already present on the edited product; otherwise derive
    // sensible defaults so newly-created products are well-formed.
    //
    //   abbreviation → third segment of the SKU (existing convention,
    //                  e.g. VSR-RS-SEM-005 → "SEM"); falls back to the
    //                  first three uppercase chars of the SKU.
    //   family       → category-derived placeholder. Editorial substance
    //                  classes ("GLP-1 Agonist", "Solvent", etc.) come
    //                  from the seed JSON or admin export/import.
    //   variants     → empty array. Variants are dataset-curated; admin
    //                  expansion is deferred to a later wave.
    const abbreviation =
      (isEdit && product?.abbreviation) || deriveAbbreviation(trimmedSku);
    const family =
      (isEdit && product?.family) || deriveFamilyDefault(form.category);
    const variants = (isEdit && product?.variants) || [];

    const canonical = {
      id: productId,
      slug: form.slug.trim(),
      name: form.name.trim(),
      category: form.category,
      shortDescription: form.shortDescription.trim(),
      longDescription: form.longDescription.trim(),
      images: parseImages(form.imagesText),
      specs: parseSpecs(form.specsText),
      sku: trimmedSku,
      abbreviation,
      family,
      variants,
      priceCents,
      stock,
      tags: parseTags(form.tagsText),
      featured: form.featured,
      createdAt,
      updatedAt: now,
    };

    return canonical;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    try {
      const next = buildProduct();
      if (isEdit) {
        update(next.id, next);
      } else {
        add(next);
      }
      navigate('/admin');
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to save product.'
      );
    }
  }

  function handleDelete() {
    if (!isEdit || !product) return;
    const ok = window.confirm(
      `Delete "${product.name}"? This cannot be undone.`
    );
    if (!ok) return;
    remove(product.id);
    navigate('/admin');
  }

  // -------------------------------------------------------------------------
  // Edit mode: still loading / not found
  // -------------------------------------------------------------------------
  if (isEdit && !product) {
    return (
      <section className="py-[var(--space-12)] text-center">
        <p className="text-sm text-red-400 mb-[var(--space-4)]">
          {loadError ?? 'Product not found.'}
        </p>
        <Link
          to="/admin"
          className="text-xs uppercase tracking-[0.25em] text-white/60 hover:text-white"
        >
          ← Back to Admin
        </Link>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <section className="py-[var(--space-8)]">
      {/* Breadcrumb */}
      <nav className="mb-[var(--space-6)] text-xs uppercase tracking-widest text-white/40">
        <Link to="/admin" className="hover:text-white/70">
          Admin
        </Link>
        <span className="mx-[var(--space-2)] text-white/20">/</span>
        <span className="text-white/60">
          {isEdit ? 'Edit Product' : 'New Product'}
        </span>
      </nav>

      <header className="mb-[var(--space-10)]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
          {isEdit ? 'Edit Product' : 'New Product'}
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          {isEdit ? form.name || 'Untitled' : 'Create a new product'}
        </h1>
        <p className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.25em] text-white/35">
          ID — {productId}
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="max-w-[60ch]">
        {/* Identity */}
        <FieldGroup label="Identity">
          <Field
            id="f-sku"
            label="SKU"
            required
            error={errors.sku}
          >
            <input
              id="f-sku"
              type="text"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              className={inputClass(!!errors.sku)}
              placeholder="VSR-RS-EXAMPLE-001"
            />
          </Field>

          <Field id="f-name" label="Name" required error={errors.name}>
            <input
              id="f-name"
              type="text"
              value={form.name}
              onBlur={handleNameBlur}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass(!!errors.name)}
              placeholder="Display name"
            />
          </Field>

          <Field
            id="f-slug"
            label="Slug"
            required
            error={errors.slug}
            hint="Auto-generated from Name on blur if blank."
          >
            <input
              id="f-slug"
              type="text"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value)}
              className={inputClass(!!errors.slug)}
              placeholder="kebab-case-slug"
            />
          </Field>

          <Field id="f-category" label="Category" required>
            <select
              id="f-category"
              value={form.category}
              onChange={(e) =>
                set('category', e.target.value as ProductCategory)
              }
              className={inputClass(false)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} className="bg-black">
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>

        {/* Copy */}
        <FieldGroup label="Copy">
          <Field
            id="f-short"
            label="Short description"
            required
            error={errors.shortDescription}
          >
            <textarea
              id="f-short"
              rows={2}
              value={form.shortDescription}
              onChange={(e) => set('shortDescription', e.target.value)}
              className={inputClass(!!errors.shortDescription)}
              placeholder="One- or two-line subtitle for cards."
            />
          </Field>

          <Field
            id="f-long"
            label="Long description"
            required
            error={errors.longDescription}
          >
            <textarea
              id="f-long"
              rows={6}
              value={form.longDescription}
              onChange={(e) => set('longDescription', e.target.value)}
              className={inputClass(!!errors.longDescription)}
              placeholder="Detail page body. Plain text. Newlines preserved."
            />
          </Field>
        </FieldGroup>

        {/* Media + meta */}
        <FieldGroup label="Media & Meta">
          <Field
            id="f-images"
            label="Images"
            hint="One URL per line. The first URL is the hero image."
          >
            <textarea
              id="f-images"
              rows={4}
              value={form.imagesText}
              onChange={(e) => set('imagesText', e.target.value)}
              className={inputClass(false)}
              placeholder="https://…/hero.png&#10;https://…/detail.png"
            />
          </Field>

          <Field
            id="f-specs"
            label="Specs"
            hint="One per line, formatted as `Label: Value`."
          >
            <textarea
              id="f-specs"
              rows={4}
              value={form.specsText}
              onChange={(e) => set('specsText', e.target.value)}
              className={inputClass(false)}
              placeholder="Purity (HPLC): ≥ 99%&#10;Form: Lyophilized powder"
            />
          </Field>

          <Field
            id="f-tags"
            label="Tags"
            hint="Comma-separated."
          >
            <input
              id="f-tags"
              type="text"
              value={form.tagsText}
              onChange={(e) => set('tagsText', e.target.value)}
              className={inputClass(false)}
              placeholder="peptide, glp-1, research"
            />
          </Field>
        </FieldGroup>

        {/* Commerce */}
        <FieldGroup label="Commerce">
          <Field
            id="f-price"
            label="Price (cents)"
            error={errors.priceCentsText}
            hint="Leave empty for Inquire-only pricing."
          >
            <input
              id="f-price"
              type="number"
              min={0}
              step={1}
              value={form.priceCentsText}
              onChange={(e) => set('priceCentsText', e.target.value)}
              className={inputClass(!!errors.priceCentsText)}
              placeholder="e.g. 19900 = $199.00"
            />
          </Field>

          <Field
            id="f-stock"
            label="Stock"
            error={errors.stockText}
            hint="Leave empty for untracked. 0 = out of stock."
          >
            <input
              id="f-stock"
              type="number"
              min={0}
              step={1}
              value={form.stockText}
              onChange={(e) => set('stockText', e.target.value)}
              className={inputClass(!!errors.stockText)}
              placeholder="e.g. 10"
            />
          </Field>

          <div className="flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
            <input
              id="f-featured"
              type="checkbox"
              checked={form.featured}
              onChange={(e) => set('featured', e.target.checked)}
              className="w-4 h-4 accent-gold"
            />
            <label
              htmlFor="f-featured"
              className="text-sm text-white/80 select-none"
            >
              Featured on landing strip
            </label>
          </div>
        </FieldGroup>

        {/* Submit / actions */}
        {submitError && (
          <p
            role="alert"
            className="mt-[var(--space-4)] text-xs text-red-400"
          >
            {submitError}
          </p>
        )}

        <div className="mt-[var(--space-10)] flex flex-wrap items-center gap-[var(--space-3)]">
          <button
            type="submit"
            className="px-[var(--space-8)] py-[var(--space-3)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium hover:bg-gold-light transition-colors"
          >
            {isEdit ? 'Save Changes' : 'Create Product'}
          </button>
          <Link
            to="/admin"
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-white/15 text-xs uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors"
          >
            Cancel
          </Link>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              className="ml-auto px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-red-500/30 text-xs uppercase tracking-[0.25em] text-red-400/80 hover:text-red-300 hover:border-red-500/50 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Field primitives — local only. No new shared components introduced.
// ---------------------------------------------------------------------------

function inputClass(invalid: boolean): string {
  const base =
    'w-full px-[var(--space-4)] py-[var(--space-3)] bg-black/40 border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none transition-colors resize-y';
  return invalid
    ? `${base} border-red-500/60 focus:border-red-400`
    : `${base} border-white/10 focus:border-gold/50`;
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-[var(--space-10)] pb-[var(--space-6)] border-b border-white/[0.06] last:border-b-0">
      <p className="text-[11px] uppercase tracking-[0.3em] text-white/45 mb-[var(--space-5)]">
        {label}
      </p>
      <div className="space-y-[var(--space-5)]">{children}</div>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs uppercase tracking-widest text-white/55 mb-[var(--space-2)]"
      >
        {label} {required && <span className="text-gold">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-[var(--space-2)] text-[11px] text-white/35">
          {hint}
        </p>
      )}
      {error && (
        <p className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
