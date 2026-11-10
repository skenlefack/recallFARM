# RecallFarm — Demandes inter-agents

Quand un agent a besoin de modifier un fichier qu'il ne possede pas, il ecrit sa demande ici.
L'orchestrateur la route vers le proprietaire du fichier.

| Date | Demandeur | Fichier(s) | Proprietaire | Action demandee | Statut |
|------|-----------|------------|--------------|-----------------|--------|
| 2026-11-10 | mobile-socle (P0.1) | .github/workflows/ci.yml (job `mobile`) | devops-sre | Signature release + APK par ABI, detail ci-dessous (R-01) | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | apps/mobile/lib/features/onboarding/consents_screen.dart (l. 41) ou DTO API `/me/consents` | mobile-ecrans (ou api) | **Bug conformite** : E03 envoie `granted_at` dans `POST /me/consents`, l'API repond 422 « granted_at : champ non autorise » (vu sur la recette, integration_test/pilot_journey_test.dart). L'action est marquee `rejected` dans l'outbox : le consentement n'est jamais enregistre cote serveur. Retirer le champ (ou l'accepter cote API, contrat d'abord) + test de contrat. | Ouvert |
| 2026-11-10 | mobile-socle (P0.1) | apps/api/src/sync/sync.service.ts | api | **Performance 2G (cible « 500 changements < 10 s en 2G »)** : mesure sur la recette, `POST /sync/push` de 200 journaux = 4,0 a 4,7 s de traitement serveur (~21 ms par changement : recu, lecture, ecriture, relecture une par une) ; 500 changements = ~8 s cote serveur avant tout reseau. Et `GET /sync/pull` renvoie a l'appareil ses propres changements qu'il vient de pousser (500 lignes re-telechargees en 2G). Demande : traitement par lot du push (une transaction, lectures groupees), et exclure du pull les lignes dont `last_device_id` = appareil appelant et `client_rev` = revision poussee. | Ouvert |

### R-01 — CI mobile : APK release signe et par ABI (P0.1, ENF taille < 25 Mo)

La config Gradle (apps/mobile/android/app/build.gradle.kts) lit la cle depuis l'environnement ;
sans cle, elle signe en debug avec un avertissement ; avec `RECALLFARM_REQUIRE_RELEASE_SIGNING=true`
elle echoue. Changements demandes dans le job `mobile` :

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
       RECALLFARM_REQUIRE_RELEASE_SIGNING: ${{ github.ref == 'refs/heads/main' && 'true' || 'false' }}
   ```
   Sur `main` le build echoue sans cle ; sur les PR (secrets absents) il reste signe en debug.
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
