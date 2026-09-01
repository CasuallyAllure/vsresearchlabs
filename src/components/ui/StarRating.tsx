/**
 * StarRating — the one star control, used by the review form (interactive) and
 * the public review list + admin queue (read-only).
 *
 * Keyboard-operable by construction: interactive mode is a radiogroup of real
 * buttons, so arrow/tab focus and Enter work without any key handling of our
 * own. Read-only mode renders no controls at all — just an accessible label.
 */

const FILLED = 'text-gold';
const EMPTY = 'text-ink/20';

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"
         fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"
         className={filled ? FILLED : EMPTY}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

interface Props {
  value: number;
  /** Omit for a read-only display. */
  onChange?: (value: number) => void;
}

export function StarRating({ value, onChange }: Props) {
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => <Star key={n} filled={n <= value} />)}
      </span>
    );
  }

  return (
    <span role="radiogroup" aria-label="Fulfilment rating" className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          className="rounded-full p-1 transition-colors hover:bg-ink/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <Star filled={n <= value} />
        </button>
      ))}
    </span>
  );
}
