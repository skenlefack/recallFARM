# RecallFarm — application mobile (Flutter)

Application éleveur **hors ligne d'abord** (volaille + chiens, Afrique francophone), Android d'abord.
Flutter 3.24 / Dart 3.5, Riverpod 2, go_router 14, SQLCipher, **aucune génération de code**.

> ⚠️ Ce code a été écrit sans SDK Flutter disponible (environnement sans accès à pub.dev). Il n'a donc
> **jamais été compilé ni exécuté**. Voir « Vérifications au premier `flutter analyze` » en bas de page.

---

## 1. Bootstrap

Les dossiers de plateforme ne sont pas versionnés. Depuis `apps/mobile` :

```bash
flutter create --platforms=android,ios --org app.recallfarm --project-name recallfarm .
flutter pub get
flutter analyze
flutter test
```

`flutter create .` n'écrase ni `lib/`, ni `test/`, ni `pubspec.yaml` (le fichier `test/widget_test.dart`
existe justement pour que le gabarit « compteur » ne soit pas généré). La CI du dépôt fait la même chose
(`test -d android || flutter create --platforms=android ...`).

### Android — à ajouter après `flutter create`

`android/app/src/main/AndroidManifest.xml` (dans `<manifest>`) :

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>   <!-- facultatif : l'app planifie en « inexact » -->
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/> <!-- alerte critique plein écran -->
<!-- <uses-permission android:name="android.permission.CAMERA"/>  si mobile_scanner est ajouté (scan de puce / QR) -->
```

et dans `<application>` (récepteurs de flutter_local_notifications pour la replanification au redémarrage) :

```xml
<receiver android:exported="false" android:name="com.dexterous.flutterlocalnotifications.ScheduledNotificationReceiver"/>
<receiver android:exported="false" android:name="com.dexterous.flutterlocalnotifications.ScheduledNotificationBootReceiver">
  <intent-filter>
    <action android:name="android.intent.action.BOOT_COMPLETED"/>
    <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
  </intent-filter>
</receiver>
```

Pour un serveur de dev en HTTP (`http://10.0.2.2:8080`), ajouter `android:usesCleartextTraffic="true"` sur
`<application>` **en debug uniquement** (ou un `network_security_config` limité à 10.0.2.2 / IP du poste).

`android/app/build.gradle` :

```gradle
android {
    compileSdk 34
    defaultConfig { minSdk 23 }            // dossier 08 vise Android 8 (API 26) : 23 ≤ 26, compatible
    compileOptions {
        coreLibraryDesugaringEnabled true  // requis par flutter_local_notifications 17
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}
dependencies { coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.0.4' }
```

APK léger (ENF-PER-04 ≤ 25 Mo) : `flutter build apk --release --split-per-abi`.

### iOS (plus tard)
`Info.plist` : rien d'obligatoire pour le MVP ; `NSCameraUsageDescription` si un scanner est ajouté.

## 2. Lancer contre la pile docker locale

```bash
# à la racine du dépôt
docker compose up -d          # gateway nginx :8080 → /v1 → api
(cd apps/api && npm run seed) # comptes de démo (OTP_DEV_ECHO=true renvoie dev_code)

# émulateur Android
cd apps/mobile
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080/v1
# appareil réel sur le même Wi-Fi
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:8080/v1
```

Compte de démo : `+237 690000001` (Marthe, Pro). En debug, le code OTP renvoyé par l'API (`dev_code`)
s'affiche sous le champ.

### `--dart-define`

| Clé | Défaut | Rôle |
|---|---|---|
| `API_BASE_URL` | `http://10.0.2.2:8080/v1` | base de l'API (gateway) |
| `DEFAULT_COUNTRY` | `CM` | pays prérempli (E04) |
| `ALLOW_FONT_FETCHING` | `true` | google_fonts peut télécharger les polices ; mettre `false` quand elles sont embarquées |

