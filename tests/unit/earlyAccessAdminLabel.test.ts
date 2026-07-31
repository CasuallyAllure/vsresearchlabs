/**
 * earlyAccessRowLabel — the Inventory admin editor's per-row early-access
 * button label/title (src/lib/earlyAccessAdminLabel.ts, used by
 * AdminInventory.tsx). Code review (WS-3 follow-up) flagged that the
 * original toggle read only the DB flag and stayed silent about a tagged
 * SKU: an admin could clear the flag, see the button say "Open", and the
 * SKU would stay gated anyway because the storefront gate is flag OR tag
 * (earlyAccess.ts). This asserts the fixed label surfaces the EFFECTIVE
 * state and distinguishes the source, across all four flag x tag
 * combinations.
 */
import { describe, expect, test } from 'vitest';
import { earlyAccessRowLabel } from '../../src/lib/earlyAccessAdminLabel';

describe('earlyAccessRowLabel', () => {
  test('not tagged, not flagged -> "Early" (clicking will gate it)', () => {
    const { label, title } = earlyAccessRowLabel(false, false);
    expect(label).toBe('Early');
    expect(title.toLowerCase()).toContain('restrict');
  });

  test('not tagged, flagged -> "Open" (clicking genuinely opens it)', () => {
    const { label, title } = earlyAccessRowLabel(false, true);
    expect(label).toBe('Open');
    expect(title.toLowerCase()).toContain('open to all buyers');
  });

  test('tagged, not flagged -> "Tagged", warns clearing/setting the flag will not open it', () => {
    const { label, title } = earlyAccessRowLabel(true, false);
    expect(label).toBe('Tagged');
    expect(title.toLowerCase()).toContain('tag');
    expect(title.toLowerCase()).not.toContain('open to all buyers');
  });

  test('tagged AND flagged -> distinct label, warns the tag still gates after clearing the flag', () => {
    const { label, title } = earlyAccessRowLabel(true, true);
    expect(label).toBe('Tag+Flag');
    expect(label).not.toBe(earlyAccessRowLabel(false, true).label); // never reads as plain "Open"
    expect(title.toLowerCase()).toContain('tag still gates');
  });
});
