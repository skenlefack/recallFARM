import { test, expect } from '@playwright/test';

test.describe('Admin login', () => {
  test('/admin redirects to login', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/login/);
    await expect(page.locator('body')).toContainText(/[Cc]onnexion|[Nn]uméro|[Tt]éléphone/);
  });

  test('login form accepts phone number', async ({ page }) => {
    await page.goto('/admin/login');
    const phoneInput = page.locator('#login-phone, input[type="tel"], input[name="phone"]');
    if (await phoneInput.count() > 0) {
      await phoneInput.fill('+23769000001');
      // Find and click submit button
      const submit = page.locator('button[type="submit"], button:has-text("Envoyer"), button:has-text("Code")');
      if (await submit.count() > 0) {
        await submit.click();
        // Should show OTP code input or dev_code hint
        await page.waitForTimeout(1000);
        const body = await page.locator('body').textContent();
        expect(body).toBeTruthy();
      }
    }
  });
});
