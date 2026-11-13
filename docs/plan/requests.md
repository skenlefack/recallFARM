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
| 2026-11-10 | integrations | apps/web, apps/mobile (ecran de paiement) | web-frontend, mobile-ecrans | Checkout idempotent : envoyer `id` (UUID v4 cree a l'appui, reutilise pour toute relance du meme paiement) dans `POST /v1/subscriptions/checkout` (ou l'en-tete `Idempotency-Key`). Une relance renvoie `replayed: true` et le meme `payment_id` ; une relance d'un refus renvoie la meme erreur 422 `PAY-INIT`. `409 CONFLICT` (`rule: PAY-IDEMPOTENCY`) si le meme id sert a une autre demande. | Ouvert |
| 2026-11-10 | integrations | apps/web, apps/mobile (suivi du paiement) | web-frontend, mobile-ecrans | Nouveaux statuts de paiement : `a_verifier` (issue inconnue apres plusieurs interrogations : afficher « Paiement en cours de verification, nous vous prevenons »), `remboursement_en_cours`, `rembourse`. `GET /plans` ne renvoie plus que les moyens de paiement reellement branches. | Ouvert |
| 2026-11-10 | integrations | apps/web (administration) | web-frontend | Ecrans admin : liste `GET /v1/admin/payments?status=a_verifier`, bouton « Interroger » (`POST /v1/admin/payments/:id/check`), « Rembourser » avec motif (`POST /v1/admin/payments/:id/refund`, administrateur plateforme), rapports `GET /v1/admin/payments/reconciliations`. | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | .github/workflows/ci.yml (job `mobile`) | devops-sre | Signature release + APK par ABI, detail ci-dessous (R-01) | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | apps/mobile/lib/features/onboarding/consents_screen.dart (l. 41) ou DTO API `/me/consents` | mobile-ecrans (ou api) | **Bug conformite** : E03 envoie `granted_at` dans `POST /me/consents`, l'API repond 422 « granted_at : champ non autorise » (vu sur la recette, integration_test/pilot_journey_test.dart). L'action est marquee `rejected` dans l'outbox : le consentement n'est jamais enregistre cote serveur. Retirer le champ (ou l'accepter cote API, contrat d'abord) + test de contrat. | Corrige (e5f49a3, fix/ci-vague3 ; cherry-pick sur feat/P0.1-mobile-socle) |
| 2026-11-10 | mobile-socle (P0.1) | apps/api/src/sync/sync.service.ts | api | **Performance 2G (cible « 500 changements < 10 s en 2G »)** : mesure sur la recette, `POST /sync/push` de 200 journaux = 4,0 a 4,7 s de traitement serveur (~21 ms par changement : recu, lecture, ecriture, relecture une par une) ; 500 changements = ~8 s cote serveur avant tout reseau. Et `GET /sync/pull` renvoie a l'appareil ses propres changements qu'il vient de pousser (500 lignes re-telechargees en 2G). Demande : traitement par lot du push (une transaction, lectures groupees), et exclure du pull les lignes dont `last_device_id` = appareil appelant et `client_rev` = revision poussee. | Ouvert |
| 2026-11-10 | mobile-socle (P0.1, revue M3) | apps/api (e2e sync), docs/contracts, apps/api/openapi.json | api | **Corps gzip** : le mobile envoie les corps JSON >= 1 Ko avec `Content-Encoding: gzip` (verifie a la main sur la recette : 200). Demande : test e2e `POST /v1/sync/push` avec corps gzip (et un corps gzip invalide -> 400, pas 500), limite de taille apres decompression explicite, et contrat documente (openapi : `Content-Encoding: gzip` accepte sur /v1/sync/push). Le mobile renvoie la requete une fois en JSON simple sur 415 et coupe la compression. | Ouvert |
| 2026-11-13 | integrations (fix/P1.2-pay-open) | apps/mobile/lib/features/subscription/subscription_screen.dart (`_doCheckout`) | mobile-ecrans | **PAY-OPEN (EF-ABO-01)** : `POST /v1/subscriptions/checkout` repond desormais `409 CONFLICT` `details: { rule: 'PAY-OPEN', payment_id, status, plan }` (`status` = `initie`, `en_attente` ou `a_verifier` ; `plan` = formule du paiement ouvert) quand un paiement d'abonnement du meme payeur est encore ouvert, quelle que soit la formule (autre appareil, web, autre id). Rare : `409 PAY-RETRY` (reessayer une fois). `422` si `id` et `Idempotency-Key` sont envoyes et ne designent pas le meme paiement : n'en envoyer qu'un. Aujourd'hui l'ecran tombe dans `showSnack(e.message)` (pas de plantage, mais aucun suivi). Demande : traiter `e.code == 'CONFLICT' && rule == 'PAY-OPEN'` comme `PAY-PENDING` : `_follow(details.payment_id, 'pending_check')` (a_verifier : texte « Paiement en cours de verification, nous vous prevenons »), sans nouvelle tentative. Envoyer aussi un `id` UUID v4 stable par tentative (demande du 2026-11-10). + test widget. | Ouvert |
| 2026-11-13 | integrations (fix/P1.2-pay-open, decision PO) | apps/mobile (ecran abonnement), apps/web (abonnement) | mobile-ecrans, web-frontend | **PAY-RECENT** : `POST /v1/subscriptions/checkout` repond `409 CONFLICT` `details: { rule: 'PAY-RECENT', payment_id, plan, paid_at }` si un paiement d'abonnement du meme payeur a ete confirme il y a moins de 30 min (`PAYMENT_RECENT_GUARD_MIN`). Demande : ecran de confirmation « Vous venez de payer la formule {libelle de plan} il y a {N} min. Payer encore ? » (N calcule depuis `paid_at`, libelle via `GET /plans`), boutons « Non » (retour, rien n'est envoye) et « Payer encore » qui renvoie **le meme checkout avec le meme `id`** et `confirm_repeat` = `details.payment_id` recu dans ce 409 (UUID, plus un booleen ; jamais d'envoi automatique). Si un autre paiement a ete confirme entre-temps, l'API repond un nouveau 409 PAY-RECENT avec ce paiement : reafficher l'ecran avec lui. `confirm_repeat` est ignore s'il n'y a pas de paiement recent. `PAY-OPEN` reste prioritaire et se traite comme avant. Cles i18n fr/en + tests (widget / composant). | Ouvert |
| 2026-11-13 | integrations (fix/P1.2-pay-open) | apps/web (abonnement, admin paiements), apps/web/src/api/types.ts | web-frontend | Reponses aux demandes web du 2026-11-13 : `409 PAY-OPEN` (meme forme que ci-dessus) a suivre comme un paiement en attente ; `GET /v1/payments/:id` et nouveau `GET /v1/admin/payments/:id` renvoient `events: [{ at, status, source: 'webhook' \| 'statut' \| 'operateur' }]` (journal nettoye : pas de corps brut ; vue administration : evenements refuses avec `ignored: true, reason: 'montant' \| 'devise' \| 'connecteur'`, absents de la vue payeur ; les evenements `audit_log` de remboursement ne sont pas inclus, voir `refund`) ; nouvel ecran admin : `POST /v1/admin/payments/:id/resolve` `{ outcome: 'confirme' \| 'echoue', reason }` (platform_admin seulement, depuis `a_verifier`, sinon 409 `PAY-RESOLVE-STATUS`) ; schemas OpenAPI ajoutes (`PaymentView`, `AdminPaymentView`, `AdminPaymentListView`, `CheckoutResultView`, `CheckoutConflictView`, `PlansView`, `ReconciliationReportView`, `ReconciliationListView`, `PaymentCheckView`, `PaymentRefundView`) ; `GET /plans` : `currency` = devise du pack pays, `422 PAY-CURRENCY` si le pays n'en a pas ; `/subscriptions/current` : `price: null` si la devise est introuvable. | Ouvert |

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

| Date | Demandeur | Fichier(s) | Proprietaire | Action demandee | Statut |
|------|-----------|------------|--------------|-----------------|--------|
| 2026-11-12 | securite-conformite | apps/api/src/imports-exports/imports-exports.controller.ts | backend-economie-reseau | **Fait dans fix/api-cve-high, a relire** : `FileInterceptor` remplace par `SafeFileInterceptor` (apps/api/src/common/security/multipart.ts). Sans les limites opt-in de multer 2.5, un champ `b[999999999]` bloquait le CPU > 60 s (constat eleve). Regle : tout televersement utilise `SafeFileInterceptor`. | A relire |
| 2026-11-12 | securite-conformite | apps/api/package.json, package-lock.json, apps/api/Dockerfile | backend-elevage / devops-sre | **Fait dans fix/api-cve-high, a relire** (ferme la demande « 22 CVE HIGH » du 2026-11-10) : `overrides` portes par `@nestjs/platform-express` (body-parser 1.20.9, multer 2.5.0) et `@nestjs/swagger` (js-yaml 4.3.2, lodash 4.18.1) ; stage runtime : `apk upgrade`, suppression de npm/npx/corepack/yarn. | A relire |
| 2026-11-12 | securite-conformite | .github/workflows/ci.yml (job `security` et publication d'images) | devops-sre | Ajouter `no-cache-filters: runtime` a `docker/build-push-action` : sinon la couche `apk upgrade` reste en cache gha tant que le digest de base ne change pas (vu en local : 3 HIGH libxslt sur l'image web, 0 apres reconstruction du stage runtime). | Ouvert |
| 2026-11-12 | securite-conformite | apps/api/src/common/error.filter.ts | backend-elevage | Faible : les erreurs body-parser (ex. `Content-Encoding: gzip` invalide, `err.status` 400/415) sortent en 500 « Erreur interne ». Rendre `err.status`/`err.statusCode` 4xx en 422/415 `VALIDATION_ERROR`. | Ouvert |
| 2026-11-12 | securite-conformite | apps/api/test (e2e) | qa-automatisation | Ajouter un e2e d'import multipart (`.csv` et `.xlsx`) : aujourd'hui seule la variante JSON `csv` est couverte, la mise a jour de multer n'est prouvee que par le test unitaire de `SafeFileInterceptor` et un essai manuel sur l'image. | Ouvert |
