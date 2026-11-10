# RecallFarm — regles du depot (lues par toutes les instances Claude Code)

## Produit
Plateforme d'elevage et d'activite canine pour l'Afrique francophone : hors ligne d'abord,
parametrable (les regles d'espece et de pays sont des PACKS, jamais du code), rappels
multicanaux (app, SMS, USSD, WhatsApp, voix), paiement mobile money. Utilisateurs : eleveurs
sur Android d'entree de gamme en 2G, cooperatives, veterinaires, services veterinaires.

## Sources de verite (dans cet ordre)
1. docs/plan/ (lot en cours, decisions validees par le proprietaire du produit)
2. docs/dossier/ (dossier v2.2 : 01 exigences, 02 ecrans, 03 donnees, 05 API, 12 parametrage,
   13 IoT, 14 normes, 15 exploitation, 16 methodes, 17 pilote) — les ID EF-/RG-/ENF-/T- font foi
3. docs/contracts/ et apps/api/openapi.json (contrats d'API), packages/params (packs, specs, vecteurs)
4. docs/design/*.dc.html (maquettes : couleurs, espacements, textes a reproduire fidelement)
En cas de contradiction : arreter, l'ecrire dans docs/plan/questions.md, demander a l'orchestrateur.

## Architecture
- apps/api : NestJS 10, TypeORM 0.3, PostgreSQL 16 + PostGIS, Redis. Monolithe modulaire, /v1.
- apps/web : React 18 + Vite + TS strict, react-query, CSS a jetons (pas de kit UI), graphiques SVG faits main.
- apps/mobile : Flutter 3.24, Riverpod, go_router, dio, sqflite_sqlcipher. Aucune generation de code.
- packages/params : packs JSON signes, EXPRESSIONS.md, ENGINES.md, vecteurs communs.
- infra : compose, nginx, scripts. Toute dependance nouvelle = une ADR courte dans docs/adr/.

## Regles non negociables
- Le code ne connait aucune espece ni aucun pays : tout comportement specifique vient d'un pack.
- Parite des moteurs (RG-PAR-02) : toute regle de moteur existe en TypeScript ET en Dart et passe
  les memes vecteurs de packages/params/vectors. Un vecteur ne se modifie qu'avec l'accord de
  l'architecte et une entree au CHANGELOG des vecteurs.
- Montants : entier en unite mineure ISO 4217 + devise. Jamais de flottant, jamais "FCFA" en dur.
- Identifiants UUID v4 crees par le client ; POST idempotent ; champs de synchro sur chaque entite.
- Dates metier YYYY-MM-DD dans le fuseau du pays (Africa/Douala pour CM) ; horodatages UTC.
- Interface en francais, cles i18n pour l'anglais. Textes courts, humains, sans jargon.
- Hors ligne d'abord : toute action de l'eleveur fonctionne sans reseau et se synchronise.
- Securite : aucun secret dans le depot, validation stricte des entrees, autorisation par role ET
  par portee, donnees de surveillance toujours agregees (k >= 5), consentement avant tout partage.
- Jamais : desactiver un test, affaiblir une assertion, `any` non justifie, `// @ts-ignore`,
  `catch {}` silencieux, mock en production, migration destructive sans plan de retour.

## Travail en equipe d'agents
- Une branche + un worktree par agent : feat/<lot>-<agent>. Ne modifier que les chemins possedes
  (voir .claude/agents/<agent>.md). Besoin ailleurs = demande ecrite dans docs/plan/requests.md.
- Contrat d'abord : un changement d'API commence par openapi.json + test de contrat, puis le code.
- Petits commits conventionnels (feat:, fix:, test:, refactor:, docs:, chore:) avec l'ID d'exigence.

## Definition de "termine" (DoD)
Une tache n'est terminee que si TOUT est vrai, preuves a l'appui dans le rapport :
1. Exigences couvertes listees par ID (EF-/RG-) avec le test qui prouve chacune.
2. Lint + typage sans erreur ; tests unitaires et e2e du perimetre verts ; couverture >= 80 %
   des lignes sur le code nouveau (moteurs : 100 % des branches).
3. Execute pour de vrai : commande lancee, sortie collee (API demarree, ecran capture, APK installe...).
4. Migrations reversibles testees (up, down, up) ; seed toujours idempotent.
5. OpenAPI regenere et coherent ; clients web et mobile alignes.
6. Accessibilite AA et i18n verifiees pour tout ecran ; fidelite aux maquettes controlee.
7. Revue independante par `relecteur` sans point bloquant ouvert.
8. Documentation mise a jour (README du module, CHANGELOG, runbook si exploitation).

## Commandes
- API : cd apps/api && npm run lint && npm run build && npm test && npm run test:e2e
- Web : cd apps/web && npm run lint && npm test && npm run build
- Mobile : cd apps/mobile && flutter analyze && flutter test && flutter build apk --debug
- Pile : make up | make seed | make demo | make test

## Format du rapport de fin de tache
Resume (3 lignes) ; exigences couvertes (ID -> test) ; commandes executees et resultats ;
fichiers modifies ; ecarts au dossier et pourquoi ; questions ouvertes ; risques restants.
