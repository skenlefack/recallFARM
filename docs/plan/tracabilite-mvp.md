# Tracabilite MVP — exigence -> test (lot P0.4, qa-automatisation)

Etabli le 2026-11-10 sur la branche `feat/P0.4-qa-mesures`. Sources : dossier 01 (39 EF MVP, RG du
perimetre MVP) et dossier 11 (scenarios T-01 a T-55). Les references sont `fichier : nom du test` ;
les ID figurent dans le titre des tests ecrits ou renommes dans ce lot (recherche : `grep -rn "EF-VAC-05" apps tests`).

**Legende.** COUVERT = au moins un test automatise execute en CI prouve le comportement central de
l'exigence. PARTIEL = un test existe mais une partie de la phrase d'exigence n'est pas prouvee (precisee).
NON COUVERT = aucun test. DEFAUT = le test ecrit revele une anomalie du produit (voir section 4).

## 1. Synthese

| Perimetre | Total | COUVERT | PARTIEL | NON COUVERT |
|-----------|-------|---------|---------|-------------|
| EF MVP (dossier 01) | 39 | **26** | **12** (dont 2 DEFAUT) | **1** |
| RG du perimetre MVP | 22 | **12** | **5** | **5** |
| Scenarios T-01 a T-55 | 55 | **12** | **16** | **27** (dont 24 hors MVP : V1, V2, V3 ; 3 dans le MVP : T-03, T-11, T-24) |

Avant ce lot : 34 ID cites dans le code et les tests, aucun lien exigence -> test. Apres : chaque
ligne ci-dessous renvoie a un test nomme. Tests ajoutes : `apps/api/test/recette-mvp.e2e-spec.ts`
(23 scenarios), `apps/api/src/params/**/*.branches.spec.ts` et `evaluator.defensive.spec.ts` (moteurs a 100 % des branches).

Limites de lecture : (a) « COUVERT » est evalue **cote serveur et moteurs** ; les parties natives du mobile
(notification locale, ecran, hors ligne reel) ne sont pas testees hors des tests de widgets cites ;
(b) les tests mobile et web ne portent pas encore d'ID dans leurs titres (fichiers en cours de modification
par d'autres agents ce lot) : ils sont cites par nom dans les tableaux.

## 2. Exigences fonctionnelles MVP (dossier 01)

