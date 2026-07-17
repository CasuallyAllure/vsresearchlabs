/**
 * WholesaleTile
 *
 * Catalog tile for the biopeptide WHOLESALE view — the same floating-module
 * grammar as CompoundTile, selling PACKS of one compound + dose on the
 * 7–10 business-day tier:
 *
 *   • Full case — 10 vials, 40% off
 *   • Half kit  —  5 vials, 27% off
 *
 *   ┌────────────────────────────┐
 *   │ [Case of 10]               │  ← stamp, overlaid top-left
 *   │  ▮▮▮▮▮▮▮▮▮▮ (packed rack) │  ← vials edge-to-edge on ONE backdrop
 *   ├────────────────────────────┤
 *   │ FAMILY · ABBR  [WHOLESALE] │
 *   │ Compound name              │
 *   │ [ dose ][ dose ]           │  ← sourced doses only
 *   │ [ Full case | Half kit ]   │  ← pack picker
 *   │ ┌ 10 vials      $600.00 ┐  │
 *   │ │ Wholesale −40% −$240  │  │  ← price ledger + per-vial line
 *   │ └ Case price    $360.00 ┘  │
 *   │              [+ Add case]  │
 *   └────────────────────────────┘
 *
 * The rack is the product's vial render cropped edge-to-edge (no gaps, no
 * per-cell chrome) so ten crops of the same studio shot read as one packed
 * case, grounded by a shared inset shade + front lip. Pricing is display-only
 * here: the pack goes into the cart as qty {size} at the TRUE unit price and
 * place-order applies the percent server-side (synthetic WHOLESALE
 * order_coupons row), so the invoice itemizes the discount and the
 * price-mismatch audit stays clean. Same tap contract as CompoundTile: the
 * image/identity block inspects; dose/pack picks and Add act without opening.
 */

import { useState, useRef } from 'react';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { Link } from 'react-router-dom';
import { useProductOverrides } from '../../lib/productOverrides';
import { useCustomerAuth } from '../../lib/customerAuth';
import { ShippingVan, SourcedDoseSegment } from './DoseTierChips';
import { Tooltip } from '../ui/Tooltip';
import {
  WHOLESALE_PACKS,
  WHOLESALE_TOOLTIP,
  wholesaleDoses,
  wholesalePackPricing,
  formatPerVial,
} from '../../lib/wholesale';

const GOLD = 'var(--color-accent-gold-dark)';

/** One vial in the pack shot — center-x/top as % of the bay, width as % of
 *  the bay, plus depth treatment (blur/brightness) and stacking order. */
interface PackLayer {
  x: number;
  y: number;
  w: number;
  z: number;
  blur: number;
  bright: number;
}

// Staggered three-row formation — back row soft and high, front row sharp
// and low, like a shallow depth-of-field product shoot. Positions assume the
// source image is a square studio shot with the vial centered.
const CASE_FORMATION: PackLayer[] = [
  // back row — 4, receded
  { x: 14, y: -8, w: 56, z: 1, blur: 2.2, bright: 0.82 },
  { x: 38, y: -10, w: 56, z: 2, blur: 2.2, bright: 0.84 },
  { x: 62, y: -9, w: 56, z: 3, blur: 2.2, bright: 0.83 },
  { x: 86, y: -7, w: 56, z: 4, blur: 2.2, bright: 0.82 },
  // middle row — 3
  { x: 26, y: 6, w: 66, z: 5, blur: 1.0, bright: 0.92 },
  { x: 50, y: 4, w: 66, z: 6, blur: 1.0, bright: 0.93 },
  { x: 74, y: 7, w: 66, z: 7, blur: 1.0, bright: 0.92 },
  // front row — 3, sharp
  { x: 18, y: 22, w: 76, z: 8, blur: 0, bright: 1 },
  { x: 82, y: 23, w: 76, z: 9, blur: 0, bright: 1 },
  { x: 50, y: 26, w: 78, z: 10, blur: 0, bright: 1 },
];

