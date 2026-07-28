/**
 * AccountLibrary — /account/library
 *
 * The member's research documentation library: one specification card per
 * catalog record they have ordered, built from their own order lines
 * (`listMyOrderLines`, RLS-scoped) joined against the catalog
 * (`useProducts`) by `buildMemberLibrary` (`src/lib/memberLibrary.ts`).
 *
 * Honesty boundary: this platform holds no per-batch certificates, so this
 * surface presents none and implies none. Every value shown is the
 * specification as stated on the catalog record — purity spec, CAS,
 * molecular weight, classification — plus the doses the member ordered.
 * The dossier itself is not re-implemented here: each card links to the
 * compound's existing page, which mounts the shared
 * CompoundIntelligenceOverlay.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { listMyOrderLines, type MyOrderLineRow } from '../../lib/accountData';
import { buildMemberLibrary, type LibraryEntry } from '../../lib/memberLibrary';
import { useProducts } from '../../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../../lib/compoundIntelligence';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; lines: MyOrderLineRow[] }
  | { kind: 'error'; message: string };

function classificationLabel(entry: LibraryEntry): string {
  if (!entry.researchClassification) return entry.family;
  return CLASSIFICATION_LABELS[entry.researchClassification] ?? entry.family;
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[12px] tabular-nums text-ink/75">{value}</dd>
    </div>
  );
}

function DocumentationCard({ entry }: { entry: LibraryEntry }) {
  return (
    <li className="research-surface-solid p-[var(--space-4)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-1">
        <p className="min-w-0 text-[14px] text-ink">{entry.name}</p>
        <p className="font-mono text-[11px] text-ink/40">{entry.sku}</p>
      </div>
      <p className="mt-0.5 text-[11px] text-ink/50">{classificationLabel(entry)}</p>

      <dl className="mt-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
        {entry.purity && <SpecRow label={entry.purity.label} value={entry.purity.value} />}
        {entry.casNumber && <SpecRow label="CAS" value={entry.casNumber} />}
        {entry.molecularWeight && <SpecRow label="Molecular weight" value={entry.molecularWeight} />}
        {entry.doses.length > 0 && <SpecRow label="Doses ordered" value={entry.doses.join(' · ')} />}
      </dl>

      <div className="mt-[var(--space-3)] flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <p className="font-mono text-[11px] tabular-nums text-ink/35">
          {entry.orderCount === 1 ? 'On 1 order' : `On ${entry.orderCount} orders`}
        </p>
        <Link
          to={`/product/${entry.productId}`}
          className="text-[12px] text-ink/70 underline decoration-ink/20 underline-offset-2 transition-colors hover:text-ink"
        >
          Research overview →
        </Link>
      </div>
    </li>
  );
}

function AccountLibraryContent() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const { products } = useProducts();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await listMyOrderLines();
      if (cancelled) return;
      if (error) {
        setState({ kind: 'error', message: error });
        return;
      }
      setState({ kind: 'ok', lines: data });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your documentation…</p>;
  }
  if (state.kind === 'error') {
    return <ErrorState message={state.message} />;
  }

  const { compounds, supplies } = buildMemberLibrary(state.lines, products);

  if (compounds.length === 0 && supplies.length === 0) {
    return (
      <EmptyState
        label="No records on file yet."
        meta="Documentation appears here once an order includes a catalog record."
        action={
          <Button variant="secondary" size="md" to="/catalog">
            Browse catalog
          </Button>
        }
      />
    );
  }

  return (
    <>
      {compounds.length > 0 && (
        <ul className="space-y-[var(--space-3)]">
          {compounds.map((entry) => (
            <DocumentationCard key={entry.productId} entry={entry} />
          ))}
        </ul>
      )}

      {supplies.length > 0 && (
        <>
          <h2 className="mb-[var(--space-3)] mt-[var(--space-6)] text-[11px] uppercase tracking-[0.22em] text-ink/45">
            Equipment &amp; supplies
          </h2>
          <ul className="space-y-[var(--space-3)]">
            {supplies.map((entry) => (
              <DocumentationCard key={entry.productId} entry={entry} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function AccountLibrary() {
  return (
    <AccountLayout>
      <header className="mb-[var(--space-5)]">
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Research documentation</h2>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[12px] leading-relaxed">
          Specification documentation for every record on your orders, as stated
          on its catalog entry. Open a record for its full research overview.
        </p>
      </header>
      <AccountLibraryContent />
    </AccountLayout>
  );
}

export default AccountLibrary;
