# tests/coverage — mesure de couverture et seuils

Trois mesures, une par application, publiees en artefacts par la CI (`coverage-api`, `coverage-web`, `coverage-mobile`).

| App | Mesure | Commande locale | Seuils (bloquants) |
|-----|--------|-----------------|--------------------|
| API | jest + istanbul, **tout `src/`** (hors `main.ts` et `scripts/`), unitaires **+ e2e fusionnes** | `cd apps/api && npm run test:cov && npm run test:e2e:cov && node ../../tests/coverage/merge-api.js . --min-lines=87 --min-branches=65 --scope=src/params/engine:100:100 --scope=src/params/expr:100:100` | moteurs : 100 % lignes et branches (unitaires seuls, `jest.config.js`) ; global fusionne : voir `.github/workflows/ci.yml` |
| Web | vitest + `@vitest/coverage-v8` (ADR-003), tout `src/` hors tests et mocks | `cd apps/web && npm run test:coverage` | `vite.config.ts` : non-regression globale, `src/lib/expr.ts` |
| Mobile | `flutter test --coverage` + `lcov-check.js` (ajoute les fichiers jamais importes) | `cd apps/mobile && flutter test --coverage && node ../../tests/coverage/lcov-check.js coverage/lcov.info lib --min-total=16 --scope=core/params:79` | lignes seulement (Flutter ne mesure pas les branches) |

Base de donnees des e2e : `TEST_DATABASE_URL` (une base par agent, p. ex. `recallfarm_test_qa`) ; ne jamais partager `recallfarm_test`.

Regle de montee : un seuil ne baisse jamais ; il monte des qu'une mesure le depasse de plus d'un point.
Plan de montee : voir docs/plan/etat.md, « Indicateurs de sante ».

Windows : un dossier cache (`.claude/worktrees/...`) dans le chemin fait echouer les globs `testMatch` de jest ;
les configurations utilisent `testRegex` pour cette raison.