### Polices hors ligne
Les maquettes utilisent Bricolage Grotesque (titres), IBM Plex Sans (texte) et IBM Plex Mono (chiffres),
chargées via `google_fonts` (téléchargées au premier lancement puis mises en cache). Pour un usage
réellement hors ligne dès l'installation : télécharger les TTF (OFL) depuis fonts.google.com, les placer dans
`assets/google_fonts/` (noms d'origine, ex. `IBMPlexSans-Regular.ttf`), déclarer le dossier dans
`pubspec.yaml` (`assets: - assets/google_fonts/`) et lancer avec `--dart-define=ALLOW_FONT_FETCHING=false` :
google_fonts utilise alors les fichiers embarqués. En l'absence de police, la police système est utilisée
(`RfType` attrape l'exception de google_fonts).

## 3. Architecture

```
lib/
  main.dart / app.dart          amorçage, injection (ProviderScope overrides), MaterialApp.router, i18n
  core/
    config/      AppConfig (dart-define)
    theme/       jetons extraits des maquettes (RfColors, RfRadii, RfSpace), typographie, thèmes sombre + crème
    i18n/        S / context.tr() — tables fr (source) + en, sans codegen ; libellés métier depuis les packs
    router/      go_router + garde d'onboarding (onboardingRedirect)
    api/         ApiClient (dio, Bearer, refresh « single-flight », capture de l'heure serveur), TokenStore
    db/          LocalDb (sqflite_sqlcipher) : tables synchronisées + outbox + kv + param_packs
    sync/        SyncEngine (push/actions/pull/params), ConnectivityService
    params/      moteurs purs Dart : expr/ (CEL MVP), resolution, form_engine, reminder_engine, inbreeding,
                 signature (Ed25519), params_repository (packs embarqués + manifeste signé)
    entitlements/ droits signés (JWS Ed25519) vérifiés hors ligne, grâce, horloge
    notifications/ rappels locaux J-7/J-1/J/J+3 à 08:00 + alerte critique
    data/        modèles, FarmRepository, ReminderService (fusion moteur + serveur), providers Riverpod
    widgets/     composants des maquettes (PillButton, Panel, KpiTile, Sparkline, ChevronRow, RfChip…),
                 glyphes redessinés depuis les SVG, barre de navigation
  features/      un dossier par écran (voir tableau §5)
assets/packs/    copie des packs de packages/params (premier lancement hors ligne ; test de dérive)
test/engines/    vecteurs communs (../../packages/params/vectors/*.json) + form engine + consanguinité
test/widgets/    renderer de formulaires, accessibilité 360×640 ×1.3, garde d'onboarding
```

Les moteurs de `lib/core/params/` (hors `params_repository.dart`) n'importent pas Flutter.

### Moteur de formulaires
`FormEngine` (pur Dart) évalue `visible_if`, `required_if`, les champs `computed`, `min/max/pattern`, le
format puce (15 chiffres) et mappe vers l'entité via `maps_to` (`name` → racine, `attributes.x` → attributs ;
un champ sans `maps_to` va dans `attributes.<code>`). Les valeurs saisies sont normalisées (« 1 512 »,
« 34,2 ») avant d'être exposées aux expressions sous `log.*` (journal) ou `subject.*` (lot/chien).
`FormRenderer` affiche : texte, entier (+ `widget: stepper`), décimal avec unité, date, liste
(menu ou `widget: chips`), booléen, calculé (affiché sous le premier champ qu'il référence — « Taux de ponte
calculé » sous les œufs, comme la maquette), puce RFID, `subject_ref`, et les champs remplis par un capteur
(eau « du compteur connecté »).

## 4. Hors ligne et synchronisation

- **Stockage** : SQLCipher ; clé aléatoire de 256 bits générée au premier lancement et rangée dans le
  Keystore via flutter_secure_storage. Chaque entité synchronisée a sa table :
  `id, farm_id, subject_type, subject_id, date_key, data (JSON), created_at, updated_at, deleted_at,
  sync_version, client_rev, dirty, dirty_fields`.
- **Écriture locale** (transactionnelle) : `client_rev + 1`, champs modifiés ajoutés à `dirty_fields`,
  une ligne `outbox` par entité (la dernière version remplace la précédente). Les agrégats dérivés
  (`current_count`, `rabies_*`, `inbreeding_*`, montants dérivés) et le sac local `_local` ne sont jamais poussés.
- **Push** `POST /sync/push` : lots de 200, triés parents d'abord (farms → batches/dogs → journaux, actes,
  tâches, stocks, ventes, dépenses), puis par séquence. `applied` → `sync_version` + nettoyage si aucune
  modification locale plus récente ; `conflicts` → `merged_data` appliqué (si l'id fusionné diffère — journal
  (sujet, date) — la ligne locale est remplacée) ; `rejected` → ligne marquée, visible dans Réglages.
- **Actions** : les appels REST hors entités (confirmer/reporter/annuler un rappel, acquitter/résoudre une
  alerte, consentements) sont mis en file (`entity = _action`) et rejoués dans l'ordre.
- **Pull** `GET /sync/pull?since=&entities=&limit=500` en boucle tant que `has_more`, curseur
  `server_version` en kv. Un champ local encore « sale » l'emporte jusqu'à son push (le serveur arbitre ensuite
  par champ) ; un rappel confirmé localement l'emporte sur `manque`/`envoye`.
- **Déclencheurs** : retour du réseau, toutes les 15 min au premier plan, reprise de l'app, manuel (tirer pour
  rafraîchir, bandeau « N saisies… », Réglages). Échec → nouvel essai avec délai croissant (30 s → 15 min).
