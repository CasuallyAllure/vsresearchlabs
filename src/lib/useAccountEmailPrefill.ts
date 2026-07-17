import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * The prefill decision, pure: keep whatever the buyer has typed, otherwise fall
 * back to the signed-in account's email. A blank/absent account email (a guest)
 * changes nothing.
 */
export function contactWithAccountEmail(
  current: string,
  email: string | null | undefined,
): string {
  const accountEmail = (email ?? '').trim();
  if (!accountEmail) return current;
  return current.trim().length > 0 ? current : accountEmail;
}

/**
 * Prefill a checkout contact field with the signed-in account's email.
 *
 * Both cart surfaces used to start the contact field at `useState('')` and never
 * read `user.email`, so the default path for a signed-in buyer was to retype
 * (or mistype) their address — or, on /cart, to enter a phone number, which the
 * field explicitly invites. That used to silently cost them member pricing;
 * place-order now resolves membership from the verified session alone (P0-5), so
 * it no longer changes the price. What it still changes is whether the invoice
 * reaches them: a non-email contact suppresses the invoice email.
 *
 * So: prefill, don't lock. The account email is the right default; a buyer who
 * wants the invoice somewhere else stays free to say so, and is no longer
 * punished for it.
 *
 * Applies once per signed-in session, and never fights the buyer for the field:
 * the session resolves asynchronously, so they may have started typing first,
 * and clearing the field afterwards is a deliberate act.
 */
export function useAccountEmailPrefill(
  email: string | null | undefined,
  setContact: Dispatch<SetStateAction<string>>,
): void {
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    if (!(email ?? '').trim()) return;
    applied.current = true;
    setContact((current) => contactWithAccountEmail(current, email));
  }, [email, setContact]);
}
