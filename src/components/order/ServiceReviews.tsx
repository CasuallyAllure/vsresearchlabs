/**
 * ServiceReviews — approved fulfilment feedback from completed orders (089).
 *
 * Reads public_service_reviews(), which returns APPROVED rows only and carries
 * no contact data — the public name is "Ada R.", computed at submit time.
 * Renders nothing at all until there is something to show, so the section can
 * be mounted before the first review exists.
 *
 * These are SERVICE reviews. The heading says so, because the reviews are
 * about shipping and paperwork, not about the material.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { StarRating } from '../ui/StarRating';

interface ReviewRow {
  rating: number;
  comment: string | null;
  name: string;
  iso: string;
}

export function ServiceReviews({ limit = 6 }: { limit?: number }) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) return;
      const { data, error } = await supabase.rpc('public_service_reviews', { p_limit: limit });
      if (cancelled || error) return;
      const payload = data as unknown as { rows: ReviewRow[]; total: number; average: number | null } | null;
      setRows(payload?.rows ?? []);
      setTotal(payload?.total ?? 0);
      setAverage(payload?.average ?? null);
    }
    void load();
    return () => { cancelled = true; };
  }, [limit]);

  // Nothing approved yet — render nothing rather than an empty promise.
  if (rows.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-[1100px] px-[var(--space-5)] py-[var(--space-8)]">
      <div className="mb-[var(--space-4)] flex flex-wrap items-baseline justify-between gap-[var(--space-3)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em]">Fulfilment feedback</p>
        {average != null && (
          <p className="flex items-center gap-[var(--space-2)] font-mono text-[11px] tabular-nums text-ink/45">
            <StarRating value={Math.round(average)} />
            {average.toFixed(1)} · {total} {total === 1 ? 'order' : 'orders'}
          </p>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, i) => (
          <li key={i} className="research-surface-solid p-[var(--space-4)]">
            <StarRating value={r.rating} />
            {r.comment && (
              <p className="mt-[var(--space-3)] text-[13px] leading-relaxed text-ink/70">{r.comment}</p>
            )}
            <p className="mt-[var(--space-3)] font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">
              {r.name} · {r.iso}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-[var(--space-3)] text-[11px] leading-relaxed text-ink/35">
        Feedback on shipping, packaging and documentation from verified completed orders. Reviews are
        moderated before publication.
      </p>
    </section>
  );
}
