# ADR-005 — Controle d'accessibilite Web : axe-core (devDependency)

Statut : propose (2026-11-12) — lot V1 web, ecrans de paiement (agent web)

## Contexte
La DoD exige l'accessibilite AA et « axe-core sans violation serieuse » pour chaque ecran. axe-core etait
deja present dans `node_modules` comme dependance transitive d'`eslint-plugin-jsx-a11y` (meme version 4.14.0),
mais aucun test ne l'executait sur les ecrans rendus.

## Decision
Declarer `axe-core@4.14.0` en devDependency de `apps/web` et l'executer dans les tests Vitest
(`src/test/a11y.ts`) sur chaque ecran de paiement et chaque etat (chargement, vide, erreur, dialogues).
- Licence MPL-2.0, maintenue par Deque, aucune dependance d'execution : n'entre ni dans le bundle ni dans l'image.
- Aucun nouveau paquet dans l'arbre : seul le fichier `package.json` (et l'entree racine du lockfile) change.
- Limite connue : jsdom ne calcule pas les couleurs rendues ; la regle `color-contrast` est desactivee dans ces
  tests et le contraste reste verifie par les jetons de `tokens.css` et par les captures Playwright.

## Consequences
- `npm test` echoue sur toute violation de niveau `serious` ou `critical`.
- Retour arriere : retirer la dependance et `src/test/a11y.ts` ; aucun code applicatif impacte.
