import { test, expect, type Page } from '@playwright/test';

/**
 * Parcours paiement de la console (ecran Abonnements).
 * Tourne en local contre le build "mock" (donnees fictives, aucune API requise) :
 *   VITE_MOCK=1 npx vite build --outDir dist-mock && npx vite preview --outDir dist-mock --port 9080
 *   BASE_URL=http://localhost:9080 npx playwright test admin-paiement
 * Simulateur : numero finissant par 97 -> PAY-INIT ; par 96 -> PAY-PENDING ; par 99 -> echec ; sinon confirme.
 */

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Numéro de téléphone').fill('690000002');
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code reçu par SMS').fill('123456');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}

async function openCheckout(page: Page, phone: string) {
  await page.goto('/admin/abonnements');
  await page.getByRole('button', { name: 'Renouveler' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /Orange Money/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /MTN MoMo/ })).toBeVisible();
  await dialog.getByLabel(/^Numéro/).fill(phone);
  return dialog;
}

test.describe('Abonnements : paiement', () => {
  test.beforeEach(async ({ page }) => login(page));

  test('PAY-INIT : refus annonce, on peut reessayer', async ({ page }) => {
    const dialog = await openCheckout(page, '690000097');
    await dialog.getByRole('button', { name: 'Payer' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('Paiement refusé');
    await expect(alert).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });

  test('PAY-PENDING : suivi automatique, pas de relance', async ({ page }) => {
    const dialog = await openCheckout(page, '690000096');
    await dialog.getByRole('button', { name: 'Payer' }).click();
    await expect(dialog.getByText(/Paiement en cours de vérification/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Payer' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
  });

  test('paiement confirme', async ({ page }) => {
    const dialog = await openCheckout(page, '690000001');
    await dialog.getByRole('button', { name: 'Payer' }).click();
    await expect(dialog.getByText('Paiement confirmé.')).toBeVisible({ timeout: 20_000 });
  });
});
