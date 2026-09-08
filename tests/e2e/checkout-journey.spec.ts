/**
 * Checkout journey — deterministic, fully offline, real money numbers.
 *
 * The app runs in backend-not-configured mode when Supabase env is absent:
 * products come from src/data/products.json. To force that determinism even
 * when a local .env bakes Supabase vars in, every network path that could
 * inject live prices or state is aborted (Turnstile challenge, PostgREST,
 * edge functions) — the journey renders identically on any machine and in CI.
 *
 * The journey rides a product that carries its own catalog price
 * (Research Diluent Solution, $12.00), so every figure asserted below traces
 * to seed data. It deliberately does NOT ride a per-dose-priced compound:
 * offline there is no admin override to read, and pricing.ts no longer
 * invents a stand-in — that fabrication is the bug the second test pins.
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

test.describe('checkout journey (offline, catalog pricing)', () => {
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

  test('browse the diluent → select 30 mL → add ×2 → cart totals are exact', async ({ page }) => {
    // Browse step: the product page itself (direct /product/:id route).
    await page.goto('/product/rs-bacteriostatic-water-30ml');
    await expect(
      page.getByRole('heading', { name: 'Research Diluent Solution' }).first(),
    ).toBeVisible();
    // The seeded disclaimer acceptance must keep the entry gate closed
    // (the nav drawer is an always-mounted dialog, so scope by name).
    await expect(page.getByRole('dialog', { name: 'Research-Use Only' })).toHaveCount(0);

    // Select the 30 mL tier (radio in the interactive tier strip; the
    // accessible name may carry a "· FAST" suffix, so match by prefix).
    await page.getByRole('radio', { name: /^30\s?ML/i }).click();

    // Add to inquiry (first button = desktop rail at the default viewport).
    await page.getByRole('button', { name: 'Add to Inquiry' }).first().click();

    // Money rows — each assertion scoped to its own container so the line
    // total ($24.00) can't cross-match the Subtotal row and vice versa.
    const row = (label: string) =>
      page
        .locator('div.flex.items-baseline.justify-between')
        .filter({ has: page.getByText(label, { exact: true }) });

    // Cart: the dose-baked line is present.
    await page.goto('/cart');
    const line = page.locator('li').filter({ hasText: 'Research Diluent Solution — 30 mL' });
    await expect(line).toBeVisible();

    // Unit price before quantity change: the catalog price, $12.00.
    await expect(line.getByText('$12.00', { exact: true })).toBeVisible();
    await expect(row('Subtotal').getByText('$12.00', { exact: true })).toBeVisible();

    // Increase quantity to 2.
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(line.getByText('$12.00 × 2 = $24.00')).toBeVisible();

    await expect(row('Subtotal').getByText('$24.00', { exact: true })).toBeVisible();
    await expect(row('Shipping').getByText('$9.99', { exact: true })).toBeVisible();
    await expect(row('Total').getByText('$33.99', { exact: true })).toBeVisible();

    // Offline by design: the order form renders but stays submit-gated
    // (Turnstile token never arrives), so the journey ends here.
    await expect(page.getByRole('button', { name: 'Place Order' })).toBeDisabled();
  });

  test('a compound with no admin price shows no price and cannot be added', async ({ page }) => {
    // The regression this pins: with PostgREST aborted there is no override to
    // read, and BPC-157 carries no catalog price of its own. pricing.ts used to
    // derive one from the dose's mg magnitude (10mg → $110.00), so a Supabase
    // outage silently sold at a figure nobody set. Unknown must stay unknown,
    // and an unpriced line must never reach the cart.
    await page.goto('/product/rs-bpc157-5mg');
    await expect(page.getByRole('heading', { name: 'BPC-157' }).first()).toBeVisible();

    await expect(page.getByText('$110.00', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add to Inquiry' }).first().click();

    await page.goto('/cart');
    await expect(page.locator('li').filter({ hasText: 'BPC-157' })).toHaveCount(0);
  });
});