const HALF_FORMATION: PackLayer[] = [
  // back row — 2
  { x: 30, y: -4, w: 62, z: 1, blur: 1.8, bright: 0.85 },
  { x: 70, y: -5, w: 62, z: 2, blur: 1.8, bright: 0.86 },
  // front row — 3
  { x: 16, y: 16, w: 74, z: 3, blur: 0, bright: 1 },
  { x: 84, y: 17, w: 74, z: 4, blur: 0, bright: 1 },
  { x: 50, y: 20, w: 76, z: 5, blur: 0, bright: 1 },
];

// Soft ellipse mask around the centered vial so each layered copy blends
// into the shot instead of showing its own rectangular backdrop.
const VIAL_MASK =
  'radial-gradient(ellipse 34% 58% at 50% 50%, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 82%)';

/** The pack shot: blurred full-bleed backdrop + soft-masked vial copies in a
 *  staggered depth formation. Pure CSS over the existing studio render. */
function PackShot({ imageUrl, layers }: { imageUrl: string; layers: PackLayer[] }) {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {/* environment: the shot itself, blown up + defocused → seamless set */}
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: 'scale(1.7)', filter: 'blur(14px) brightness(0.9)' }}
        loading="lazy"
      />
      {layers.map((l, i) => (
        <img
          key={i}
          src={imageUrl}
          alt=""
          loading="lazy"
          className="absolute"
          style={{
            left: `${l.x}%`,
            top: `${l.y}%`,
            width: `${l.w}%`,
            transform: 'translateX(-50%)',
            zIndex: l.z,
            filter: `blur(${l.blur}px) brightness(${l.bright})`,
            WebkitMaskImage: VIAL_MASK,
            maskImage: VIAL_MASK,
          }}
        />
      ))}
    </div>
  );
}

interface WholesaleTileProps {
  product: Product;
  /** Tap the image/identity block to open the intelligence overlay. */
  onInspect?: (id: string) => void;
  /** Detail view — full description instead of the two-line clamp. */
  detailed?: boolean;
}

