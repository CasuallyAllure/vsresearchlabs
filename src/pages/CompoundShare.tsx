/**
 * CompoundShare — the `/c/:slug` route behind shareable compound links.
 *
 * A cold visit to /c/<slug> renders the catalog as the page underneath and
 * opens that compound's record over it, so the link lands somewhere real
 * rather than on a bare modal.
 *
 * ORDERING (compliance): the 21+/research-use DisclaimerGate is mounted at
 * the app root and shows itself on first visit regardless of route. This
 * page does NOT bypass or reorder it — it simply holds the compound record
 * back until the gate reports acceptance, so a first-time visitor arriving
 * on a shared link sees gate → then compound, never compound-behind-glass.
 * Returning visitors (acceptance already stored) get the record immediately.
 *
 * An unknown slug is not an error state: we quietly land the visitor on the
 * catalog they were probably being pointed at.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Catalog } from './Catalog';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { useProducts } from '../hooks/useProducts';
import { useProductOverrides, isSkuVisible } from '../lib/productOverrides';
import { resolveCompoundSlug } from '../lib/compoundShare';
import { readDisclaimerAcceptance } from '../lib/researchAttestation';

/**
 * True once the research-use gate has been cleared — either previously
 * (stored acceptance) or just now (the gate fires `vsr:disclaimer-accepted`
 * on accept, the same signal the landing entrance sequence waits on).
 */
function useDisclaimerCleared(): boolean {
  const [cleared, setCleared] = useState(() => readDisclaimerAcceptance() !== null);
  useEffect(() => {
    if (cleared) return;
    function onAccepted() { setCleared(true); }
    window.addEventListener('vsr:disclaimer-accepted', onAccepted, { once: true });
    return () => window.removeEventListener('vsr:disclaimer-accepted', onAccepted);
  }, [cleared]);
  return cleared;
}

export function CompoundShare() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { products } = useProducts();
  // Subscribe so this recomputes once the override fetch resolves — same
  // guard /product/:id uses. A stale link to a pulled SKU must fall back
  // rather than resurrect a compound the catalog no longer lists.
  useProductOverrides((s) => s.bySku);
  const resolved = resolveCompoundSlug(products, slug);
  const product = resolved && isSkuVisible(resolved.sku) ? resolved : null;
  const gateCleared = useDisclaimerCleared();

  const unknownSlug = product === null;
  useEffect(() => {
    if (unknownSlug) navigate('/catalog', { replace: true });
  }, [unknownSlug, navigate]);

  return (
    <>
      <Catalog />
      {product && gateCleared && (
        <CompoundIntelligenceOverlay
          product={product}
          // Closing a deep-linked record leaves the visitor on the catalog
          // that was already rendered behind it. `replace` so back returns
          // to wherever they came from, not to the record they just closed.
          onClose={() => navigate('/catalog', { replace: true })}
        />
      )}
    </>
  );
}
