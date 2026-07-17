/**
 * Unit tests for src/lib/useAccountEmailPrefill.ts — contactWithAccountEmail().
 *
 * The client half of P0-5. The server now resolves membership from the verified
 * session alone, so a different contact no longer changes the price — but the
 * account email is still the right default, and the prefill must never fight the
 * buyer for the field.
 *
 * The React wrapper (useAccountEmailPrefill) only decides WHEN to ask; this is
 * the decision itself, kept pure so it can be tested without a DOM.
 */
import { describe, expect, test } from 'vitest';
import { contactWithAccountEmail } from '../../src/lib/useAccountEmailPrefill';

describe('contactWithAccountEmail', () => {
  test('fills an empty field with the account email', () => {
    expect(contactWithAccountEmail('', 'buyer@lab.example')).toBe('buyer@lab.example');
  });

  test('never clobbers what the buyer already typed', () => {
    expect(contactWithAccountEmail('shipping@other.example', 'buyer@lab.example'))
      .toBe('shipping@other.example');
  });

  test('treats a whitespace-only field as empty', () => {
    expect(contactWithAccountEmail('   ', 'buyer@lab.example')).toBe('buyer@lab.example');
  });

  test('leaves a guest alone', () => {
    expect(contactWithAccountEmail('', null)).toBe('');
    expect(contactWithAccountEmail('', undefined)).toBe('');
    expect(contactWithAccountEmail('typed', null)).toBe('typed');
  });

  test('ignores a blank account email', () => {
    expect(contactWithAccountEmail('', '   ')).toBe('');
  });

  test('trims the account email before using it', () => {
    expect(contactWithAccountEmail('', '  buyer@lab.example ')).toBe('buyer@lab.example');
  });

  test('a phone number the buyer typed survives — it no longer costs them anything', () => {
    // The whole point of P0-5: contact is a delivery address, not an identity
    // claim. Typing a phone number is allowed and does not demote them to guest.
    expect(contactWithAccountEmail('+1 555 000 0000', 'buyer@lab.example'))
      .toBe('+1 555 000 0000');
  });
});
