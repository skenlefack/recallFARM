# RecallFarm — Demandes inter-agents

Quand un agent a besoin de modifier un fichier qu'il ne possede pas, il ecrit sa demande ici.
L'orchestrateur la route vers le proprietaire du fichier.

| Date | Demandeur | Fichier(s) | Proprietaire | Action demandee | Statut |
|------|-----------|------------|--------------|-----------------|--------|
| 2026-11-10 | mobile-ecrans | apps/mobile/lib/core/i18n/strings_{fr,en}.dart | mobile-socle | Fusionner les cles de apps/mobile/lib/features/subscription/subscription_strings.dart (pay_*, plans_retry) dans le catalogue central, puis supprimer SubTr. Les cles pay_orange_money / pay_mtn_momo ne sont plus utilisees (libelles = pack pays) et peuvent etre retirees. | ouverte |
| 2026-11-10 | qa-automatisation | apps/web/Dockerfile (stage runtime) | devops-sre | **Bloquant CI** : le scan Trivy (CRITICAL bloquant) echoue sur l image web : 3 CVE CRITICAL corrigeables dans nginx-unprivileged:1.27-alpine (libssl3, libcrypto3 3.3.3-r0 -> 3.3.7-r2, brotli-libs 1.1.0-r2 -> 1.1.1-r0), y compris avec la base la plus recente. Verifie : un `apk upgrade --no-cache` les corrige. Ajouter dans le stage runtime `USER root` / `RUN apk upgrade --no-cache` / `USER 101` | Ouvert |
| 2026-11-10 | qa-automatisation | apps/api/src/users/auth.service.ts | backend-elevage | Defaut D-QA-01 : `mergeProvisionalAccount` execute `UPDATE devices SET user_id` (colonne inexistante) : le login avec `provisional_user_id` repond 500 (EF-AUT-02). Supprimer cette requete ; puis remplacer `it.failing` par `it` dans apps/api/test/recette-mvp.e2e-spec.ts | Ouvert |
| 2026-11-10 | qa-automatisation | apps/api/src/livestock/livestock.service.ts (+ DTO) | backend-elevage | Defaut D-QA-02 : `PATCH /batches/:id` partiel repond 422 (des champs `undefined` des DTO ecrasent les valeurs stockees dans `{...serializeBatch(existing), ...clean}`). Filtrer les `undefined` ; verifier aussi `PATCH /dogs/:id` et animaux ; remplacer `it.failing` par `it` | Ouvert |
| 2026-11-10 | qa-automatisation | apps/api/src/analytics/analytics.controller.ts, apps/api/src/misc/misc.controller.ts | backend-economie-reseau | Defaut D-QA-03 : deux routes d evenements d usage (`/v1/analytics/events` et `/v1/v1/analytics/events`, prefixe double). Garder une seule route avec le catalogue ferme et l opt-out ; aligner openapi.json et les clients | Ouvert |
| 2026-11-10 | qa-automatisation | apps/api/package.json (dependances) | backend-elevage / devops-sre | 22 CVE HIGH corrigeables dans l image API (mesure Trivy 0.57.1, 2026-11-10) : body-parser, brace-expansion, ip-address, js-yaml, lodash, multer, pacote, picomatch, sigstore, etc. Mettre a jour ou surcharger (`overrides`) ; le rapport HIGH du job CI `security` les liste | Ouvert |
| 2026-11-10 | qa-automatisation | apps/mobile/test/engines | moteurs-parametrage / mobile-socle | Moteurs Dart : lignes couvertes 81 a 93 % (alors que les moteurs TS sont a 100 % des branches). Ajouter les memes cas que apps/api/src/params/**/*.branches.spec.ts (parite RG-PAR-02) ; ensuite passer les seuils de la CI (.github/workflows/ci.yml, job mobile) a 100 | Ouvert |
| 2026-11-10 | qa-automatisation | apps/web/src (tests), apps/mobile/test | web-frontend / mobile-ecrans | Ajouter l ID d exigence (EF-/RG-/T-) dans le titre des tests concernes, comme dans apps/api/test (non fait ici pour eviter des conflits avec les agents en cours) ; liste dans docs/plan/tracabilite-mvp.md | Ouvert |
| 2026-11-10 | integrations | apps/web, apps/mobile (ecran de paiement) | web-frontend, mobile-ecrans | Checkout idempotent : envoyer `id` (UUID v4 cree a l'appui, reutilise pour toute relance du meme paiement) dans `POST /v1/subscriptions/checkout` (ou l'en-tete `Idempotency-Key`). Une relance renvoie `replayed: true` et le meme `payment_id` ; une relance d'un refus renvoie la meme erreur 422 `PAY-INIT`. `409 CONFLICT` (`rule: PAY-IDEMPOTENCY`) si le meme id sert a une autre demande. | Fait cote web (feat/P1.2-web-paiements, 2026-11-13) |
| 2026-11-10 | integrations | apps/web, apps/mobile (suivi du paiement) | web-frontend, mobile-ecrans | Nouveaux statuts de paiement : `a_verifier` (issue inconnue apres plusieurs interrogations : afficher « Paiement en cours de verification, nous vous prevenons »), `remboursement_en_cours`, `rembourse`. `GET /plans` ne renvoie plus que les moyens de paiement reellement branches. | Fait cote web (feat/P1.2-web-paiements, 2026-11-13) |
| 2026-11-10 | integrations | apps/web (administration) | web-frontend | Ecrans admin : liste `GET /v1/admin/payments?status=a_verifier`, bouton « Interroger » (`POST /v1/admin/payments/:id/check`), « Rembourser » avec motif (`POST /v1/admin/payments/:id/refund`, administrateur plateforme), rapports `GET /v1/admin/payments/reconciliations`. | Fait cote web (feat/P1.2-web-paiements, 2026-11-13) |
| 2026-11-13 | web-frontend (P1.2) | apps/api/src/billing/admin-payments.controller.ts, apps/api/openapi.json | api (backend-economie-reseau) | **Detail d'un paiement** : il n'existe pas de `GET /v1/admin/payments/:id` ni de journal d'evenements. L'ecran « Paiements » reconstitue l'historique a partir de la ligne de liste (`created_at`, `error_code`, `poll`, `paid_at`, `refund`). Demande : `GET /v1/admin/payments/:id` renvoyant `events: [{ at, type, detail, actor }]` (creation, initiation, interrogations, webhook, remboursement demande/termine, tires de `audit_log`) pour un vrai historique, et le meme champ `events` dans la liste est inutile (detail seulement). | Ouvert |
| 2026-11-13 | web-frontend (P1.2) | apps/api/openapi.json (+ DTO de reponse) | api | **Client type genere impossible pour les paiements** : toutes les reponses de `/v1/admin/payments*`, `/v1/payments/:id`, `/v1/subscriptions/checkout` et `/v1/plans` sont `{"description": ""}` (aucun schema). Ajouter des classes de reponse `@ApiProperty` (PaymentView, AdminPaymentView, CheckoutResult, ReconciliationReport, PlansResponse) ; le web a type ces formes a la main dans apps/web/src/api/types.ts (a remplacer par la generation). | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | .github/workflows/ci.yml (job `mobile`) | devops-sre | Signature release + APK par ABI, detail ci-dessous (R-01) | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | apps/mobile/lib/features/onboarding/consents_screen.dart (l. 41) ou DTO API `/me/consents` | mobile-ecrans (ou api) | **Bug conformite** : E03 envoie `granted_at` dans `POST /me/consents`, l'API repond 422 « granted_at : champ non autorise » (vu sur la recette, integration_test/pilot_journey_test.dart). L'action est marquee `rejected` dans l'outbox : le consentement n'est jamais enregistre cote serveur. Retirer le champ (ou l'accepter cote API, contrat d'abord) + test de contrat. | Corrige (e5f49a3, fix/ci-vague3 ; cherry-pick sur feat/P0.1-mobile-socle) |
| 2026-11-10 | mobile-socle (P0.1) | apps/api/src/sync/sync.service.ts | api | **Performance 2G (cible « 500 changements < 10 s en 2G »)** : mesure sur la recette, `POST /sync/push` de 200 journaux = 4,0 a 4,7 s de traitement serveur (~21 ms par changement : recu, lecture, ecriture, relecture une par une) ; 500 changements = ~8 s cote serveur avant tout reseau. Et `GET /sync/pull` renvoie a l'appareil ses propres changements qu'il vient de pousser (500 lignes re-telechargees en 2G). Demande : traitement par lot du push (une transaction, lectures groupees), et exclure du pull les lignes dont `last_device_id` = appareil appelant et `client_rev` = revision poussee. | Ouvert |
| 2026-11-10 | mobile-socle (P0.1, revue M3) | apps/api (e2e sync), docs/contracts, apps/api/openapi.json | api | **Corps gzip** : le mobile envoie les corps JSON >= 1 Ko avec `Content-Encoding: gzip` (verifie a la main sur la recette : 200). Demande : test e2e `POST /v1/sync/push` avec corps gzip (et un corps gzip invalide -> 400, pas 500), limite de taille apres decompression explicite, et contrat documente (openapi : `Content-Encoding: gzip` accepte sur /v1/sync/push). Le mobile renvoie la requete une fois en JSON simple sur 415 et coupe la compression. | Ouvert |

