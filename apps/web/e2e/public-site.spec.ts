import { test, expect } from '@playwright/test';

test.describe('Public site', () => {
  test('homepage loads and shows RecallFarm', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toContainText('RecallFarm');
  });

  test('pricing section shows plans', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toContainText(/Gratuit|Pro|Structure/i);
  });

  test('certificate verifier page loads', async ({ page }) => {
    await page.goto('/verifier');
    await expect(page.locator('body')).toContainText(/[Vv]érif/);
  });
});
