# RecallFarm — Tableau d'avancement

Derniere mise a jour : 2026-11-10 (mesures relancees ce jour ; precedente : 2026-10-27)

> Depot git initialise le 2026-11-10 (commit 5fcaea0, branche main, pas encore de remote) :
> aucune PR ni historique de CI anterieurs, les colonnes "lien PR" sont donc vides. Le journal (docs/plan/journal.md)
> n'a pas d'entree apres le 2026-10-28 : aucun travail trace depuis 13 jours.

## Progression par phase

| Phase | Lots | Termines | En cours | Bloques | Non demarres | % |
|-------|------|----------|----------|---------|--------------|---|
| Phase 0 — Stabiliser le MVP | 4 | 4* | 0 | 0 | 0 | 100 %* |
| Phase 1 — Pilote Yaounde | 6 | 3* | 0 | 2 | 1 | 50 % |
| Phase 2 — V1 | 10 | 0 | 0 | 0 | 10 | 0 % |
| Phase 3 — V2 | 6 | 0 | 0 | 0 | 6 | 0 % |
| Phase 4 — V3 | 3 | 0 | 0 | 0 | 3 | 0 % |
| **Total** | **29** | **7** | **0** | **2** | **20** | **24 %** |

\* "Termine" au sens du journal, **pas au sens de la DoD** : aucune revue `relecteur` n'existe
(docs/plan/revues/ est vide), la couverture n'atteint pas 80 %, le lint API et web est rouge
(voir indicateurs). Les portes "socle sain" et "Go pilote" ne sont donc pas formellement franchies.

## Environnement de recette

**https://recallfarm.com** en ligne depuis le 2026-11-10 (serveur RecallVet, Infomaniak ; simulateurs SMS/paiement ; donnees fictives).

## 1. Lots termines

| Lot | Date | Resume | PR |
|-----|------|--------|----|
| P0.1 Mobile compile | 2026-10-28 | APK debug construit, flutter analyze 0, tests 85/85, integration_test 1/1 sur emulateur Pixel 7 | — |
| P0.2 Livraison conteneurisee | 2026-10-27 | 5 services healthy ; CVE critique TypeORM corrigee (0.3.20 → 0.3.26) | — |
| P0.3 Dette MVP | 2026-10-28 | PostGIS obligatoire, rate limiting Redis, regroupement SMS (RG-NOT-02), recalcul des rappels a la publication, compte provisoire OTP | — |
| P0.4 Banc de non-regression | 2026-10-28 | Parite TS/Dart OK (job CI), Playwright 5/5, contrat 9/9, k6 p95 = 20 ms | — |
| P1.3 Conformite donnees | 2026-10-28 | Registre des traitements, retention, export, annulation de suppression | — |
| P1.4 Analytique produit | 2026-10-28 | 13 evenements, agregation quotidienne, tableau de bord admin | — |
| P1.5 Enrolement en masse | 2026-10-28 | Import CSV/XLSX, annulation sous 24 h | — |

