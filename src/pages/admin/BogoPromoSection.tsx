/**
 * BogoPromoSection — LAUNCH DAY BOGO governance, rendered inside PromoTab
 * beneath the B2G1 controls. Same shape as that section (on/off, end date,
 * exclusions) with three deliberate differences:
 *
 *   1. THE KILL SWITCH WRITES IMMEDIATELY. B2G1's toggle is a draft edit that
 *      needs a second trip to Save. On launch day the owner needs BOGO off in
 *      seconds, so the switch is the first control, full-width, and commits on
 *      its own — one tap plus one confirm. It carries the SAVED end date and
 *      exclusions through untouched, so hitting it never also commits
 *      half-finished edits sitting in the fields below.
 *   2. Dates are resolved in the STORE'S timezone against an EXCLUSIVE
 *      boundary (see lib/promoDayBounds), because that is how migration 084
 *      stores the window.
 *   3. Saved state is read from the promo store rather than re-queried here,
 *      and liveness comes from `useBogoLive` — the same subscription the cart
 *      uses. So the LIVE/OFF/EXPIRED badge reports what the storefront is
 *      actually doing, off the SERVER's clock, and cannot drift from what
 *      buyers get. A device clock must never grant or deny a discount.
 *
 * Writes go through the admin-gated `set_bogo_promo` RPC (migration 084) and
 * nowhere else; `promo_settings` is never written directly. Every successful
 * write reloads the store, so this panel and the storefront move together.
 *
 * No window.confirm — it silently no-ops on the owner's iPhone (see the
 * AdminCoupons header); the in-page ConfirmModal is passed in as `confirm`.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { bogoDeadlineLabel, usePromoSettings } from '../../lib/promoSettings';
import { useBogoLive } from '../../lib/useBogoLive';
import { storeDayInputValue, storeDayToExclusiveEndIso } from '../../lib/promoDayBounds';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { Button } from '../../components/ui/Button';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../components/ui/Field';

interface CatalogEntry {
  sku: string;
  name: string;
}

/**
 * Both halves of the catalog — the hand-authored products AND the generated
 * compounds. The B2G1 list reads products.json alone, which is enough there
 * but would hide Korean Glutathione (VSR-RS-GSK), a seeded BOGO exclusion that
 * lives only in the generated half.
 */
