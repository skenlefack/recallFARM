# RecallFarm — MVP

Plateforme web et mobile de gestion d'élevage et d'activité canine pour l'Afrique francophone :
**hors ligne d'abord**, **paramétrable** (les règles d'espèce et de pays sont des packs, pas du code), **rappels multicanaux**
(application, SMS, USSD, WhatsApp), paiement par **mobile money**.

Ce dépôt est le MVP décrit par le dossier de développement v2.2 (`07-roadmap-backlog.md`, lot MVP), avec les interfaces
issues du canevas de design RecallFarm.

## Contenu

| Dossier | Contenu |
|---|---|
| `apps/api` | API NestJS + PostgreSQL : authentification OTP, exploitations, cheptel, journal, santé et moteur de rappels, stocks et ventes, certificats QR, abonnements et mobile money, notifications, paramétrage et studio, synchronisation, imports et exports, tableau de bord d'organisation, démonstration capteurs |
| `apps/web` | React : site public de commercialisation, console d'administration (Structure), studio de paramétrage, vérification publique des certificats |
| `apps/mobile` | Flutter : application de l'éleveur, base locale chiffrée, synchronisation, moteurs embarqués (formulaires, rappels, expressions) |
| `packages/params` | packs `global.core`, `filiere.volaille`, `filiere.canin`, `pays.CM` ; spécifications des expressions et des moteurs ; **vecteurs de test communs** au serveur et au mobile |
| `infra` | passerelle nginx, initialisation PostgreSQL, script de sauvegarde |
| `docs` | périmètre et contrat du MVP, guide de déploiement, maquettes de référence, captures |

## Démarrage rapide (Docker)
```bash
make up                         # ou : cp .env.example .env (remplir) && docker compose up -d --build
open http://localhost:8080      # site public
open http://localhost:8080/admin  # console : +237690000002, le code s'affiche en mode démo
```
Comptes de démonstration : voir `docs/MVP-SCOPE.md` §2. Application mobile : `apps/mobile/README.md`.

## Développement sans Docker
- API : `cd apps/api && cp .env.example .env && npm ci && npm run migration:run && npm run seed && npm run start:dev`
- Web : `cd apps/web && npm ci && npm run dev` (proxy `/v1` vers `localhost:3000`) ou `VITE_MOCK=1 npm run dev` sans API
- Mobile : `cd apps/mobile && flutter pub get && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080/v1`

## Tests
`make test` (API : unitaires + parcours e2e du pilote ; web : unitaires + build). Les vecteurs de `packages/params/vectors`
sont exécutés par l'API, le web (évaluateur d'expressions) et le mobile : la règle RG-PAR-02 (résultats identiques
partout) est ainsi vérifiée en CI (`.github/workflows/ci.yml`).

## Documentation
- `docs/MVP-SCOPE.md` — périmètre, contrat d'API, écrans
- `docs/DEPLOIEMENT.md` — installation, HTTPS, mises à jour, sauvegardes, fournisseurs réels
- `apps/*/README.md` — détails par application
- Dossier de développement v2.2 et document conceptuel : projet recallFARM
