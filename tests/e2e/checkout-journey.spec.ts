/**
 * Checkout journey — deterministic, fully offline, real money numbers.
 *
 * The app runs in backend-not-configured mode when Supabase env is absent:
 * products come from src/data/products.json and prices from the placeholder
 * formula in src/lib/pricing.ts (Math.round(20 + mg × perMg) × 100, where
 * perMg = 7 + hashKey(id) % 6). For rs-bpc157-5mg, hashKey % 6 = 2 → $9/mg,
 * so the 10mg tier is exactly $110.00. To force that determinism even when a
 * local .env bakes Supabase vars in, every network path that could inject
 * live prices or state is aborted (Turnstile challenge, PostgREST, edge
 * functions) — the journey renders identically on any machine and in CI.
 *
 * The journey deliberately ends at the cart totals: place-order is
 * unreachable offline by design (the submit button is gated on a Turnstile
 * token, which never arrives with the challenge endpoint aborted), so the
 * verified surface is browse → tier select → add → cart math
 * (unit × qty, subtotal, guest shipping, total). Server-side billing has its
 * own suite (tests/rls + supabase function tests).
 */
import { test, expect } from '@playwright/test';

// Entry-gate acceptance (src/config disclaimerKey) — seeded before any script
// runs so the research-use dialog never blocks the journey.
const DISCLAIMER_KEY = 'vsrl_disclaimer_accepted_v2';
const DISCLAIMER_VALUE = JSON.stringify({
  version: 2,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  industry: 'research_lab',
  age21Confirmed: true,
  researchUseConfirmed: true,
});

test.describe('checkout journey (offline, formula pricing)', () => {
  test.beforeEach(async ({ page }) => {
    // Force offline determinism: no Turnstile, no PostgREST, no edge functions.
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());
    await page.route('**/rest/v1/**', (route) => route.abort());
    await page.route('**/functions/v1/**', (route) => route.abort());
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [DISCLAIMER_KEY, DISCLAIMER_VALUE],
    );
  });

  test('browse BPC-157 → select 10mg → add ×2 → cart totals are exact', async ({ page }) => {
    // Browse step: the product page itself (direct /product/:id route).
    await page.goto('/product/rs-bpc157-5mg');
    await expect(page.getByRole('heading', { name: 'BPC-157' }).first()).toBeVisible();
    // The seeded disclaimer acceptance must keep the entry gate closed
    // (the nav drawer is an always-mounted dialog, so scope by name).
    await expect(page.getByRole('dialog', { name: 'Research-Use Only' })).toHaveCount(0);

    // Select the 10MG tier (radio in the interactive tier strip; the
    // accessible name may carry a "· FAST" suffix, so match by prefix).
    await page.getByRole('radio', { name: /^10MG/ }).click();

    // Add to inquiry (first button = desktop rail at the default viewport).
    await page.getByRole('button', { name: 'Add to Inquiry' }).first().click();

    // Money rows — each assertion scoped to its own container so the line
    // total ($220.00) can't cross-match the Subtotal row and vice versa.
    const row = (label: string) =>
      page
        .locator('div.flex.items-baseline.justify-between')
        .filter({ has: page.getByText(label, { exact: true }) });

    // Cart: the dose-baked line is present.
    await page.goto('/cart');
    const line = page.locator('li').filter({ hasText: 'BPC-157 — 10mg' });
    await expect(line).toBeVisible();

    // Unit price before quantity change: formula $110.00.
    await expect(line.getByText('$110.00', { exact: true })).toBeVisible();
    await expect(row('Subtotal').getByText('$110.00', { exact: true })).toBeVisible();

    // Increase quantity to 2.
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(line.getByText('$110.00 × 2 = $220.00')).toBeVisible();

    await expect(row('Subtotal').getByText('$220.00', { exact: true })).toBeVisible();
    await expect(row('Shipping').getByText('$9.99', { exact: true })).toBeVisible();
    await expect(row('Total').getByText('$229.99', { exact: true })).toBeVisible();

    // Offline by design: the order form renders but stays submit-gated
    // (Turnstile token never arrives), so the journey ends here.
    await expect(page.getByRole('button', { name: 'Place Order' })).toBeDisabled();
  });
});
