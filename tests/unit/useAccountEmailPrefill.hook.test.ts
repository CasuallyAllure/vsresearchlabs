// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/useAccountEmailPrefill.ts — the React hook half.
 *
 * The pure decision (contactWithAccountEmail) is pinned in
 * useAccountEmailPrefill.test.ts; these tests pin WHEN the hook asks: never
 * for a guest, once per signed-in session (the session resolves
 * asynchronously, so the email can arrive on a later render), and never again
 * afterwards — clearing the field must stay a deliberate act the hook does
 * not fight.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useAccountEmailPrefill } from '../../src/lib/useAccountEmailPrefill';

function renderPrefill(initialEmail: string | null | undefined) {
  const setContact = vi.fn();
  const rendered = renderHook(
    ({ email }: { email: string | null | undefined }) => useAccountEmailPrefill(email, setContact),
    { initialProps: { email: initialEmail } },
  );
  return { setContact, ...rendered };
}

describe('useAccountEmailPrefill', () => {
  test('does nothing for a guest (null email)', () => {
    const { setContact } = renderPrefill(null);

    expect(setContact).not.toHaveBeenCalled();
  });

  test('does nothing for a blank account email', () => {
    const { setContact } = renderPrefill('   ');

    expect(setContact).not.toHaveBeenCalled();
  });

  test('prefills once with a functional updater that respects typed input', () => {
    // Act
    const { setContact } = renderPrefill('buyer@lab.example');

    // Assert — one functional update, deferring to contactWithAccountEmail.
    expect(setContact).toHaveBeenCalledTimes(1);
    const updater = setContact.mock.calls[0][0] as (current: string) => string;
    expect(updater('')).toBe('buyer@lab.example');
    expect(updater('shipping@other.example')).toBe('shipping@other.example');
  });

  test('applies when the session resolves after the first render', () => {
    // Arrange — the session is still loading on mount.
    const { setContact, rerender } = renderPrefill(undefined);
    expect(setContact).not.toHaveBeenCalled();

    // Act — the session arrives.
    rerender({ email: 'buyer@lab.example' });

    // Assert
    expect(setContact).toHaveBeenCalledTimes(1);
  });

  test('applies once per session — a changed email never re-asks', () => {
    // Arrange — prefill already applied.
    const { setContact, rerender } = renderPrefill('buyer@lab.example');
    expect(setContact).toHaveBeenCalledTimes(1);

    // Act — the email prop changes (e.g. re-auth as another account).
    rerender({ email: 'other@lab.example' });

    // Assert — the buyer's field is not touched again.
    expect(setContact).toHaveBeenCalledTimes(1);
  });
});
