/**
 * QuantityStepper
 *
 * Canonical inquiry-quantity control. Decrement / value / increment
 * triplet in a single bordered container. Tabular-num readout keeps
 * digit width fixed between 1, 10, 99 so the visual width never jumps.
 *
 * Used by:
 *   - Overlay desktop CTA + mobile action bar
 *   - ProductPage sticky CTA + mobile sticky bar
 *
 * Bounded to [1, 99]. Min/max are enforced inside the stepper — callers
 * receive only valid values. No keyboard input support today (steppers
 * only); future addition of an editable text input is additive.
 *
 * Visuals are frozen.
 */

interface QuantityStepperProps {
  quantity: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function QuantityStepper({
  quantity,
  onChange,
  min = 1,
  max = 99,
  className,
}: QuantityStepperProps) {
  const dec = () => onChange(Math.max(min, quantity - 1));
  const inc = () => onChange(Math.min(max, quantity + 1));

  return (
    <div
      className={['flex items-center shrink-0 rounded-[2px] overflow-hidden', className ?? ''].filter(Boolean).join(' ')}
      style={{ border: '1px solid var(--color-border-default)' }}
    >
      <button
        type="button"
        onClick={dec}
        aria-label="Decrease quantity"
        className="w-7 h-8 flex items-center justify-center text-ink/40 hover:text-ink/80 hover:bg-ink/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
        style={{ fontSize: '16px', lineHeight: 1 }}
      >
        −
      </button>
      <span
        className="w-8 h-8 flex items-center justify-center font-mono tabular-nums text-ink/70 select-none"
        style={{ fontSize: '12px', borderLeft: '1px solid var(--color-border-subtle)', borderRight: '1px solid var(--color-border-subtle)' }}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={inc}
        aria-label="Increase quantity"
        className="w-7 h-8 flex items-center justify-center text-ink/40 hover:text-ink/80 hover:bg-ink/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
        style={{ fontSize: '16px', lineHeight: 1 }}
      >
        +
      </button>
    </div>
  );
}