| ID | Statut | Test(s) | Ce qui manque |
|----|--------|---------|---------------|
| EF-ONB-01 | COUVERT | recette-mvp : `EF-ONB-01 EF-ONB-04: the speculations chosen drive the forms and the task calendar offered` ; pilot : `EF-CHE-02 EF-VAC-02 EF-ONB-01: validates a batch against the resolved form` ; recette-mvp : quota Decouverte (1 ferme, 429) | multi-speculations en Pro |
| EF-ONB-02 | COUVERT | pilot : `EF-ONB-02: creates a farm (idempotent upsert)` (devise XAF deduite du pays) | ecran mobile `farm_setup_screen` |
| EF-ONB-04 | PARTIEL | recette-mvp : `EF-ONB-01 EF-ONB-04 ...` (le pack expose `task_template` par filiere, aucun pour une autre filiere) | proposition a la creation cote mobile non testee |
| EF-AUT-01 | COUVERT | pilot : `EF-AUT-01 RG-AUT-01: OTP request/verify ...` ; recette-mvp : `RG-AUT-01 EF-AUT-01: 5 wrong codes lock the OTP` | e-mail optionnel |
| EF-AUT-02 | PARTIEL / DEFAUT D-QA-01 | recette-mvp : `EF-AUT-02: an offline provisional account is attached ...` (`it.failing`) | le rattachement repond 500 (section 4) |
| EF-AUT-04 | COUVERT | recette-mvp : `EF-AUT-04: a user cannot read, write or list the farm of someone else` ; pilot : `T-36 ... organisation dashboard` (403 hors portee) | roles agent/veterinaire (V1) |
| EF-CON-01 | COUVERT | recette-mvp : `EF-CON-01 EF-CON-02 RG-CON-01: consents are versioned, timestamped ...` | blocage a l'inscription sans acceptation des CGU (non teste) |
| EF-CON-02 | COUVERT | recette-mvp : meme test (portees separees, revocation = nouvelle ligne `revoked_at`) | effet sur les partages (RG-CON-01) |
| EF-CON-03 | PARTIEL | recette-mvp : `T-25 EF-CON-03: the export contains the user data (JSON) ...` | export CSV absent du code (JSON seul) ; delai 72 h |
| EF-CON-04 | PARTIEL | recette-mvp : `T-25 EF-CON-04: deletion is scheduled 30 days later and can be cancelled` | execution apres 30 j et anonymisation des journaux non testees |
| EF-CHE-01 | PARTIEL / DEFAUT D-QA-02 | recette-mvp : `EF-CHE-01: a batch can be read, modified (full body), archived` ; `EF-CHE-01: PATCH ... partial update` (`it.failing`) ; pilot : `T-07 ... sync push/pull` | PATCH partiel repond 422 (section 4) ; animaux et chiens non testes |
| EF-CHE-02 | COUVERT | forms.spec : `reports required, type and bound errors with field paths` ; forms.branches : tous les types de champ ; pilot : `EF-CHE-02 ...` | photo d'identification |
| EF-JOU-01 | COUVERT | pilot : `EF-JOU-01 RG-JOU-05 RG-CHE-01: daily log ...` ; mobile `form_engine_test` : `daily log (ponte): visibility, required_if and computed laying rate` ; web `FormRenderer.test` : `shows laying fields only for a laying batch` | saisie par animal (traite) |
| EF-VAC-01 | COUVERT | pilot : `EF-VAC-01 EF-VAC-04 EF-VAC-06: health event recomputes reminders` | |
| EF-VAC-02 | COUVERT | pilot : `EF-CHE-02 EF-VAC-02 ...` (5 rappels du protocole volaille) ; engines.spec : `vectors/reminders.json` ; reminders.branches ; pilot : studio `simulate-protocol` | |
| EF-VAC-03 | PARTIEL | engines.spec : `notification plan with and without rappels_sms` ; reminders.branches : `notification plan (RG-NOT-01)` ; pilot : `EF-NOT-01 EF-NOT-02 EF-VAC-03 RG-NOT-02: notification scheduler ...` ; mobile `reminders_test` : `notification plan` | notification locale native (hors ligne) non testee ; relances J-7/J-1/J/J+3 en bout en bout |
| EF-VAC-04 | COUVERT | pilot : `EF-VAC-04 T-02: inbound SMS "OK <code>" confirms the reminder` ; pilot regression `2. confirming a seeded coop reminder` ; reminders.branches : `adds a recurring reminder` | |
| EF-VAC-05 | COUVERT | recette-mvp : `T-20 RG-VEN-02 EF-VAC-05: an egg sale is refused during the withdrawal period` | alerte visuelle (ecran) |
| EF-VAC-06 | COUVERT | pilot : `T-35 EF-VAC-06 ...: certificate QR payload verifies publicly` (PDF + QR + falsification) ; `PLAN_REQUIRED` sans Pro | consultation hors ligne |
| EF-TAC-01 | COUVERT | recette-mvp : `T-31 EF-TAC-01: ticking a weekly task creates the next occurrence 7 days later` | rappel local genere (mobile) |
| EF-CAN-01 | COUVERT | pilot : `T-35 ... Rex` (fiche, puce, carnet) ; mobile `form_engine_test` : `dog form: required, rfid and bounds` | champs E30 complets |
| EF-CAN-02 | PARTIEL | pilot : `T-35 ...` (`rabies_status: a_jour`) ; reminders.branches : priorite `haute` pour une maladie notifiable | alerte de rage echue (T-11) ; CHPPiL, toux de chenil |
| EF-STK-01 | COUVERT | recette-mvp : `T-04 RG-STK-01 EF-STK-01: stock = entrees - sorties` ; `EF-STK-01: refuses an unknown input ...` | |
| EF-VEN-01 | COUVERT | recette-mvp : `T-10 RG-VEN-01 EF-VEN-01: 50 plateaux x 2 500 XAF = 125 000` ; `EF-VEN-01 RG-MDD-06: a sale in another currency ...` | |
| EF-DEP-01 | COUVERT | recette-mvp : `T-21 EF-DEP-01 RG-MDD-06: expenses are whole minor units` | affectation a un lot : envoyee mais non relue |
| EF-KPI-01 | PARTIEL | recette-mvp : `EF-KPI-01: KPIs per batch and the month margin` | valeurs mortalite, ponte, IC, cout de revient non verifiees a la main |
| EF-CTN-01 | NON COUVERT | — | aucun point d'API de contenus ; ecran « bientot disponible » (etat.md) |
| EF-ABO-01 | COUVERT | pilot : `T-08 EF-ABO-01 EF-ABO-02: checkout + signed webhook activates Pro` ; connectors.e2e : `runs a mobile-money payment end to end`, `EF-ABO-01 PAY-OPEN: a 2nd checkout with another id or another plan while "en_attente" gets 409…`, `EF-ABO-01 PAY-OPEN: the replay of the same id or Idempotency-Key still answers as a replay, not 409`, `EF-ABO-01: id and Idempotency-Key that do not designate the same payment are refused (422)`, `EF-ABO-01 PAY-OPEN: an organisation payer, two managers…`, `EF-ABO-01 PAY-OPEN: two simultaneous checkouts with different ids create one payment…`, `EF-ABO-01 resolve: platform_admin settles an "a_verifier" payment…` (dont confirmation tardive -> needs_review, et resolve confirme puis SUCCESS sans prolongation), `PAY-RECENT (PO 2026-11-13): a subscription payment confirmed < 30 min ago needs confirm_repeat…`, `refuses a confirmation with another amount (journaled) or from another connector (nothing written, counted)`, `Q-WEB-03: GET /payments/:id and /admin/payments/:id give the provider journal…`, `currency comes from the country pack…` ; payment-open-migration.e2e : `migration PaymentOpenGuard: up, down, up`, `the index refuses a second open subscription payment…`, `the index predicate lists exactly OPEN_PAYMENT_STATUSES…`, `up stops on existing duplicates…`, `contract: checkout documents 409 PAY-OPEN…` ; unitaires payments.spec : `BillingService.applyResult: journal…`, `BillingService.checkout: PAY-RETRY (m6)`, `config PAYMENT_RECENT_GUARD_MIN (PAY-RECENT)`, `paymentEvents (Q-WEB-03)`, `BillingService: currency from the country pack…` | mobile money reel (D-07) : simulateurs seulement ; mobile et web : traitement de 409 PAY-OPEN demande (requests.md 2026-11-13) ; delai de blocage `a_verifier` : Q-INT-07 (PO) |
| EF-ABO-02 | COUVERT | pilot : meme test (JWS verifie hors ligne) ; recette-mvp : `T-34 RG-ABO-01 EF-ABO-02: ... grace` ; `EF-ABO-02 EF-ABO-01: the catalogue prices ...` | verification de la signature cote Dart (`signature.dart` non couvert) |
| EF-NOT-01 | PARTIEL | pilot : `EF-NOT-01 ... notification scheduler` (heures calmes) ; notifications.scheduler.spec : `inQuietHours` | preferences par canal (endpoint) non testees |
| EF-NOT-02 | COUVERT | pilot : `EF-NOT-01 EF-NOT-02 ...` (journal `outbound_messages`) ; connectors.e2e : `applies delivery reports to the outbound journal` | |
| EF-NOT-05 | PARTIEL | connectors.e2e : `serves the pack USSD menu in the aggregator format (text/plain CON/END)` | parcours T-54 (confirmer un rappel, session < 3 min) |
| EF-SYN-01 | COUVERT | pilot : `T-07 T-33 EF-SYN-01 ... sync push/pull` (`sync_version` croissant, curseur `since`) | |
| EF-SYN-02 | COUVERT | pilot : meme test (push par lots idempotent, rejeu, pull `since`) | |
| EF-SYN-03 | COUVERT | pilot : meme test (conflit `daily_logs` : fusion par champ, journalisee dans `conflicts`) | fusion sur fiche (champs differents) cote mobile |
| EF-SYN-04 | PARTIEL | pilot : meme test (`params_manifest` dans le pull) ; mobile `bundled_packs_test` | verification de signature hors ligne cote Dart non testee (`signature.dart` 0 %) |
| EF-ANA-01 | COUVERT | recette-mvp : `EF-ANA-01: usage events are pseudonymised ... refused once the user opted out` | catalogue ferme : non applique par la route active (section 4, D-QA-03) |
| EF-ANA-02 | PARTIEL | pilot : `T-36 RG-SUR-02 EF-ANA-02: organisation dashboard` | tableau de bord admin `/admin/analytics/dashboard` non teste |
| EF-ANA-04 | COUVERT | recette-mvp : `EF-ANA-04: feature flags are resolved per user` | filtrage par pays / cohorte (une seule combinaison testee) |

