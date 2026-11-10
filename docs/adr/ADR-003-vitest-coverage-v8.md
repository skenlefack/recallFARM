# ADR-003 — Mesure de couverture Web : @vitest/coverage-v8

Statut : accepte (2026-11-10) — lot P0.4 (qa-mesures)

## Contexte
La DoD exige 80 % des lignes sur le code nouveau et une couverture prouvee. Le Web (Vitest 2.1) n'avait
aucun fournisseur de couverture : la mesure etait impossible (voir docs/plan/etat.md).

## Decision
Ajouter `@vitest/coverage-v8` (devDependency, meme version majeure que `vitest`, ^2.1.8).
- Licence MIT, maintenue par l'equipe Vitest, aucune dependance d'execution : n'entre pas dans l'image de production.
- Utilise le moteur V8 natif de Node : pas d'instrumentation Babel, mesure rapide (< 20 s ici).
- Alternative ecartee : `@vitest/coverage-istanbul` (plus lent, instrumentation du code, aucun gain pour notre usage).

## Consequences
- `npm run test:coverage` (apps/web) mesure tout `src/` hors tests et mocks et applique des seuils
  (non-regression + moteur d'expressions) definis dans `vite.config.ts`.
- Mise a jour de `vitest` et de `@vitest/coverage-v8` ensemble (versions alignees).
- Retour arriere : retirer la dependance et le bloc `test.coverage` ; aucun code applicatif impacte.
