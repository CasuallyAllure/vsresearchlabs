/**
 * ProductCard
 * Wave 2 — Module Containment
 * Wave 7c — AbbreviationChip + DoseTierStrip integration
 * Reconciliation Pass C — Inventory-register alignment.
 *
 * Bounded Level-1 solid-surface module. Reconciled into the same
 * procurement register as InventoryRow: operational metadata leads,
 * the image is supporting (not dominant), and motion is reduced to
 * a hairline tint shift on the title.
 *
 * Structure:
 *   <Link>                                       ← tap target wraps the whole card
 *     <div .research-surface-solid .group>       ← bounded surface + group host
 *       <div aspect-[4/3] ...image...>           ← supporting reference image (4:3, not 1:1)
 *       <div border-t .hairline px-4 py-3>       ← metadata section
 *         <p eyebrow>{family}</p>                ← operational vocabulary leads
 *         <AbbrevChip /> <h3>{name}</h3>         ← identifier + descriptive title
 *         <p>{sku} · {shortDescription}</p>      ← mirrors InventoryRow row-2 grammar
 *         <DoseTierStrip />                      ← only when variants exist
 *
 * Motion: title color shift only (`group-hover:text-gold transition-colors`).
 * No image scale, no card translate. Matches InventoryRow exactly.
 *
 * Field migration: now reads `product.shortDescription` (was
 * `product.description` in Wave 2). The Wave-2 field note is resolved.
 */

import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { AbbreviationChip } from './AbbreviationChip';
import { TierStrip } from './intelligence/TierStrip';

interface ProductCardProps {
  product: Product;
  /** When provided, card click opens the intelligence overlay instead of navigating. */
  onInspect?: (id: string) => void;
}

export function ProductCard({ product, onInspect }: ProductCardProps) {
  const imageUrl = product.images?.[0] ?? null;
  const activeDose = deriveProductDose(product);

  return (
    <Link
      to={`/product/${product.id}`}
      onClick={onInspect ? (e) => { e.preventDefault(); onInspect(product.id); } : undefined}
      className="block rounded-[4px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
    >
      <div className="research-surface-solid overflow-hidden group">
        {/* Image — supporting reference. 4:3 aspect (not square) so the
            metadata section below carries the visual weight. No hover
            scale: cards behave like InventoryRow, not like ecommerce. */}
        <div className="aspect-[4/3] w-full overflow-hidden bg-[#050505]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={product.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-white/20 text-xs uppercase tracking-widest">
              No image
            </div>
          )}
        </div>

        {/* Metadata section — operational vocabulary leads. Family is
            the eyebrow above the abbreviation + name row. SKU ·
            shortDescription mirrors InventoryRow's row-2 grammar.
            DoseTierStrip is silently absent for products without
            variants. */}
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/40">
            {product.family}
          </p>
          <div className="flex items-center gap-2 min-w-0">
            <AbbreviationChip value={product.abbreviation} />
            <h3 className="text-sm font-medium text-white truncate min-w-0 flex-1 group-hover:text-gold transition-colors">
              {product.name}
            </h3>
          </div>
          <p className="text-[11px] tracking-wide text-white/40 truncate">
            <span className="text-white/55 tabular-nums">{product.sku}</span>
            {product.shortDescription && (
              <>
                <span className="mx-1.5 text-white/25" aria-hidden="true">
                  ·
                </span>
                <span>{product.shortDescription}</span>
              </>
            )}
          </p>
          {product.variants && product.variants.length > 0 && (
            <TierStrip
              variants={product.variants}
              activeDose={activeDose}
              className="pt-0.5"
            />
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * ProductCardSkeleton
 *
 * Renders within identical bounds to `ProductCard` so the loading state
 * occupies the grid without layout shift. Markup mirrors the populated
 * card: surface wrapper → square image area → hairline → two title rules.
 */
export function ProductCardSkeleton() {
  return (
    <div
      className="research-surface-solid overflow-hidden"
      aria-hidden="true"
    >
      <div className="aspect-[4/3] w-full bg-[#050505] animate-pulse" />
      <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
        <div className="h-3 bg-white/[0.06] rounded animate-pulse w-1/3" />
        <div className="h-3 bg-white/[0.06] rounded animate-pulse w-3/4" />
        <div className="h-3 bg-white/[0.06] rounded animate-pulse w-1/2" />
      </div>
    </div>
  );
}