### R-01 — CI mobile : APK release signe et par ABI (P0.1, ENF taille < 25 Mo)

La config Gradle (apps/mobile/android/app/build.gradle.kts) lit la cle depuis l'environnement ;
**sans cle, toute tache release echoue** (revue M1) ; `RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE=true`
autorise une release signee en debug (essais). Les builds debug ne sont jamais bloques.
Changements demandes dans le job `mobile` :

1. Secrets GitHub (environnement `release`) : `ANDROID_KEYSTORE_BASE64` (keystore upload encode
   en base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
2. Avant le build :
   ```yaml
   - name: Keystore release
     run: |
       if [ -n "$ANDROID_KEYSTORE_BASE64" ]; then
         echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/upload.jks"
       fi
     env: { ANDROID_KEYSTORE_BASE64: "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" }
   ```
3. Build (remplace la ligne actuelle) :
   ```yaml
   - run: flutter build apk --release --split-per-abi --target-platform android-arm,android-arm64 --dart-define=API_BASE_URL=...
     env:
       ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/upload.jks
       ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
       ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
       ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
       # PR sans secrets : release d'essai signee en debug ; main : la cle est obligatoire
       RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE: ${{ github.ref != 'refs/heads/main' && 'true' || 'false' }}
   ```
   Sur `main` le build echoue sans cle ; sur les PR (secrets absents) il est signe en debug (artefact d'essai,
   a ne pas publier). Sans cette variable, le `flutter build apk --release` actuel de la CI echouera.
4. Garde de taille (ENF < 25 Mo) apres le build :
   ```yaml
   - run: |
       for f in build/app/outputs/flutter-apk/app-*-release.apk; do
         s=$(stat -c %s "$f"); echo "$f $s"; test "$s" -lt 26214400 || { echo "APK > 25 Mo"; exit 1; }
       done
   - run: rm -f "$RUNNER_TEMP/upload.jks"
     if: always()
   ```
5. Artefact : `path: apps/mobile/build/app/outputs/flutter-apk/app-*-release.apk` (le nom
   `app-release.apk` n'existe plus avec `--split-per-abi`).
6. Facultatif (job manuel, emulateur) : `flutter test integration_test/... --dart-define=API_BASE_URL=...`
   via `reactivecircus/android-emulator-runner` contre la pile docker du job (voir apps/mobile/README.md §9).
