/**
 * Identifier Primitives — R1
 *
 * Monospace procurement identifiers. All render as inline <span>
 * elements — callers control block/flex context externally.
 *
 * Typography discipline:
 *   - font-mono (JetBrains Mono) for all fixed-width identifiers
 *   - tabular-nums on numerical values to prevent layout shift
 *   - No badge theatrics: no colored backgrounds, no border boxes
 *   - Colors stay within the white/opacity register except StatusFlag
 *     which maps to semantic status tokens
 *
 * Surface posture: these are typography primitives, not UI widgets.
 * They carry no border, no shadow, no interactive affordance.
 */

import { cn } from '../../lib/utils';
import { formatDate, formatProcurementNumber } from '../../lib/format';

// ─── SKUCode ──────────────────────────────────────────────────────────────────

interface SKUCodeProps {
  value: string;
  className?: string;
}

export function SKUCode({ value, className }: SKUCodeProps) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums uppercase tracking-[0.08em] text-ink/50',
        'text-[var(--type-identifier-sm)]',
        className,
      )}
    >
      {value}
    </span>
  );
}

// ─── BatchCode ────────────────────────────────────────────────────────────────

interface BatchCodeProps {
  value: string;
  className?: string;
}

export function BatchCode({ value, className }: BatchCodeProps) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums uppercase tracking-[0.08em] text-ink/50',
        'text-[var(--type-identifier-sm)]',
        className,
      )}
    >
      {value}
    </span>
  );
}

// ─── LotCode ──────────────────────────────────────────────────────────────────

interface LotCodeProps {
  value: string;
  className?: string;
}

export function LotCode({ value, className }: LotCodeProps) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums uppercase tracking-[0.08em] text-ink/50',
        'text-[var(--type-identifier-sm)]',
        className,
      )}
    >
      {value}
    </span>
  );
}

// ─── DateStamp ────────────────────────────────────────────────────────────────

interface DateStampProps {
  /** ISO 8601 date or datetime string. */
  iso: string;
  className?: string;
}

export function DateStamp({ iso, className }: DateStampProps) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums text-ink/45',
        'text-[var(--type-identifier-sm)]',
        className,
      )}
    >
      {formatDate(iso)}
    </span>
  );
}

// ─── ProcurementValue ─────────────────────────────────────────────────────────

interface ProcurementValueProps {
  /** Price in cents, or null for "Inquire for pricing". */
  cents: number | null;
  className?: string;
}

export function ProcurementValue({ cents, className }: ProcurementValueProps) {
  const label = formatProcurementNumber(cents);
  const isInquiry = cents === null || cents === 0;
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        isInquiry
          ? 'text-ink/55 text-[var(--type-identifier-sm)] uppercase tracking-[0.15em]'
          : 'text-ink text-sm',
        className,
      )}
    >
      {label}
    </span>
  );
}

// ─── StatusFlag ───────────────────────────────────────────────────────────────

type StatusVariant = 'available' | 'limited' | 'unavailable' | 'inquiry';

const STATUS_DEFAULTS: Record<StatusVariant, string> = {
  available:   'Available',
  limited:     'Limited',
  unavailable: 'Unavailable',
  inquiry:     'Inquire',
};

const STATUS_CLASSES: Record<StatusVariant, string> = {
  available:   'text-[var(--color-status-success)]',
  limited:     'text-[var(--color-status-warning)]',
  unavailable: 'text-ink/35',
  inquiry:     'text-ink/55',
};

interface StatusFlagProps {
  variant: StatusVariant;
  /** Override the default label. */
  label?: string;
  className?: string;
}

export function StatusFlag({ variant, label, className }: StatusFlagProps) {
  return (
    <span
      className={cn(
        'font-mono uppercase tracking-[0.15em]',
        'text-[var(--type-identifier-xs)]',
        STATUS_CLASSES[variant],
        className,
      )}
    >
      {label ?? STATUS_DEFAULTS[variant]}
    </span>
  );
}