const CATALOG: CatalogEntry[] = (() => {
  const bySku = new Map<string, string>();
  for (const p of [
    ...(productsData as unknown as Product[]),
    ...(generatedCompounds as unknown as Product[]),
  ]) {
    if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p.name);
  }
  return [...bySku.entries()]
    .map(([sku, name]) => ({ sku, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();

const NAME_BY_SKU = new Map(CATALOG.map((p) => [p.sku, p.name]));

type BogoStatus = 'live' | 'off' | 'expired';

const STATUS_LABEL: Record<BogoStatus, string> = {
  live: 'live',
  off: 'off',
  expired: 'expired',
};

const STATUS_CLASS: Record<BogoStatus, string> = {
  live: 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]',
  off: 'border-ink/25 text-ink/60 bg-ink/[0.05]',
  expired:
    'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]',
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/** What the STOREFRONT is doing right now. `live` comes from the same
 *  subscription the cart uses (useBogoLive), so the badge can never disagree
 *  with what buyers actually get. Enabled-but-not-live reads as expired — the
 *  fail-closed direction the storefront gate takes. */
function bogoStatus(enabled: boolean, live: boolean): BogoStatus {
  if (!enabled) return 'off';
  return live ? 'live' : 'expired';
}

function statusLine(status: BogoStatus, endsAt: string | null, hasServerClock: boolean): string {
  if (status === 'off') return 'Off — no BOGO anywhere on the storefront.';
  if (status === 'expired') {
    if (endsAt && !hasServerClock) {
      return 'Treated as expired — the server clock could not be read, so the storefront is withholding BOGO.';
    }
    const label = bogoDeadlineLabel(endsAt);
    return label
      ? `Expired — the promo ran through ${label}. The storefront is no longer showing BOGO.`
      : 'Expired — the storefront is no longer showing BOGO.';
  }
  const label = bogoDeadlineLabel(endsAt);
  return label
    ? `Live — qualifying 24-hour items are buy one, get one through ${label}.`
    : 'Live — qualifying 24-hour items are buy one, get one until you turn this off.';
}

function endDateLine(endsAt: string | null): string {
  if (!endsAt) return 'No end date — the promo runs until you turn it off.';
  const label = bogoDeadlineLabel(endsAt);
  return label
    ? `Runs through the end of ${label}, store time (Pacific) — then stops on its own.`
    : 'End date set.';
}

function sortedSkus(skus: Set<string>): string[] {
  return [...skus].sort();
}

function skuListsEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  return a.every((sku, i) => sku === b[i]);
}

interface BogoPromoSectionProps {
  confirm: (message: string, onConfirm: () => void, danger?: boolean) => void;
}

/**
 * Load gate. The controls are a SEPARATE component mounted only once the store
 * has the server's settings, so their draft state can be seeded straight from
 * the saved values at mount — no effect that copies store state into local
 * state, and therefore no window where the form renders empty defaults.
 */
export function BogoPromoSection({ confirm }: BogoPromoSectionProps) {
  const loaded = usePromoSettings((s) => s.loaded);
  const load = usePromoSettings((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">
        Loading BOGO settings…
      </p>
    );
  }

  return <BogoControls confirm={confirm} />;
}

function BogoControls({ confirm }: BogoPromoSectionProps) {
  // Saved state — the store's copy of what the SERVER holds.
  const savedEnabled = usePromoSettings((s) => s.bogoEnabled);
  const savedEndsAt = usePromoSettings((s) => s.bogoEndsAt);
  const savedExcluded = usePromoSettings((s) => s.bogoExcludedSkus);
  // The SAME liveness subscription the cart uses — server clock, monotonic
  // advance, its own tick — so this badge and the cart can never disagree.
  const { live } = useBogoLive();
  // A null fetched server clock means liveness could not be verified; the
  // storefront withholds the promo, and the copy below says so.
  const hasServerClock = usePromoSettings((s) => s.serverNowMs) != null;

  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');

  // Draft state — end date + exclusions only, seeded from the saved values at
  // mount. `enabled` is deliberately NOT drafted: the kill switch owns it and
  // commits on its own. Every write here re-seeds the draft explicitly, so the
  // two can only diverge while the owner is actively editing.
  const [draftEndsAt, setDraftEndsAt] = useState<string | null>(savedEndsAt);
  const [draftExcluded, setDraftExcluded] = useState<Set<string>>(() => new Set(savedExcluded));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [search]);

  const draftExcludedList = useMemo(() => sortedSkus(draftExcluded), [draftExcluded]);

  const hasChanges =
    draftEndsAt !== savedEndsAt ||
    !skuListsEqual(draftExcludedList, [...savedExcluded].sort());

  function toggleExcluded(sku: string) {
    setDraftExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
    setSaved(false);
  }

  /** The single write path. Everything else on this panel funnels through it,
   *  so `set_bogo_promo` stays the only way promo_settings is touched. */
  async function writeBogo(next: {
    enabled: boolean;
    endsAt: string | null;
    excludedSkus: string[];
  }): Promise<string | null> {
    if (!supabase) return 'Backend not configured.';
    const { error } = await supabase.rpc('set_bogo_promo', {
      p_enabled: next.enabled,
      p_ends_at: next.endsAt,
      p_excluded_skus: next.excludedSkus,
    });
    if (error) return getErrorMessage(error);
    // Refresh from the server so this panel and the storefront agree
    // immediately — no page reload, no optimistic guess. The reload also
    // brings a fresh server clock, and every liveness readout is subscribed to
    // it, so the badge re-derives without waiting out a tick.
    await usePromoSettings.getState().reload();
    return null;
  }

  async function flipSwitch(nextEnabled: boolean) {
    setSwitching(true);
    setSwitchError(null);
    // Carry the SAVED date + exclusions, never the draft: the kill switch must
    // not silently commit edits the owner hasn't saved.
    const message = await writeBogo({
      enabled: nextEnabled,
      endsAt: savedEndsAt,
      excludedSkus: [...savedExcluded],
    });
    setSwitching(false);
    if (message) setSwitchError(message);
  }

  function handleSwitchClick() {
    if (savedEnabled) {
      confirm(
        'Turn the launch BOGO off? Buy-one-get-one stops applying at checkout and disappears from the storefront as soon as this saves.',
        () => {
          void flipSwitch(false);
        },
        true,
      );
      return;
    }
    void flipSwitch(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const message = await writeBogo({
      enabled: savedEnabled,
      endsAt: draftEndsAt,
      excludedSkus: draftExcludedList,
    });
    setSaving(false);
    if (message) {
      setSaveError(message);
      return;
    }
    setSaved(true);
  }

  const status = bogoStatus(savedEnabled, live);

  return (
    <section aria-labelledby="bogo-heading" className="flex flex-col gap-[var(--space-5)]">
      {/* ── Kill switch — first, biggest, and it commits on its own ────────── */}
      <div className="research-surface-solid flex flex-col gap-[var(--space-4)] p-[var(--space-5)]">
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <div className="min-w-0">
            <p id="bogo-heading" className="text-[13px] text-ink mb-1">
              Launch Day BOGO — Buy One, Get One
            </p>
            <p className="text-[11.5px] leading-relaxed text-ink/50">
              {statusLine(status, savedEndsAt, hasServerClock)}
            </p>
          </div>
          <span className={`${CHIP_BASE} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          onClick={handleSwitchClick}
          disabled={switching}
          className={
            savedEnabled
              ? 'border-red-400/40 bg-red-400/[0.08] text-red-300/90 hover:bg-red-400/[0.15] hover:border-red-400/55'
              : undefined
          }
        >
          {switching ? 'Saving…' : savedEnabled ? 'Turn BOGO off now' : 'Turn BOGO on'}
        </Button>

        <p className="text-[11px] leading-relaxed text-ink/40">
          {savedEnabled
            ? 'Takes effect immediately — one tap, one confirm. Nothing else on this panel needs saving first.'
            : 'Turns the promo back on immediately, with the end date and exclusions below.'}
        </p>

        {switchError && (
          <p role="alert" className="text-[12px] text-red-400">
            {switchError}
          </p>
        )}
      </div>

      {/* ── End date ───────────────────────────────────────────────────────── */}
      <div className="research-surface-solid flex flex-col gap-[var(--space-3)] p-[var(--space-5)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/50">Last day</p>
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <input
            type="date"
            aria-label="Last day of the BOGO promo"
            value={storeDayInputValue(draftEndsAt)}
            onChange={(e) => {
              setDraftEndsAt(storeDayToExclusiveEndIso(e.target.value));
              setSaved(false);
            }}
            className={`${FIELD_SURFACE} ${FIELD_DEFAULT} w-auto min-h-[40px]`}
          />
          {draftEndsAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraftEndsAt(null);
                setSaved(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-[11.5px] leading-relaxed text-ink/50">{endDateLine(draftEndsAt)}</p>
      </div>

      {/* ── Exclusions ─────────────────────────────────────────────────────── */}
      <div className="research-surface-solid flex flex-col gap-[var(--space-3)] p-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/50">
            Exclusions — {draftExcludedList.length} of {CATALOG.length} withheld
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalog…"
            aria-label="Search the catalog for BOGO exclusions"
            className={`${FIELD_SURFACE} ${FIELD_DEFAULT} sm:w-[240px]`}
          />
        </div>

        {/* The current list spelled out, so the seeded carve-outs are visible
            and confirmable without scrolling the whole catalog. */}
        {draftExcludedList.length === 0 ? (
          <p className="text-[12px] text-ink/45">
            Nothing excluded — every eligible item gets BOGO.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-[var(--space-2)]">
            {draftExcludedList.map((sku) => (
              <li key={sku}>
                <button
                  type="button"
                  onClick={() => toggleExcluded(sku)}
                  title={`${NAME_BY_SKU.get(sku) ?? sku} — tap to put back on promo`}
                  className="flex min-h-[32px] items-center gap-2 rounded-full border border-red-400/30 bg-red-400/[0.06] px-3 py-1 text-[11.5px] text-ink/75 transition-colors hover:border-red-400/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  <span className="max-w-[168px] truncate">
                    {NAME_BY_SKU.get(sku) ?? 'Not in this catalog'}
                  </span>
                  <span className="font-mono text-[10px] text-ink/40">{sku}</span>
                  <span aria-hidden="true" className="text-[12px] text-red-400/70">
                    ×
                  </span>
                  <span className="sr-only">Remove exclusion</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <ul className="max-h-[420px] divide-y divide-ink/[0.04] overflow-y-auto rounded-[10px] border border-ink/[0.08]">
          {filtered.length === 0 && (
            <li className="p-[var(--space-4)] text-[12.5px] text-ink/50">
              Nothing matches &ldquo;{search}&rdquo;.
            </li>
          )}
          {filtered.map((p) => {
            const excluded = draftExcluded.has(p.sku);
            return (
              <li
                key={p.sku}
                className="flex min-h-[40px] items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-2)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-ink/85">{p.name}</p>
                  <p className="font-mono text-[10.5px] text-ink/40">{p.sku}</p>
                </div>
                <Button
                  type="button"
                  variant={excluded ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => toggleExcluded(p.sku)}
                  className={
                    excluded
                      ? 'border border-red-400/35 text-red-400/80 hover:bg-red-400/[0.06] hover:border-red-400/55 hover:text-red-400/80'
                      : undefined
                  }
                >
                  {excluded ? 'Excluded' : 'On promo'}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {saveError && (
        <p role="alert" className="text-[12px] text-red-400">
          {saveError}
        </p>
      )}

      <div className="flex items-center justify-end gap-[var(--space-3)]">
        {saved && !hasChanges && <span className="text-[11px] text-ink/45">Saved.</span>}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving…' : 'Save date + exclusions'}
        </Button>
      </div>
    </section>
  );
}
