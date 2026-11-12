# ADR-006 — SheetJS (xlsx) 0.20.3 depuis le CDN officiel de l'editeur

Statut : ACCEPTE (proprietaire du produit, 2026-11-13, Q-SEC-01)

## Contexte
L'import d'eleveurs (`POST /v1/imports`) lit les fichiers `.xlsx` avec SheetJS. La version 0.18.5,
derniere publiee sur le registre npm, porte deux CVE HIGH atteignables (CVE-2023-30533 pollution de
prototype, CVE-2024-22363 ReDoS). L'editeur ne publie plus sur npm : les versions corrigees ne sont
distribuees que par `https://cdn.sheetjs.com`. La revue de securite a aussi montre que la limite de
5 Mo ne borne que la taille compressee : un classeur decompresse et analyse de facon synchrone peut
figer l'API ou la faire tomber en memoire (serveur partage, `mem_limit` 448 Mo).

## Decision
- `xlsx` 0.20.3, archive officielle `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` versionnee
  dans `apps/api/vendor/` (2,4 Mo) et referencee `file:vendor/xlsx-0.20.3.tgz` ; empreinte `sha512`
  identique a celle du CDN, figee dans `apps/api/package-lock.json` (`npm ci` refuse toute archive
  differente). Le build ne depend donc pas de la disponibilite du CDN (injoignable depuis le build
  Docker local lors de l'essai).
- Avant `XLSX.read` : controle du repertoire central du zip (`src/imports-exports/xlsx-guard.ts`) —
  taille decompressee declaree <= 40 Mo, <= 2 000 entrees, pas de zip64 — et lecture bornee a
  20 000 lignes (`sheetRows`).
- Plancher de version teste (`src/common/security/dependency-floors.spec.ts`, xlsx >= 0.20.2).

## Consequences
- Une dependance hors du registre npm : la mise a jour se fait a la main (surveiller les annonces
  de SheetJS) ; Trivy et `npm audit` continuent de la scanner via le verrou.
- Mise a jour : telecharger la nouvelle archive du CDN, verifier son empreinte, remplacer le fichier
  de `vendor/` puis `npm install ./vendor/<archive>`.
- Alternatives ecartees : import CSV seul (une etape de plus pour les gestionnaires), garder 0.18.5
  en risque accepte (CVE atteignables), autre bibliotheque (reecriture et nouvelle surface).
- Risque residuel : une taille declaree mensongere dans le zip n'est pas detectee par le controle ;
  `sheetRows`, le throttler et le role gestionnaire requis la bornent.
