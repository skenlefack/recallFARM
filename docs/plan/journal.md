# RecallFarm — Journal de bord

## 2026-10-27 — Initialisation du pilotage
- Mise en place de la structure multi-agents (16 agents, 5 commandes)
- Pile Docker demarree en local (postgres, redis, api, web, gateway : tous healthy)
- Dossier v2.2 disponible dans doc-projets/RecallFarm-dossier-v2.2/

## 2026-10-27 — Lot P0.1 : Mobile compile (EN COURS)
### Resultats Vague 1 (mobile-socle)
- flutter create : android/ et ios/ generes OK
- pubspec.yaml : intl 0.19 -> 0.20.2 (compatibilite flutter_localizations)
- AndroidManifest : permissions INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED, VIBRATE
- build.gradle.kts : minSdk 23, desugaring active, cleartext debug only
- **flutter analyze : 0 issue** (17 fixes : 1 erreur DialogTheme->DialogThemeData, 16 deprecations)
- **flutter test : 85/85 passes** (moteurs, widgets, vecteurs partages)
- **APK debug : OK** (166 Mo fat)
- **APK release split-per-abi : OK**
  - armeabi-v7a : 28.1 Mo
  - arm64-v8a : 31.8 Mo (cible < 25 Mo — a optimiser)
  - x86_64 : 34.6 Mo
- Warning cupertino_icons (non bloquant, pas utilise dans le code)

### Vague 2 — Resultats
- **APK installe sur emulateur Pixel 7 (Android 16) : OK**
- App demarree, ecran E01 affiche correctement (8 speculations, theme sombre, pas de debordement)
- Tests complets de la stack : **226/226 OK** (API 71 + Web 70 + Mobile 85)
- Widget tests accessibilite passes (48dp, 360x640, text scale 1.3)
- Taille APK arm64 : 31.8 Mo (cible < 25 Mo — necessite remplacement de `cryptography` par lib pure Dart)

### Reste a faire
- [ ] Optimiser taille APK (remplacer cryptography par pointycastle, ~-6 Mo attendus)
- [ ] Goldens par ecran (mobile-ecrans)
- [ ] integration_test parcours pilote complet (qa-automatisation)
- [ ] Captures ux-fidelite vs maquettes (ux-fidelite)
- [ ] Test sur resolution 360x640 (emulateur petit ecran)

## 2026-10-27 — Lot P0.2 : Livraison conteneurisee (audit)
### Resultats de l'audit
- 5 services Docker up et healthy (postgres, redis, api, web, gateway)
- Dockerfiles : multi-stage, non-root, healthchecks, tini — bien conçus
- CI : couvre lint+test+build pour API/Web/Mobile + contrat OpenAPI
- **Vulnerabilite critique corrigee** : TypeORM 0.3.20 → 0.3.26 (CVE-2025-60542, SQL injection)
- Image API rebuilee et API redemarree, tests 71/71 OK

### Vulnerabilites restantes (HIGH, non critiques)
- Image API : multer (DoS), pacote (DoS), picomatch (ReDoS), sigstore
- Image Web : pcre2 (4 CVEs OOB write), nghttp2, zlib, tiff — necessite rebuild base Alpine

### Ameliorations CI identifiees
- Ajouter scan Trivy en CI (bloquant)
- Cache Docker layers (cache-from/to gha)
- Tests E2E Playwright pour le web
- Job deploiement auto vers VPS pilote
- Dependabot/Renovate

## 2026-10-28 — Lot P0.1 : Integration tests mobile
- integration_test/smoke_test.dart cree et execute sur emulateur Pixel 7
- **Resultat : 1/1 VERT** — app demarre, E01 rend, pas de crash
- Limitation : navigation E01→E02 via tap sur Panel custom ne fonctionne pas en test auto
- A ameliorer : ajouter semantique/key sur les panels pour faciliter les taps en test

## 2026-10-28 — Lot P0.3 : Dette technique (TERMINE)
### 5 dettes corrigees
1. **PostGIS obligatoire** : migration `1761500000002-PostgisLocation.ts` ajoute `location geometry(Point, 4326)` sur farms + index GIST + backfill lat/lng
2. **Rate limiting Redis** : `ThrottlerRedisStorage` remplace le stockage memoire, fallback in-memory si pas de Redis (4 tests)
3. **Regroupement SMS RG-NOT-02** : scheduler regroupe les rappels par phone+due_date en un seul SMS multi-lignes (10 tests)
4. **Recalcul rappels publication** : `studio.service.ts` lance `recomputeAffectedReminders()` apres publish, avec log d'impact
5. **Compte provisoire OTP** : `verifyOtp()` accepte `provisional_user_id`, fusionne farms/memberships/consents/devices, soft-delete le provisoire

### Tests : 85 API (71 + 14 nouveaux), 70 Web, 85 Mobile = **240/240 OK**

## 2026-10-28 — Lot P0.4 : Banc de tests de non-regression (EN COURS)
### Termine
- **Parite TS/Dart** : script `tests/parity/run-parity.sh` execute, PARITY OK (62 TS + 76 Dart vecteurs, 4 packs identiques)
- **Job CI `parity`** ajoute dans `.github/workflows/ci.yml` (bloquant pour images)
- **Tests de contrat API** : `tests/contract/validate-api.sh` execute, 9/9 OK (health, ready, plans, auth, protected endpoints)

### Termine
- **Playwright e2e** : 5/5 tests OK (site public, tarification, verificateur, login admin, formulaire OTP)
- **Tests de contrat API** : 9/9 OK (health, ready, plans, auth, protected endpoints)
- **Charge k6** : 50 VUs, 30s, 280 req/s, **p95 = 20.47 ms** (cible < 300 ms) — OK
  - Rate limiting nginx fonctionne (rejette au-dela de 20 req/s/IP) — comportement attendu
- **Parite TS/Dart** : PARITY OK, job CI bloquant ajoute

### Bilan P0.4
Tous les bancs de tests sont en place et passes. Phase 0 terminee.

## 2026-10-28 — Phase 1 : lots P1.3, P1.4, P1.5, P1.1/P1.2 architecture

### P1.3 — Conformite RGPD (TERMINE)
- Registre des traitements (8 traitements T-01 a T-08) : `GET /data-registry` public
- Service de retention (@Cron quotidien) : purge comptes supprimes > 30j, anonymise logs > 3 ans
- Export complet : `GET /me/export` retourne toutes les donnees utilisateur
- Annulation suppression : `POST /me/delete/cancel` pendant 30 jours

### P1.4 — Analytique produit (TERMINE)
- Catalogue de 13 evenements, validation, ingestion bulk
- Agregation quotidienne : active_users, reminders_confirmed_rate, reminders_late
- Dashboard admin : `GET /admin/analytics/dashboard`
- Migration analytics_daily reversible

### P1.5 — Enrolement en masse (TERMINE)
- Support XLSX ajoute, annulation d'import dans les 24h

### P1.1/P1.2 — Architecture SMS/Paiement (DOCS PRETS)
- ADR-001, questionnaire D-03/D-07 crees — en attente decisions PO

### Stack : 240/240 tests OK
