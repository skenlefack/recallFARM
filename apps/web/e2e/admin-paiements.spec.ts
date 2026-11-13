import { test, expect, type Page } from '@playwright/test';

/**
 * Console : administration des paiements (liste, detail, remboursement, rapprochement).
 * Tourne contre le build "mock" (voir admin-paiement.spec.ts). Compte 690000009 = platform_admin.
 * SHOT_DIR=<dossier> enregistre des captures d'ecran de chaque etat (fidelite visuelle).
 */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.waitForTimeout(500); // fin des animations
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: false });
};

async function login(page: Page, phone: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Numéro de téléphone').fill(phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code reçu par SMS').fill('123456');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}

test.describe('Administration des paiements', () => {
  test('liste, filtre « a verifier », detail, interrogation, remboursement', async ({ page }) => {
    await login(page, '690000009');
    await page.getByRole('link', { name: 'Paiements' }).click();
    await expect(page.getByRole('table', { name: 'Liste des paiements' })).toBeVisible();
    await shot(page, 'paiements-liste');

    await page.getByLabel('Statut').selectOption('a_verifier');
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: /Détails du paiement/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Historique' })).toBeVisible();
    await shot(page, 'paiements-detail');
    await dialog.getByRole('button', { name: 'Interroger' }).click();
    await expect(page.getByText(/Statut : Confirmé/)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByLabel('Statut').selectOption('confirme');
    await page.getByRole('button', { name: /Détails du paiement/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Rembourser' }).click();
    const refund = page.getByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await refund.getByLabel('Motif du remboursement').fill('Double paiement constaté');
    await shot(page, 'paiements-remboursement');
    await refund.getByRole('button', { name: 'Confirmer le remboursement' }).click();
    await expect(page.getByText('Remboursement effectué.')).toBeVisible();

    // remboursement reste sans issue (a_verifier) : relance possible ; en_attente : aucun bouton
    await page.getByLabel('Statut').selectOption('remboursement_en_cours');
    await expect(page.getByRole('row')).toHaveCount(3);
    const details = page.getByRole('button', { name: /Détails du paiement/ });
    await details.nth(0).click(); // a7 : refund a_verifier -> relance possible
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Relancer le remboursement' })).toHaveCount(1);
    await shot(page, 'paiements-relance-remboursement');
    await page.keyboard.press('Escape');
    await details.nth(1).click(); // a5 : refund en_attente -> 409 cote serveur, donc aucun bouton
    await expect(page.getByRole('dialog').getByRole('button', { name: /embours/ })).toHaveCount(0);
  });

  test('rapprochement : rapports et detail', async ({ page }) => {
    await login(page, '690000009');
    await page.goto('/admin/paiements');
    await page.getByRole('button', { name: 'Rapprochement' }).click();
    await expect(page.getByRole('table', { name: /Rapports de rapprochement/ })).toBeVisible();
    await shot(page, 'paiements-rapprochement');
    await page.getByRole('button', { name: /Rapport du 11 nov/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Écarts avec le fournisseur');
    await shot(page, 'paiements-rapport-detail');
  });

  test('un compte sans role plateforme ne voit pas l\'entree de menu', async ({ page }) => {
    await login(page, '690000002');
    await expect(page.getByRole('link', { name: 'Abonnements' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Paiements' })).toHaveCount(0);
  });
});
