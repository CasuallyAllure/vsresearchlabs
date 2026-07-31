/**
 * earlyAccessRowLabel — the Inventory admin editor's per-row early-access
 * button label/title (src/pages/admin/AdminInventory.tsx).
 *
 * Pulled out of AdminInventory.tsx (not left inline) for two reasons: it
 * keeps a non-component export out of that component file (avoids the
 * react-refresh/only-export-components warning), and it puts this pure
 * function under src/lib, which the coverage ratchet actually measures —
 * src/pages/admin/** does not.
 *
 * The label must reflect the EFFECTIVE gate — flag OR tag, the same rule
 * earlyAccess.ts uses on the storefront — not just the DB flag this admin
 * control writes. A SKU carrying the legacy 'early-access' tag stays gated
 * even after an admin clears the flag; the button has to say so, or "Open"
 * reads as a promise the click doesn't keep (code review, WS-3 follow-up).
 */

export function earlyAccessRowLabel(tagged: boolean, flagged: boolean): { label: string; title: string } {
  if (tagged) {
    return flagged
      ? {
          label: 'Tag+Flag',
          title: 'Gated by BOTH the legacy catalog tag and this flag. Clicking clears the flag, but the tag still gates — remove the tag from the product data to actually open this SKU.',
        }
      : {
          label: 'Tagged',
          title: 'Gated by the legacy early-access tag in the product data, not this flag. Clicking will set the flag, but it is already redundant — remove the tag to open this SKU.',
        };
  }
  return flagged
    ? { label: 'Open', title: 'Member early access is ON (this flag). Click to open to all buyers.' }
    : { label: 'Early', title: 'Open to all buyers. Click to restrict to members only (early access).' };
}
