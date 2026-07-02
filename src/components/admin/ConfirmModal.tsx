/**
 * ConfirmModal — mobile-safe replacement for window.confirm / window.prompt.
 *
 * iOS Safari silently suppresses window.confirm/prompt/alert once the user
 * taps "Block Alerts" on a site, which makes confirmed admin actions (e.g.
 * "Mark shipped") appear to do nothing. This in-app modal can't be blocked
 * by the browser, so every admin surface should use it instead of the
 * native dialogs.
 *
 * Two modes:
 *   - confirm: message + confirm/cancel labels → resolves boolean.
 *   - prompt:  message + a text input (optional initial value) → resolves
 *              string | null (null on cancel).
 *
 * Pair with the `useConfirm` hook below for a clean call-site API:
 *
 *   const { confirm, prompt, modal } = useConfirm();
 *   const ok = await confirm('Cancel this order?');
 *   const reason = await prompt('Reason for cancellation:');
 *   return <>{modal}...</>;
 */

import { useCallback, useEffect, useState } from 'react';

type ConfirmRequest = {
  mode: 'confirm';
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

type PromptRequest = {
  mode: 'prompt';
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  resolve: (value: string | null) => void;
};

type ModalRequest = ConfirmRequest | PromptRequest;

/** Small uniform pill, matching OrderView's existing modal controls. */
function Pill({
  onClick, primary, children,
}: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 rounded-full border px-2.5 py-[3px] text-[8.5px] uppercase tracking-[0.14em] transition-colors',
        primary
          ? 'border-ink/30 bg-ink/[0.10] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.15]'
          : 'border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const fieldCls =
  'w-full rounded-sm border border-ink/10 bg-base-700 px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none';

/** The modal itself. Renders either the confirm or prompt variant. */
export function ConfirmModal({ request }: { request: ModalRequest }) {
  const [value, setValue] = useState(request.mode === 'prompt' ? request.initialValue ?? '' : '');

  const cancel = useCallback(() => {
    if (request.mode === 'confirm') request.resolve(false);
    else request.resolve(null);
  }, [request]);

  const submit = useCallback(() => {
    if (request.mode === 'confirm') request.resolve(true);
    else request.resolve(value);
  }, [request, value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && request.mode === 'confirm') submit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancel, submit, request.mode]);

  return (
    <>
      <div aria-hidden="true" onClick={cancel} className="fixed inset-0 z-[320] bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-[321] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[400px] research-surface-solid p-[var(--space-5)]">
          <p className="mb-[var(--space-4)] text-[13px] leading-relaxed text-ink/85">{request.message}</p>
          {request.mode === 'prompt' && (
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className={`${fieldCls} mb-[var(--space-4)]`}
            />
          )}
          <div className="flex items-center justify-end gap-[var(--space-2)]">
            <Pill onClick={cancel}>{request.cancelLabel ?? 'Cancel'}</Pill>
            <Pill primary onClick={submit}>{request.confirmLabel ?? 'Confirm'}</Pill>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * useConfirm — call-site helper around ConfirmModal.
 *
 * Returns `confirm(message, opts?)` resolving to boolean, `prompt(message,
 * opts?)` resolving to string | null, and `modal` — render this once,
 * anywhere in the component tree (it renders nothing when idle).
 */
export function useConfirm() {
  const [request, setRequest] = useState<ModalRequest | null>(null);

  const confirm = useCallback((
    message: string,
    opts?: { confirmLabel?: string; cancelLabel?: string },
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setRequest({
        mode: 'confirm',
        message,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
        resolve: (ok) => { setRequest(null); resolve(ok); },
      });
    });
  }, []);

  const prompt = useCallback((
    message: string,
    opts?: { initialValue?: string; confirmLabel?: string; cancelLabel?: string },
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      setRequest({
        mode: 'prompt',
        message,
        initialValue: opts?.initialValue,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
        resolve: (value) => { setRequest(null); resolve(value); },
      });
    });
  }, []);

  const modal = request ? <ConfirmModal request={request} /> : null;

  return { confirm, prompt, modal };
}
