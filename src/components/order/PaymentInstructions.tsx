/**
 * PaymentInstructions
 *
 * The on-screen mirror of the emailed invoice's payment block — shown on
 * the order confirmation so the buyer sees exactly how to pay without
 * leaving the page. Wording is kept in lockstep with the place-order
 * edge function's email template.
 */

import { PAYMENT_CONFIG, formatUsd } from '../../lib/payment';

interface PaymentInstructionsProps {
  orderNumber: string;
  amountCents: number;
}

export function PaymentInstructions({ orderNumber, amountCents }: PaymentInstructionsProps) {
  return (
    <div className="research-surface-solid p-[var(--space-6)] print:bg-white print:border-black/15">
      <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 print:text-black/50 mb-[var(--space-2)]">
        How to pay
      </p>
      <p className="text-sm text-white/80 print:text-black mb-[var(--space-4)]">
        Amount due:{' '}
        <span className="font-mono font-semibold tabular-nums text-white print:text-black">
          {formatUsd(amountCents)}
        </span>
      </p>

      <p className="text-[13px] leading-relaxed text-white/65 print:text-black/70 mb-[var(--space-4)]">
        Send payment using <strong className="text-white print:text-black">one</strong> of the
        methods below. You{' '}
        <strong className="text-white print:text-black">must send it as Friends &amp; Family</strong>{' '}
        — any payment not sent as Friends &amp; Family will be{' '}
        <strong className="text-white print:text-black">rejected</strong>.
      </p>

      <dl className="border-t border-white/[0.08] print:border-black/15">
        <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06] print:border-black/10">
          <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 print:text-black/55 shrink-0">
            Zelle
          </dt>
          <dd className="text-sm font-mono text-white/85 print:text-black text-right break-all">
            {PAYMENT_CONFIG.zelle}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06] print:border-black/10">
          <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 print:text-black/55 shrink-0">
            PayPal
          </dt>
          <dd className="text-sm font-mono text-white/85 print:text-black text-right break-all">
            {PAYMENT_CONFIG.paypal}
            <span className="block text-[11px] font-sans text-white/40 print:text-black/50">
              Friends &amp; Family — not Goods &amp; Services
            </span>
          </dd>
        </div>
      </dl>

      <p className="mt-[var(--space-4)] text-[13px] leading-relaxed text-white/80 print:text-black">
        <strong className="text-white print:text-black">Important:</strong> put your order number{' '}
        <span className="font-mono font-semibold text-white print:text-black">{orderNumber}</span>{' '}
        in the payment note.
      </p>
      <p className="mt-[var(--space-2)] text-[13px] leading-relaxed text-white/55 print:text-black/70">
        Once your payment is confirmed, your order will be processed and your products shipped.
      </p>
    </div>
  );
}