export function WholesaleTile({ product, onInspect, detailed }: WholesaleTileProps) {
  const imageUrl = product.images?.[0] ?? null;

  // Subscribe so admin price/stock changes propagate live (same as CompoundTile).
  useProductOverrides((s) => s.bySku[product.sku] ?? null);
  useProductOverrides((s) => s.variantBySku);

  // Wholesale is account-gated for BUYING: anyone can view case pricing, but
  // adding a case requires a signed-in profile (server enforces at checkout).
  const { user } = useCustomerAuth();
  const isMember = !!user;

  const doses = wholesaleDoses(product);
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const tierIndex = manualIndex !== null && manualIndex < doses.length ? manualIndex : 0;
  const activeDose = doses[tierIndex] ?? deriveProductDose(product);

  const [packIndex, setPackIndex] = useState(0); // default: full case
  const pack = WHOLESALE_PACKS[packIndex];
  const pricing = wholesalePackPricing(product, activeDose, pack);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const setItemNote = useCart((s) => s.setItemNote);
  const [added, setAdded] = useState(false);
  const flashTimer = useRef<number | null>(null);

  function handleAddPack(e: React.MouseEvent) {
    e.stopPropagation();
    if (!pricing) return;
    const line = variantProduct(product, activeDose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) {
      updateQuantity(line.id, existing.quantity + pack.size);
    } else {
      add(line);
      updateQuantity(line.id, pack.size);
    }
    setItemNote(
      line.id,
      `Wholesale ${pack.label.toLowerCase()} ×${pack.size} — ${pack.percent}% off applied at checkout`,
    );
    setAdded(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  // No pack-sellable priced dose → nothing honest to sell; the page filter
  // should have excluded this product, but never render a $0 pack.
  if (doses.length === 0 || !pricing) return null;

  const isCase = pack.size === 10;

  return (
    <article className="floating-module is-interactive overflow-hidden flex flex-col group">
      {/* Tappable head: packed rack + identity → inspect overlay */}
      <button
        type="button"
        onClick={() => onInspect?.(product.id)}
        className="text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 flex flex-col"
        aria-label={`Inspect ${product.name}`}
      >
        <div className="p-1.5">
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-procurement)] bg-display">
            {imageUrl ? (
              /* Depth-stacked pack shot filling the entire bay: back rows
                 receded and defocused, front row sharp — the studio render
                 recomposed as one styled group shot. */
              <PackShot imageUrl={imageUrl} layers={isCase ? CASE_FORMATION : HALF_FORMATION} />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-ink/20 text-[10px] uppercase tracking-[0.2em]">
                No image
              </div>
            )}
            {/* Grounding — one shared vignette + a front lip so the group
                sits together in the frame. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20"
              style={{ boxShadow: 'inset 0 0 34px rgba(15,14,12,0.26), inset 0 1px 0 rgba(255,255,255,0.10)' }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[16%]"
              style={{ background: 'linear-gradient(to top, rgba(15,14,12,0.30), transparent)' }}
            />
            <span
              className="absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
              style={{
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.28)',
                backgroundColor: 'rgba(20,20,20,0.55)',
                backdropFilter: 'blur(2px)',
              }}
              title={`${pack.size} vials of the same compound and dose, packed as one ${pack.noun}`}
            >
              {isCase ? `Case of ${pack.size}` : `Half kit · ${pack.size} vials`}
            </span>
          </div>
        </div>

        {/* Identity */}
        <div className="px-3.5 pt-1 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 truncate">
              {product.abbreviation} · {product.family.split(' ')[0]}
            </p>
            <span
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] px-1.5 py-[1px] rounded-full border"
              style={{
                color: GOLD,
                borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark), transparent 55%)',
                backgroundColor: 'color-mix(in srgb, var(--color-accent-gold-dark), transparent 90%)',
              }}
            >
              Wholesale
            </span>
          </div>
          <h3 className="text-[14px] font-normal text-ink leading-snug truncate">{product.name}</h3>
          {product.shortDescription && (
            <p
              className={`mt-1 text-[12px] leading-relaxed text-ink/55 ${
                detailed ? '' : 'line-clamp-2'
              }`}
            >
              {product.shortDescription}
            </p>
          )}
        </div>
      </button>

      {/* Buy controls — outside the tap target */}
      <div className="px-3.5 pb-3.5 pt-1.5 border-t border-ink/[0.05] mt-auto">
        {/* Dose picker — ONE unified group for every wholesale-eligible dose,
            including retail 24-hour in-stock doses. Wholesale sources the whole
            case, so ALL pack orders ship 7–10 business days regardless of a
            dose's retail stock status; the picker must NOT split by ship speed
            or badge any dose "24 HR". Every dose is just another segment under
            the single 7–10-day footer. */}
        <div
          className="rounded-[var(--radius-field)] border border-ink/15 overflow-hidden mb-1.5"
          onClick={doses.length > 1 ? (e) => e.stopPropagation() : undefined}
        >
          <div
            role={doses.length > 1 ? 'radiogroup' : undefined}
            aria-label={doses.length > 1 ? 'Select pack dose' : undefined}
            className="flex items-stretch"
          >
            {doses.map((dose, i) => (
              <SourcedDoseSegment
                key={dose}
                dose={dose}
                isActive={i === tierIndex}
                interactive={doses.length > 1}
                hasDivider={i > 0}
                onClick={
                  doses.length > 1
                    ? (e) => {
                        e.stopPropagation();
                        setManualIndex(i);
                      }
                    : undefined
                }
              />
            ))}
          </div>
          <div className="border-t border-ink/12 py-1 text-center">
            <Tooltip content={WHOLESALE_TOOLTIP} ariaId={`wholesale-${product.sku}`}>
              <span className="inline-flex cursor-help items-center justify-center gap-1 font-mono text-[10px] uppercase leading-none tracking-[0.16em] text-ink/45 underline decoration-dotted decoration-ink/30 underline-offset-2">
                Standard Shipping
                <ShippingVan />
              </span>
            </Tooltip>
          </div>
        </div>

        {/* Pack picker — full case vs half kit. */}
        <div
          role="radiogroup"
          aria-label="Select pack size"
          className="mb-2 flex items-stretch rounded-[var(--radius-field)] border border-ink/15 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {WHOLESALE_PACKS.map((p, i) => {
            const on = i === packIndex;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={(e) => {
                  e.stopPropagation();
                  setPackIndex(i);
                }}
                className={[
                  'flex-1 min-h-[40px] px-1 py-1.5 text-center leading-tight transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                  i > 0 ? 'border-l border-ink/12' : '',
                  on ? 'bg-ink/[0.08]' : 'hover:bg-ink/[0.03]',
                ].join(' ')}
              >
                <span className={`block text-[11px] font-medium ${on ? 'text-ink' : 'text-ink/55'}`}>
                  {p.label}
                </span>
                <span className={`block font-mono text-[10px] uppercase tracking-[0.08em] ${on ? 'text-ink/60' : 'text-ink/35'}`}>
                  {p.size} vials · −{p.percent}%
                </span>
              </button>
            );
          })}
        </div>

        {/* Price ledger — regular pack value, the wholesale cut, what's billed. */}
        <dl className="rounded-[var(--radius-field)] border border-ink/[0.08] bg-ink/[0.03] px-2.5 py-2 mb-2">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-ink/50">
              {pack.size} vials · {activeDose}
            </dt>
            <dd className="font-mono tabular-nums text-[11.5px] text-ink/45 line-through decoration-ink/30">
              {formatPerVial(pricing.regularCents)}
            </dd>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <dt className="text-[11px]" style={{ color: GOLD }}>
              Wholesale −{pack.percent}%
            </dt>
            <dd className="font-mono tabular-nums text-[11.5px]" style={{ color: GOLD }}>
              −{formatPerVial(pricing.discountCents)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-ink/[0.07] pt-1">
            <dt className="text-[11px] font-medium text-ink/75">
              {isCase ? 'Case price' : 'Kit price'}
            </dt>
            <dd className="font-mono tabular-nums text-[14px] text-ink">
              {formatPerVial(pricing.packCents)}
            </dd>
          </div>
          {/* The number a wholesale buyer actually compares — what each vial
              comes to at pack pricing, next to the single-vial price. */}
          <div className="mt-0.5 flex items-baseline justify-end gap-1">
            <span className="font-mono tabular-nums text-[10.5px] text-ink/45">
              {formatPerVial(pricing.unitCents)}
            </span>
            <span aria-hidden="true" className="text-[10.5px] text-ink/35">→</span>
            <span className="font-mono tabular-nums text-[10.5px] text-ink/60">
              {formatPerVial(pricing.perVialCents)} per vial
            </span>
          </div>
        </dl>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] leading-snug text-ink/40">
            {isMember
              ? 'Discount applies automatically at checkout.'
              : 'Sign in to add cases at wholesale pricing.'}
          </span>
          {isMember ? (
            <button
              type="button"
              onClick={handleAddPack}
              aria-label={`Add a wholesale ${pack.label.toLowerCase()} of ${pack.size} × ${product.name} ${activeDose} to inquiry`}
              className={[
                'tile-add-btn shrink-0 min-h-[40px] inline-flex items-center justify-center gap-1 rounded-full px-3 text-[10px] uppercase tracking-[0.14em] font-normal leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                added ? 'is-added' : '',
              ].join(' ')}
            >
              {added ? '✓' : `+ Add ${pack.noun}`}
            </button>
          ) : (
            <Link
              to="/account"
              onClick={(e) => e.stopPropagation()}
              aria-label="Sign in to buy at wholesale pricing"
              className="tile-add-btn shrink-0 min-h-[40px] inline-flex items-center justify-center gap-1 rounded-full px-3 text-[10px] uppercase tracking-[0.14em] font-normal leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
