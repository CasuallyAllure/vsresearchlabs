/**
 * PromoTab — Buy-2-Get-1-Free (B2G1) promo governance.
 *
 * Reads/writes `promo_settings` (id=1) via the admin-gated
 * `set_b2g1_promo` RPC (migration 055). This panel ONLY controls the admin
 * toggle/end-date/exclusion list — pricing, checkout, and the storefront
 * tooltip logic all live elsewhere and are untouched here.
 *
 * On successful save, `usePromoSettings.getState().reload()` is called so
 * the live storefront messaging (LTO line, chip tooltips) picks up the new
 * settings without a page reload.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePromoSettings } from '../../lib/promoSettings';
import productsData from '../../data/products.json';
import type { Product } from '../../types';
import { Button } from '../../components/ui/Button';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../components/ui/Field';

const products = (productsData as unknown as Product[])
  .filter((p) => !!p.sku)
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

interface PromoTabProps {
  confirm: (message: string, onConfirm: () => void, danger?: boolean) => void;
}

interface PromoSettingsRow {
  b2g1_enabled: boolean;
  b2g1_ends_at: string | null;
  b2g1_excluded_skus: string[] | null;
}

interface SavedSnapshot {
  enabled: boolean;
  endsAt: string | null;
  excludedSkus: string[];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/** "YYYY-MM-DD" for a date <input>, local time, or '' when there's no end date. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Convert a date-input value ("YYYY-MM-DD") to an ISO timestamp at 23:59:59
 *  local time of that day — the promo runs through the whole chosen day. */
function dateInputToEndOfDayIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 0).toISOString();
}

function plainLanguageLine(endsAt: string | null): string {
  if (!endsAt) return 'No end date — runs until you turn it off.';
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return 'No end date — runs until you turn it off.';
  const formatted = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `Ends ${formatted} — promo auto-stops after this.`;
}

function sortedSkus(skus: Set<string>): string[] {
  return [...skus].sort();
}

function skuListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((sku, i) => sku === b[i]);
}

export function PromoTab({ confirm }: PromoTabProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');

  const [enabled, setEnabled] = useState(false);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [excludedSkus, setExcludedSkus] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<SavedSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setLoadError('Backend not configured.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('promo_settings')
        .select('b2g1_enabled, b2g1_ends_at, b2g1_excluded_skus')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(getErrorMessage(error));
        setLoading(false);
        return;
      }
      const row = data as PromoSettingsRow | null;
      const rowEnabled = !!row?.b2g1_enabled;
      const rowEndsAt = row?.b2g1_ends_at ?? null;
      const rowExcluded = row?.b2g1_excluded_skus ?? [];
      setEnabled(rowEnabled);
      setEndsAt(rowEndsAt);
      setExcludedSkus(new Set(rowExcluded));
      setInitial({ enabled: rowEnabled, endsAt: rowEndsAt, excludedSkus: [...rowExcluded].sort() });
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [search]);

  const hasChanges = useMemo(() => {
    if (!initial) return false;
    if (initial.enabled !== enabled) return true;
    if (initial.endsAt !== endsAt) return true;
    return !skuListsEqual(sortedSkus(excludedSkus), initial.excludedSkus);
  }, [initial, enabled, endsAt, excludedSkus]);

  function toggleExcluded(sku: string) {
    setExcludedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
    setSaved(false);
  }

  async function doSave() {
    if (!supabase) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const excluded = sortedSkus(excludedSkus);
    const { error } = await supabase.rpc('set_b2g1_promo', {
      p_enabled: enabled,
      p_ends_at: endsAt,
      p_excluded_skus: excluded,
    });
    setSaving(false);
    if (error) {
      setSaveError(getErrorMessage(error));
      return;
    }
    setInitial({ enabled, endsAt, excludedSkus: excluded });
    setSaved(true);
    await usePromoSettings.getState().reload();
  }

  function handleSaveClick() {
    if (initial?.enabled && !enabled) {
      confirm(
        'Turn off the B2G1 promo? The storefront stops showing Buy-2-Get-1 messaging as soon as this saves.',
        () => { void doSave(); },
        true,
      );
      return;
    }
    void doSave();
  }

  if (!supabase) {
    return (
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="text-[13px] text-ink/55">Backend not configured.</p>
      </div>
    );
  }

  if (loading) {
    return <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>;
  }

  if (loadError) {
    return <p role="alert" className="text-[12px] text-red-400">{loadError}</p>;
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="research-surface-solid flex flex-col gap-[var(--space-3)] p-[var(--space-5)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] text-ink mb-1">Buy 2, Get 1 Free</p>
          <p className="text-[11.5px] text-ink/50">
            {enabled
              ? 'Live — the storefront is showing B2G1 messaging on qualifying items.'
              : 'Off — no B2G1 messaging on the storefront.'}
          </p>
        </div>
        <Button
          type="button"
          variant={enabled ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => { setEnabled((e) => !e); setSaved(false); }}
          className={!enabled ? 'border border-ink/15' : undefined}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </Button>
      </div>

      <div className="research-surface-solid flex flex-col gap-[var(--space-3)] p-[var(--space-5)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/50">End date</p>
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <input
            type="date"
            value={toDateInputValue(endsAt)}
            onChange={(e) => {
              const value = e.target.value;
              setEndsAt(value ? dateInputToEndOfDayIso(value) : null);
              setSaved(false);
            }}
            className={`${FIELD_SURFACE} ${FIELD_DEFAULT} w-auto min-h-[40px]`}
          />
          {endsAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setEndsAt(null); setSaved(false); }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-[11.5px] text-ink/50">{plainLanguageLine(endsAt)}</p>
      </div>

      <div className="research-surface-solid flex flex-col gap-[var(--space-3)] p-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/50">
            Compound exclusions — {excludedSkus.size} excluded of {products.length}
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search compounds…"
            className={`${FIELD_SURFACE} ${FIELD_DEFAULT} sm:w-[240px]`}
          />
        </div>

        <ul className="max-h-[420px] overflow-y-auto divide-y divide-ink/[0.04] rounded-[10px] border border-ink/[0.08]">
          {filteredProducts.length === 0 && (
            <li className="p-[var(--space-4)] text-[12.5px] text-ink/50">No compounds match &ldquo;{search}&rdquo;.</li>
          )}
          {filteredProducts.map((p) => {
            const excluded = excludedSkus.has(p.sku);
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

      {saveError && <p role="alert" className="text-[12px] text-red-400">{saveError}</p>}

      <div className="flex items-center justify-end gap-[var(--space-3)]">
        {saved && !hasChanges && <span className="text-[11px] text-ink/45">Saved.</span>}
        <Button type="button" variant="secondary" size="sm" onClick={handleSaveClick} disabled={saving || !hasChanges}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
