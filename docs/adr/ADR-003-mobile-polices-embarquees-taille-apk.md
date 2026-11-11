# ADR-003 — Mobile : polices embarquees (retrait de google_fonts) et taille de l'APK

## Statut
PROPOSE (mobile-socle, lot P0.1, 2026-11-10). Applique sur la branche dans le sens demande par le
lot P0.1 §1 (« embarque les polices »), mais D-09 « polices embarquees ou Google Fonts » n'est pas
tranche : decision du proprietaire du produit attendue (docs/plan/questions.md Q-MOB-02).

## Contexte
- Critere d'acceptation P0.1 : APK release signe < 25 Mo (ENF-PER-04) ; eleveurs en 2G.
- Mesure de depart (2026-11-10, Flutter 3.38.3, `--split-per-abi`) : voir apps/mobile/README.md §9.
  `libapp.so` (code Dart AOT) pesait 16,1 Mo en arm64.
- La piste notee au journal (« remplacer `cryptography` par `pointycastle`, ~-6 Mo ») n'a pas ete
  retenue : `cryptography` est du Dart pur de quelques centaines de Ko et pointycastle n'offre pas
  Ed25519. La cause reelle est `GoogleFonts.getFont(nom)` : l'appel par nom de famille oblige le
  compilateur AOT a conserver la table complete des ~1 500 familles Google Fonts (methodes, poids,
  empreintes) au lieu de l'elaguer.
- google_fonts telechargeait en plus les polices au premier lancement : contraire au « hors ligne
  d'abord » (premier lancement sans reseau = police systeme, rendu different des maquettes).

## Decision
1. Retirer la dependance `google_fonts`. Embarquer Bricolage Grotesque (600/700/800),
   IBM Plex Sans (400/500/600/700) et IBM Plex Mono (400/500/600) en TTF statiques, sous-ensemble
   latin (Fontsource 5.3.0, SIL OFL 1.1), soit ~500 Ko dans `apps/mobile/assets/fonts/`.
   Les licences OFL sont livrees et enregistrees dans `LicenseRegistry`.
   Couverture : Latin-1, œ, €, guillemets, espace fine insecable (U+202F, separateur de milliers
   fr). Un glyphe absent bascule sur la police systeme.
2. Compresser les bibliotheques natives dans l'APK (`packaging.jniLibs.useLegacyPackaging = true`) :
   l'APK telecharge est plus leger ; en contrepartie Android extrait les `.so` a l'installation
   (espace disque occupe un peu plus grand, installation un peu plus longue).
3. Distribuer un APK par ABI (`flutter build apk --release --split-per-abi`, arm et arm64) ;
   l'APK « universel » n'est plus l'artefact de reference.
4. `cryptography` est conserve (verification Ed25519 des packs et des droits) ; les tests
   `test/core/signature_test.dart` (RFC 8032 + fixtures signees par l'API Node) protegent tout
   changement futur de bibliotheque.

## Consequences
- Taille : voir les mesures avant/apres dans apps/mobile/README.md §9.
- `RfType` garde son API ; `RfType.useBundledFonts = false` (tests de widgets, ex-`useGoogleFonts`) force
  la police systeme.
- `--dart-define=ALLOW_FONT_FETCHING` disparait.
- Rendu identique aux maquettes des le premier lancement, sans reseau.
- Retour arriere : re-ajouter google_fonts et l'ancien `RfType._font` (commit precedent).
