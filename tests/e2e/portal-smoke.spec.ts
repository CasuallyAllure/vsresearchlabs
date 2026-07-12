/**
 * Portal smoke tests — logged-out only, no backend mutations.
 *
 * Covers the acceptance-criteria baseline that must hold with zero backend
 * configuration: the portal routes render their auth-gated / guest state
 * without crashing. Anything that requires a session (order history, reward
 * ledger, checkout) is out of scope here — see tests/rls for the
 * server-enforced isolation guarantees and the RLS suite for authenticated
 * behavior.
 */
import { test, expect } from '@playwright/test';

test.describe('portal smoke (logged out)', () => {
  test('/ renders the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveTitle(/error/i);
  });

  test('/account shows the sign-in flip card', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByText('Customer Portal')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('/account/orders renders the auth-gate state without crashing', async ({ page }) => {
    await page.goto('/account/orders');
    await expect(page.getByText('Customer Portal')).toBeVisible();
  });

  test('/account/rewards renders the auth-gate state without crashing', async ({ page }) => {
    await page.goto('/account/rewards');
    await expect(page.getByText('Customer Portal')).toBeVisible();
  });

  test('/account/benefits renders the auth-gate state without crashing', async ({ page }) => {
    await page.goto('/account/benefits');
    await expect(page.getByText('Customer Portal')).toBeVisible();
  });

  test('/track renders the order-lookup form', async ({ page }) => {
    await page.goto('/track');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveTitle(/error/i);
  });
});

test.describe('portal smoke — 375px viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('/account renders the sign-in card at mobile width without crashing', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByText('Customer Portal')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