Reste ouvert sur ces lots (criteres d'acceptation non prouves) :
- P0.1 : APK **release signe** < 25 Mo non produit ; goldens par ecran ; parcours pilote complet
  (le test d'integration ne depasse pas E01) ; 50 cycles mode avion ; ecran 360x640 ; captures ux-fidelite.
- P0.2 : recette publique HTTPS, observabilite (Prometheus/Grafana/Loki), restauration de sauvegarde
  prouvee ; 4 CVE HIGH image web, 4 CVE HIGH image API.
- P0.4 : tests de proprietes (10 000 expressions) non faits ; k6 a 50 VU au lieu de 300 ; CI < 15 min non mesuree.
- P1.3 : droits exerces de bout en bout depuis mobile **et** web non prouves ; AIPD et procedure de violation absentes.
- P1.4 : verification "indicateurs recalcules a la main" non faite.
- P1.5 : test de charge 5 000 lignes < 60 s non fait.

## 2. Lots en cours

Aucun. Aucun agent n'est actif.

## 3. Lots bloques

| Lot | Raison | Decision attendue |
|-----|--------|-------------------|
| P1.1 SMS et USSD reels | **Debloque cote code (2026-11-10)** : connecteurs parametrables (ADR-002). Reste : USSD sessions / 160 car. (revue M5), puis brancher l'agregateur retenu | D-07, D-03 (choix commercial seulement) |
| P1.2 Mobile money reel | **Debloque cote code** : connecteur de paiement. Reste : statut, remboursement, rapprochement quotidien, checkout idempotent (revue M6) | D-07 (choix commercial seulement) |

Consequence : **P1.6 Recette du pilote** ne peut pas demarrer (elle exige SMS et paiements reels).

## 4. Exigences par version (dossier 01, 106 exigences EF etiquetees)

| Version | Total | Livrees (estimation) | Partielles | Absentes |
|---------|-------|----------------------|------------|----------|
| MVP | 39 | ~33 | ~5 | ~1 |
| V1 | 47 | 0 | ~18 | ~29 |
| V2 | 18 | 0 | ~3 | ~15 |
| V3 | 2 | 0 | 0 | 2 |

**Methode et limite** : la tracabilite ID → test exigee par la DoD n'existe presque pas. Seuls
34 identifiants EF-/RG- sont cites dans le code et les tests (dont 4 EF : EF-NOT-05, EF-ONB-04,
EF-PAR-04, EF-PAR-11). Les chiffres ci-dessus viennent d'une lecture des modules, ecrans et
mots-cles, pas de tests rattaches aux ID. A refaire par qa-automatisation (matrice dossier 11).

**MVP — points ouverts**
- EF-NOT-05 (USSD pilote), EF-ABO-01 (paiement mobile money reel) : simulateurs seulement, bloques par D-03/D-07.
- EF-VAC-06 certificat QR : ecran mobile present, PDF a verifier.
- EF-CTN-01 contenus audio : notes vocales "bientot disponible" dans l'app.
- EF-CON-03 export CSV : export JSON prouve, CSV non verifie.

**V1 — deja amorce dans le code (sans lot ni test dedie)** : code PIN (EF-AUT-03), logements,
mouvements, pesees (EF-CHE-04 a 06), genealogie et consanguinite (EF-GEN-01 a 04), reproduction,
dressage/pension/devis (EF-DRE-01 a 05), biosecurite (EF-BIO-01, 03), WhatsApp (adaptateur).

**V1 — absent** : marche et annuaire (EF-MAR-01 a 03), mode agent, mode veterinaire (EF-VTR-01 a 03),
"Signaler un probleme" (EF-ANA-03), tresorerie (EF-DEP-02, rien cote API), simulateur de projection
(EF-PRJ-01/02, rien cote mobile).

**V2** : pages web "campagnes" et "surveillance" sont des ecrans d'attente ("arrivent bientot").
**V3** : rien.

## 5. Decisions en attente (toutes ouvertes depuis le 2026-10-27)

| ID | Sujet | Bloque |
|----|-------|--------|
| D-01 | Hebergement | **Decide (provisoire)** : serveur RecallVet chez Infomaniak, recallfarm.com ; Cameroun en production reelle |
| D-02 | Drift vs sqflite_sqlcipher | — (sqlcipher utilise par defaut) |
| D-03 | Code court USSD | **P1.1** |
| D-04 | Fournisseur WhatsApp Business | P2.10 |
| D-05 | Fournisseur vocal (IVR) | V2 (EF-NOT-07) |
| D-06 | Analytique : ClickHouse ou PG | — (tables PG utilisees par defaut) |
| D-07 | Agregateur SMS / paiement | **P1.1, P1.2, P1.6** |
| D-08 | Auditeur ISO 27001 | P3.6 |
| D-09 | Polices embarquees ou Google Fonts | — (embarquees par defaut) |
| D-10 | Tests sur appareils reels | P1.6 |

Priorite PO : **D-07 puis D-03, puis D-01** — ce sont elles qui debloquent le pilote.

## 6. Indicateurs de sante (mesures du 2026-11-10)

| Indicateur | Cible | Mesure | Etat |
|------------|-------|--------|------|
| Tests API unitaires | 100 % verts | **85/85** (5 suites, 36 s) | OK |
| Tests API e2e | verts | **Non executes** (pile RecallFarm arretee) | ? |
| Tests Web (Vitest) | 100 % verts | **70/70** (7 fichiers, 27 s) | OK |
| Tests Mobile (flutter test) | 100 % verts | **85/85** | OK |
| flutter analyze | 0 | **0 probleme** | OK |
| Lint API | 0 | **0** (2 erreurs corrigees le 2026-11-10) | OK |
| Build API (tsc) | OK | **OK** (2 erreurs de typage corrigees le 2026-11-10 : le build etait casse) | OK |
| Lint Web | 0 | **0** (1 erreur corrigee le 2026-11-10) | OK |
| Tests instables | 0 | Aucun observe sur 1 execution ; integration_test mobile fragile (tap sur Panel) | — |
| Total | — | **240/240 verts** | OK |
| Couverture API (lignes) | >= 80 % | **71,4 %** (branches 49 %, fonctions 40 %) | KO |
| Couverture moteurs (branches) | 100 % | Non isolee | ? |
| Couverture Web | >= 80 % | **Non mesurable** (@vitest/coverage-v8 non installe) | ? |
| Couverture Mobile | >= 80 % | Non mesuree | ? |
| Parite TS/Dart | 100 % | OK au 2026-10-28 (62 TS + 76 Dart vecteurs) ; non relancee | — |
| Temps de CI | < 15 min | **Non mesurable** (depot sans remote, CI jamais executee) | ? |
| Anomalies critiques | 0 | **0 ouverte** (1 corrigee : CVE TypeORM) | OK |
| Anomalies elevees | — | **8 CVE HIGH** dans les images (multer, pacote, picomatch, sigstore ; pcre2, nghttp2, zlib, tiff) | A traiter |
| Revues relecteur | 1 par lot | **0** | KO |

## Actions recommandees

1. PO : trancher **D-07, D-03, D-01**.
2. ~~Initialiser git~~ (fait) ; creer le depot GitHub et pousser pour que la CI tourne.
3. ~~Corriger lint et build~~ (fait) ; installer `@vitest/coverage-v8`.
4. Remonter la couverture API a 80 % (branches surtout) et tracer chaque exigence MVP vers un test.
5. Faire passer `relecteur` sur les 7 lots declares termines.
6. Finir les criteres ouverts de P0.1 (APK release signe, parcours pilote complet) et P0.2 (recette HTTPS, sauvegardes).