## 3. Regles de gestion du perimetre MVP

| ID | Statut | Test(s) | Ce qui manque |
|----|--------|---------|---------------|
| RG-AUT-01 | COUVERT | recette-mvp : `RG-AUT-01 EF-AUT-01: 5 wrong codes lock the OTP` ; `RG-AUT-01: an OTP older than 10 minutes is refused` ; pilot : 4e demande limitee | |
| RG-CON-01 | NON COUVERT | — | exclusion des agregats apres revocation (T-24) |
| RG-CHE-01 | COUVERT | pilot : `EF-JOU-01 RG-JOU-05 RG-CHE-01: daily log` (500 -> 490) ; `T-07 ... sync` (488, derive ignoree) ; recette-mvp : `RG-JOU-02 RG-CHE-01` | sorties et entrees |
| RG-CHE-02 | NON COUVERT | — | pas de point d'API logement (V1) |
| RG-JOU-01 | COUVERT | mobile `expressions_test` : `laying rate form expression` ; forms.branches : `computed fields are skipped by validation and evaluated for display` ; web `FormRenderer.test` : `computes read-only fields with the expression engine` | |
| RG-JOU-02 | COUVERT | recette-mvp : `RG-JOU-02 RG-CHE-01: cumulative mortality = sum of deaths / initial count` (5 %) | |
| RG-JOU-03 | COUVERT | pilot : `... duplicates -> 409; RG-JOU-03` (422 `BUSINESS_RULE`) | |
| RG-JOU-04 | NON COUVERT | — | IC apres au moins une pesee |
| RG-JOU-05 | COUVERT | pilot : `...daily log: ... duplicates -> 409` ; `T-07 T-33 ... sync` (fusion des deux saisies du meme jour) | |
| RG-VAC-01 | COUVERT | reminders.branches : `adds a recurring reminder after the last act of the step (RG-VAC-01)` ; `vectors/reminders.json` | |
| RG-VAC-02 | PARTIEL | reminders.branches : `timing (RG-VAC-02)` ; pilot : `en_retard` en tete de liste | bascule « manque » apres 3 j (T-03), couverture |
| RG-VAC-03 | PARTIEL | notifications.scheduler.spec : `SMS grouping key` ; pilot : scheduler `capped` | desinscription canal par canal |
| RG-VAC-04 | PARTIEL | reminders.branches : `makes every step of a mandatory protocol high priority` | rage jamais plafonnee en push, plafonnee SMS au-dela de 1/jour |
| RG-CAN-01 | NON COUVERT | — | mise-bas = saillie + 63 j |
| RG-CAN-02 | NON COUVERT | — | statut `cede`, transmission de la fiche |
| RG-STK-01 | COUVERT | recette-mvp : `T-04 RG-STK-01 EF-STK-01` (476 kg, ajustement) | |
| RG-VEN-01 | COUVERT | recette-mvp : `T-10 RG-VEN-01 EF-VEN-01` (125 000, arrondi a l'unite mineure) | |
| RG-VEN-02 | COUVERT | recette-mvp : `T-20 RG-VEN-02 EF-VAC-05` (message avec la date de fin) | |
| RG-ABO-01 | COUVERT | recette-mvp : `T-34 RG-ABO-01 EF-ABO-02: ... grace` (J+3 Pro, J+8 retour Decouverte, donnees intactes) | « lecture seule » : le code retire les modules, il ne gere pas une lecture seule distincte |
| RG-NOT-01 | PARTIEL | reminders.branches : `notification plan (RG-NOT-01)` | repli WhatsApp -> SMS -> push ; consentement x preference |
| RG-NOT-02 | PARTIEL | notifications.scheduler.spec : `SMS grouping key` ; pilot : scheduler | un seul SMS pour 5 rappels, plafond 3/jour (T-26) |
| RG-SYN-01 | COUVERT | pilot : `T-07 ... sync` (« derived count ignored in push ») | |

## 4. Defauts reveles par les tests (a corriger par le proprietaire)

| ID | Gravite | Constat | Test | Cause probable |
|----|---------|---------|------|----------------|
| D-QA-01 | elevee | Le premier login avec `provisional_user_id` repond **500** : le compte provisoire n'est jamais rattache (EF-AUT-02, parcours hors ligne -> en ligne) | `EF-AUT-02: an offline provisional account is attached ...` (`it.failing`) | `apps/api/src/users/auth.service.ts` `mergeProvisionalAccount` : `UPDATE devices SET user_id` mais `devices` n'a pas de colonne `user_id` (il depend de la ferme, deja transferee) |
| D-QA-02 | moyenne | `PATCH /batches/:id` avec un seul champ repond **422** (`start_date`, `initial_count` invalides) : seul un corps complet passe | `EF-CHE-01: PATCH ... partial update` (`it.failing`) | `livestock.service.ts` : `{ ...serializeBatch(existing), ...clean }` ; les DTO emettent des champs `undefined` qui ecrasent les valeurs stockees. Meme motif probable pour `PATCH /dogs/:id` |
| D-QA-03 | faible | Deux routes pour les evenements d'usage : `POST /v1/analytics/events` (misc, 202, sans validation du catalogue ni opt-out par lot) et `POST /v1/v1/analytics/events` (AnalyticsController, prefixe double, catalogue ferme) | `EF-ANA-01 ...` (route active) | `analytics.controller.ts` declare `@Controller('v1/analytics')` sous le prefixe global `v1` ; la route de `misc.controller.ts` masque la bonne |

Les deux `it.failing` passent tant que le defaut existe et **echouent des qu'il est corrige** : il faut alors
remplacer `it.failing` par `it`. Aucun test n'est desactive ni affaibli.

## 5. Scenarios du dossier 11 (T-01 a T-55)

Automatise = verifie par un test execute en CI. Les scenarios IoT, cameras, interoperabilite, V1 et V2 ne sont
pas dans le perimetre MVP : ils figurent ici pour que la matrice du dossier 11 soit complete.

| T | Statut | Test / raison |
|---|--------|---------------|
| T-01 | PARTIEL | moteur : `vectors/reminders.json`, certificat `valid_until = +365 j` (pilot T-35) ; notification locale hors ligne non testee |
| T-02 | PARTIEL | pilot : `EF-VAC-04 T-02` (confirme par SMS) ; reminders.branches (occurrence suivante) ; transition « clos » non testee |
| T-03 | NON | bascule « manque » apres 3 j |
| T-04 | COUVERT | recette-mvp : `T-04 ...` |
| T-05 | COUVERT | pilot : `... RG-JOU-03` (API) ; l'ecran mobile ne l'est pas |
| T-06 | PARTIEL | pilot : certificat refuse sans Pro (`PLAN_REQUIRED`) ; module Dressage et mode hors ligne non testes |
| T-07 | PARTIEL | pilot : `T-07 T-33 ... sync` (fusion par champ, journalisee) ; 2 appareils reels non testes |
| T-08 | COUVERT | pilot : `T-08 EF-ABO-01 EF-ABO-02` |
| T-09 | NON | agents (V1) |
| T-10 | COUVERT | recette-mvp : `T-10 ...` |
| T-11 | NON | alerte « rappel en retard » sur la fiche chien |
| T-12 | NON | export de surveillance (V2) |
| T-13 | PARTIEL | genealogy.spec : `half siblings -> 0.125` (calcul) ; verdict via API non teste |
| T-14 | COUVERT | genealogy.spec : `first cousins -> 0.0625 (threshold) = a_eviter` ; mobile `inbreeding_test` : `unrelated -> 0 (ok)` |
| T-15 | PARTIEL | genealogy.spec : `flags incomplete pedigrees` ; libelle « minore » non verifie |
| T-16 | NON | refus 422 sans confirmation (V1) |
| T-17 | NON | boucle de pedigree |
| T-18, T-19 | NON | cameras (V2) |
| T-20 | COUVERT | recette-mvp : `T-20 ...` |
| T-21 | PARTIEL | recette-mvp : `T-21 ...` (XAF, devise etrangere refusee) ; tresorerie par devise (V1) non testee |
| T-22, T-23 | NON | pension et dressage (V1) |
| T-24 | NON | RG-CON-01 |
| T-25 | PARTIEL | recette-mvp : `T-25 EF-CON-03`, `T-25 EF-CON-04` ; execution a +30 j non testee |
| T-26 | PARTIEL | notifications.scheduler.spec : `SMS grouping key` ; scenario complet (5 rappels -> 1 SMS) non teste |
| T-27, T-28, T-29, T-30, T-32 | NON | reproduction, signalement, biosecurite, projection, logements (V1) |
| T-31 | COUVERT | recette-mvp : `T-31 ...` |
| T-33 | COUVERT | pilot : `T-07 T-33 ... sync` (un seul journal, champs fusionnes) |
| T-34 | COUVERT | recette-mvp : `T-34 ...` |
| T-35 | COUVERT | pilot : `T-35 ...` (QR valide, falsifie invalide) ; non-exposition du telephone non assertee |
| T-36 | COUVERT | pilot : `T-36 RG-SUR-02 ...` (cellule Bikok masquee) |
| T-37 a T-41 | NON | IoT (V2) |
| T-42 | PARTIEL | resolution.branches : `refuses a locked value and says which pack tried` ; refus a la validation de publication non teste |
| T-43 | COUVERT | pilot : `T-43 EF-PAR-06 RG-PAR-04` et regression 3 |
| T-44 | PARTIEL | pilot : `rollback` du pack ; `param_version` des saisies conserve non verifie |
| T-45 a T-49 | NON | interoperabilite, AMU, RFID, ICAR, residence des donnees (V2/V3) |
| T-50 | PARTIEL | vecteurs communs : 62 TS + 76 Dart (cible du dossier : 5 000) ; job `parity` |
| T-51 | PARTIEL | forms.branches : `stores standard columns and attributes separately (maps_to)` ; ajout/retrait d'un champ par pack non teste de bout en bout |
| T-52 | PARTIEL | recette-mvp : `EF-ANA-01 ... refused once the user opted out` ; envoi cote mobile non teste |
| T-53 | NON | mode veterinaire (V1) |
| T-54 | PARTIEL | connectors.e2e : `serves the pack USSD menu` |
| T-55 | PARTIEL | pilot : `re-running the seed` (import CSV d'1 ligne) ; 312 lignes / rapport d'erreurs non testes |

Decompte : COUVERT 12 (T-04, 05, 08, 10, 14, 20, 31, 33, 34, 35, 36, 43), PARTIEL 16, NON 27.