- **Paramètres** : packs embarqués (confiance APK) + `GET /params/manifest` ; chaque nouvelle version est
  téléchargée et **vérifiée Ed25519** avec la clé `GET /params/public-key` mise en cache à la connexion ;
  résolution recalculée et mise en cache par exploitation.
- **Rappels** : calculés sur le téléphone par le moteur partagé (protocole résolu + actes), fusionnés avec les
  rappels serveur (même clé `sujet:étape`) et les reports/annulations locaux ; notifications locales planifiées
  (J-7, J-1, J, J+3 à 08:00) → fonctionnent sans réseau. Le serveur envoie SMS/WhatsApp indépendamment.
- **Droits** : `entitlements.token` (JWS EdDSA) vérifié localement ; `active` / `grace` / `expired`
  (repli Découverte) ; « maintenant » ne peut pas être antérieur à la dernière heure serveur vue (en-tête `Date`).
- **Compte provisoire** : « Continuer hors ligne » crée un utilisateur local (UUID) ; tout fonctionne en local ;
  la vérification OTP ultérieure envoie `provisional_user_id`, puis la file est poussée.

## 5. Écrans

| Code | Écran | Fichier |
|---|---|---|
| E01–E04 | spéculations, téléphone + OTP / compte provisoire, consentements, exploitation (+ calendrier type) | `features/onboarding/*` |
| E10 | Accueil (maquette MobileAccueil) | `features/home/home_screen.dart`, `home_data.dart`, `quick_entry_sheet.dart` |
| E11 / E12 / E14 | Cheptel, formulaire adaptatif lot/chien (+ dernière rage, pedigree), fiche lot | `features/livestock/*` |
| E13 | Journal du jour (maquette MobileJournal) | `features/journal/journal_screen.dart` |
| E20–E23 | Santé, détail de rappel, acte (vaccination/soin), certificat QR | `features/health/*` |
| E25–E27 | Ventes, dépenses, stocks | `features/economy/*` |
| E30 | Fiche chien (maquette MobileChien, thème crème) | `features/dogs/dog_profile_screen.dart` |
| E44 | Tâches | `features/tasks/tasks_screen.dart` |
| E16 | Généalogie (maquette MobileGenealogie) | `features/genealogy/genealogy_screen.dart` |
| E50 | Formules + mobile money | `features/subscription/subscription_screen.dart` |
| E65 | Mes données | `features/my_data/my_data_screen.dart` |
| E70 | Ferme en direct (maquette MobileFerme) | `features/farm_live/farm_live_screen.dart` |
| E72 | Alertes + alerte critique (maquette MobileAlerte) | `features/alerts/*` |
| E60 / — | Plus, Réglages (langue, synchro, notifications, déconnexion) | `features/more`, `features/settings` |

Accessibilité : cibles ≥ 48 dp (boutons, puces, pas-à-pas 52 dp), libellés `Semantics`, échelle de texte
plafonnée à 1,3 et mises en page testées à 360×640 (test `form_renderer_test.dart`).

## 6. Écarts documentés

1. **sqflite_sqlcipher au lieu de Drift + SQLCipher** (dossier 04 §2) : pas de génération de code exigée
   par le MVP. Le schéma est volontairement générique (colonnes de synchronisation + JSON).
2. **Navigation** : la maquette (Accueil · Cheptel · + · Ferme · Plus) prime sur le dossier 02
   (Accueil · Cheptel · Santé · Marché · Plus) ; Santé est dans « Plus » et dans la saisie rapide.
3. **Généalogie** : la maquette montre des porcins ; le MVP mobile n'a que des chiens (`dogs.sire_id/dam_id`),
   l'écran s'applique donc aux chiens (mêmes composants).
4. **Sortie de stock d'un acte** : l'app crée elle-même le mouvement `stock_movements` (lié par
   `stock_movement_id`) et **n'envoie pas** `consume_stock`, pour éviter un double décompte.
5. **Tâches récurrentes** : l'occurrence suivante est créée sur le téléphone à la validation (UUID client) ;
   le serveur ne doit pas en générer une seconde pour une tâche reçue par synchronisation.
6. **Dernière rage saisie à l'ajout d'un chien adulte** : enregistrée avec `protocol_step: rage_m3` si le chien
   n'a aucun acte rage (sinon le moteur ne produit pas de rappel récurrent pour un chien enregistré en cours de vie).
7. **Notifications** planifiées en mode *inexact* (pas besoin de l'autorisation d'alarme exacte) et à l'instant
   absolu « 08:00 heure du téléphone » (pas de dépendance `flutter_timezone`).
