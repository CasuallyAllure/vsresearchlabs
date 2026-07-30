/**
 * StaleDataNotice — R7
 *
 * A quiet inline note for the "we have last-known-good data, but the
 * background refresh that would confirm it's still current just failed"
 * state (`useAccountQuery`'s revalidation-failure semantics,
 * accountQueryCache.ts). Deliberately NOT `ErrorState`: that primitive
 * replaces the whole view, which would blank a customer's real reward
 * balance or order list over a transient refresh hiccup — this sits above
 * the still-rendered data instead.
 *
 * `role="status"` (not `alert`) — this isn't urgent; the customer is
 * already looking at usable data.
 */

interface StaleDataNoticeProps {
  /** What failed to refresh, e.g. "your orders", "your rewards". */
  subject: string;
  className?: string;
}

export function StaleDataNotice({ subject, className }: StaleDataNoticeProps) {
  return (
    <p role="status" className={`mb-[var(--space-3)] text-[11px] text-ink/45 ${className ?? ''}`}>
      Couldn't refresh {subject} just now — showing the last known data.
    </p>
  );
}