8. Fonctions V1/V2/V3 présentes dans les maquettes (facturation, signalement de suspicion, demande de
   vétérinaire, note vocale, caméra, commande d'équipement, planification de saillie) : boutons présents,
   message « prochaine version ».
9. Pas de capture GPS ni de scanner (dépendances `geolocator` / `mobile_scanner` non ajoutées).

## 7. Hypothèses de contrat à aligner avec `apps/api`

- Pull : chaque changement `{entity, id, op?: upsert|delete, data, sync_version}` (le `deleted_at` dans `data`
  vaut aussi suppression).
- Signature des packs : `hash` = sha256 hex (préfixe `sha256:` toléré) des octets servis **ou** du JSON canonique
  (clés triées, sans espaces) du contenu ; `signature` = Ed25519 (base64/base64url) sur la chaîne `hash` UTF-8,
  sur les octets du hash, ou sur le JSON canonique — l'un des trois suffit. Corps de
  `/params/packs/:code/versions/:version` : le pack lui-même ou `{content:{…}, hash?, signature?}`.
- `GET /params/public-key` : `{public_key: base64(32 octets) | SPKI DER base64 | PEM}` ou JWK `{x}`.
- `entitlements.token` : JWS compact `alg: EdDSA`, charge `{plan, features[], quotas, expires_at, grace_until}`
  (ou imbriquée sous `entitlements`).
- Rappels serveur : `{id, farm_id, subject_type, subject_id, protocol_step|step, disease, due_date, status, priority}`
  (rapprochés des rappels locaux par `subject_id:step`).
- Alertes : `{id, farm_id, severity, status, title?, message?, value, unit, housing_name?, duration_min?,
  opened_at, escalation:[{level, target, name?, phone?, at, done}]}`.
- `GET /farms/:id/live` tuiles : `metric` ∈ temperature, humidity, nh3, water|water_flow, water_level… ;
  `status` ∈ normal|ok|attention|critique ; `series` = nombres ou `{value}` ; `threshold?`.
- Montants : `unit_price` (ventes), `amount` (dépenses), `cost` (actes), `unit_cost` (stocks) au format
  `{amount_minor, currency}` ; `stock_movements.item_id` = code `stock_item` du pack.
- `health_events` n'ont pas de `farm_id` (rattachement par le sujet).
- `GET /plans` : lignes `{code|plan, monthly|price_monthly (Money ou nombre), yearly…, features[]}` ; repli sur
  les packs (`plan`, `plan_price`) hors ligne.

## 8. Vérifications au premier `flutter analyze` / `flutter test`

- [ ] Versions résolues : `flutter_riverpod 2.5`, `go_router 14`, `dio 5.4`, `sqflite_sqlcipher 3.1`,
      `flutter_secure_storage 9`, `connectivity_plus 6` (`List<ConnectivityResult>`), `flutter_local_notifications 17`
      (`zonedSchedule(… androidScheduleMode:, uiLocalNotificationDateInterpretation:)`,
      `requestNotificationsPermission()`), `timezone 0.9`, `intl 0.19` (doit correspondre à flutter_localizations),
      `qr_flutter 4.1` (`QrImageView`, `QrEyeStyle`, `QrDataModuleStyle`), `cryptography 2.7` (`Ed25519().verify`),
      `google_fonts 6.2`, `url_launcher 6.3`, `uuid 4`.
- [ ] `GoogleFonts.getFont('Bricolage Grotesque')` : famille présente dans la version installée ? (sinon repli système,
      sans erreur, ou embarquer la police).
- [ ] API Flutter 3.24 : `ColorScheme.surfaceContainerHighest`, `WidgetStateProperty`, `DialogTheme`,
      `TextScaler.clamp`, `DropdownButtonFormField.value`, `Color.withOpacity` (non déprécié en 3.24).
- [ ] Portée des variables dans les `switch` (blocs `{}` ajoutés là où des noms se répètent) et typage de
      `num.clamp` (conversions explicites ajoutées).
- [ ] Promotion de type dans les fermetures : les endroits sensibles utilisent des copies `final` ; vérifier
      qu'aucun `!` n'est signalé « unnecessary_non_null_assertion ».
- [ ] `sqflite_sqlcipher/sqflite.dart` exporte bien `getDatabasesPath`, `ConflictAlgorithm`, `Transaction`.
- [ ] Les tests lisent `../../packages/params/vectors/*.json` et `assets/packs/*.json` : lancer `flutter test`
      depuis `apps/mobile`. `bundled_packs_test` échoue si les packs embarqués divergent
      (`cp ../../packages/params/packs/*.json assets/packs/`).
- [ ] `round()` des expressions : arrondi « demi vers le haut » après normalisation à 15 chiffres significatifs
      (`round(1.005*1000)/1000 == 1.005`) — l'implémentation TypeScript doit faire de même.
- [ ] Test d'accessibilité `androidTapTargetGuideline` du formulaire journal (360×640, ×1,3).
- [ ] Sur appareil : autorisation notifications (Android 13+), notification planifiée visible, alerte critique
      plein écran, synchronisation après mode avion, base chiffrée (fichier illisible sans clé).
