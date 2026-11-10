# 11 — Recette, traçabilité, livrables et engagements (v2.2)

> Version 2.2 — 27/10/2026. Ajouts v2.2 : cas de test T-37 à T-55, traçabilité des nouveaux domaines, livrables du paramétrage et du suivi à distance. Méthodes de test dans `16` §5. Il reprend les §14 à §19 du cahier des charges v2.0 (.docx), qui n'existaient pas dans le dossier développeur, et les complète pour les fonctions ajoutées en v2.1.

## 1. Stratégie de recette
- Tests unitaires : rappels, indicateurs, stocks, montants multi-devises, consanguinité, moteur de projection.
- Tests d'intégration : synchronisation, paiement mobile money, SMS/WhatsApp, webhooks.
- Tests hors ligne : coupure réseau simulée, tests en mode avion.
- Tests sur appareils réels bas de gamme (ENF-PER-01).
- Recette fonctionnelle par lot. **Un lot est accepté** si toutes ses exigences Must passent, si tous les tests automatisés sont verts, et si les cibles ENF du lot sont vérifiées.

## 2. Cas de test

| ID | Étant donné | Quand | Alors | Exigences |
|---|---|---|---|---|
| T-01 | Aucun réseau | J'enregistre un vaccin antirabique daté d'aujourd'hui | Un rappel est créé à +1 an, visible, avec une notification locale planifiée | EF-VAC-01/02/03 |
| T-02 | Un rappel « à venir » | Je le confirme | Il passe à « confirmé » puis « clos », et l'occurrence suivante est planifiée | EF-VAC-04 |
| T-03 | Un rappel envoyé, non confirmé depuis plus de 3 jours | Le délai passe | Il passe à « manqué » et remonte en priorité | RG-VAC-02 |
| T-04 | Aliment ponte : entrée de 500 kg, sortie de 24 kg | J'ouvre le résumé des stocks | Le stock affiché est de 476 kg | RG-STK-01 |
| T-05 | Effectif présent de 197 | Je saisis une mortalité de 200 | Erreur bloquante : mortalité > effectif | RG-JOU-03 |
| T-06 | Utilisateur Découverte, hors ligne | J'ouvre le module Dressage | Accès refusé, avec un message pour passer Pro | EF-ABO-02 |
| T-07 | Saisies hors ligne sur 2 appareils (champs différents de la même fiche) | Reconnexion | Fusion sans doublon ni écrasement silencieux ; fusion journalisée | EF-SYN-03 |
| T-08 | Souscription Pro | Paiement mobile money confirmé (webhook) | Droits Pro activés et appliqués, même hors ligne | EF-ABO-01/02 |
| T-09 | Agent affecté à 10 éleveurs | J'accède à un éleveur hors de mon portefeuille ; puis je saisis pour un éleveur de mon portefeuille | Accès refusé (portée) ; la saisie est enregistrée avec `on_behalf_of_farm_id` | §3.2, EF-MAR-03 |
| T-10 | Vente de 50 plateaux à 2 500 XAF | J'enregistre | Montant = 125 000 XAF (`amount_minor` = 125000) | RG-VEN-01 |
| T-11 | Chien dont la rage est échue | J'ouvre sa fiche | Alerte visuelle « rappel en retard » | EF-CAN-02 |
| T-12 | Export de surveillance | Je génère l'export | Aucune donnée individuelle identifiante | RG-SUR-01 |
| T-13 | Mâle et femelle demi-frère et demi-sœur (même père) | Je vérifie l'accouplement | F = 12,5 %, verdict « à éviter » | EF-GEN-03, RG-GEN-02 |
| T-14 | Cousins germains ; puis deux animaux sans ancêtre commun | Je vérifie | F = 6,25 % « à éviter » ; puis F = 0 % « acceptable » | RG-GEN-01/02 |
| T-15 | Pedigree connu sur une seule génération | Je vérifie | Verdict préfixé « minoré », mention « pedigree incomplet » | RG-GEN-03 |
| T-16 | Accouplement « à éviter » | J'enregistre la saillie sans confirmer | L'alerte s'affiche ; sans confirmation, l'enregistrement est refusé (API : 422 `BUSINESS_RULE`) | EF-GEN-04 |
| T-17 | Animal A, père de B | Je déclare B comme père de A | Refus : boucle de pedigree | RG-MDD-05 |
| T-18 | Exploitation Pro avec 2 caméras ; un membre sans `camera_access` | J'ajoute une 3e caméra ; le membre ouvre un flux | 429 `QUOTA_EXCEEDED` ; 403 pour le membre | EF-CAM-05, §4.22 |
| T-19 | Clip de mouvement daté de J | J+8 (conservation de 7 jours) | Clip purgé ; l'événement reste, sans `clip_uri` | RG-CAM-02 |
| T-20 | Lot de pondeuses traité, avec un délai d'attente œufs jusqu'à J+7 | J'enregistre une vente d'œufs à J+3 | Vente refusée, message avec la date de fin du délai | RG-VEN-02, EF-VAC-05 |
| T-21 | Exploitation en RDC (CDF) | Je saisis une dépense de 1 250,50 CDF ; j'ouvre la trésorerie d'un compte qui a aussi une exploitation en XAF | `amount_minor` = 125050 ; trésorerie présentée séparément par devise | §0.2 de `03`, RG-MDD-06 |
| T-22 | Hors ligne | J'émets une facture de 2 lignes (4 séances × 5 000 ; 3 jours × 3 000) | Total 29 000 ; numéro « PROV-… » ; numéro définitif attribué à la synchronisation, sans doublon | RG-DRE-01 |
| T-23 | Chien dont la rage est échue | Je demande son admission en pension | Admission « différée », avec proposition de vaccination | RG-DRE-02 |
| T-24 | Utilisateur qui a consenti aux agrégats, puis révoque le jour D | Agrégats calculés après D | Ses données sont exclues | RG-CON-01 |
| T-25 | Utilisateur | Je demande l'export puis la suppression de mon compte | Lien d'export disponible en ≤ 72 h ; suppression planifiée à +30 j, annulable ; exécutée ensuite avec anonymisation des journaux | EF-CON-03/04 |
| T-26 | Abonné Pro avec 5 rappels non critiques le même jour | Envoi serveur | 1 seul SMS regroupé ; jamais plus de 3 messages par jour ; un rappel de rage reste envoyé | RG-NOT-02, RG-VAC-04 |
| T-27 | Lapine A × mâle B ; mise-bas de 8 nés vivants ; sevrage de 7 | J'enregistre le sevrage « en lot » ; puis une mise-bas de chienne avec 2 chiots individualisés | Un lot de 7 avec `origin_litter_id` ; 2 `dogs` avec `litter_id`, `sire_id` et `dam_id` renseignés | EF-REP-03, EF-CAN-03 |
| T-28 | Lot de porcs : moyenne de mortalité à 0, puis 4 morts dans la journée | Je saisis le journal | Alerte de mortalité anormale, avec le bouton « Signaler » ; si je choisis PPA, bandeau « maladie réglementée » et proposition de prévenir le vétérinaire | RG-JOU-06, EF-BIO-03 |
| T-29 | Check-list `bio_porc_hebdo` avec « swill non traité » = Non | J'enregistre | Score calculé ; 1 manquement critique ; tâche corrective créée à J+1 | EF-BIO-01 |
| T-30 | Paramètres par défaut de chaque atelier (`10` §1 à §6) | Je lance la projection (mobile et API) | Les valeurs de contrôle sont reproduites à ±0,5 près (ex. porcins : marge 3 129 686 ; cuniculture : 23 cages, marge 52 467) ; résultats identiques sur mobile et serveur | RG-PRJ-01/02 |
| T-31 | Tâche hebdomadaire « pesée » | Je la coche « fait » | L'occurrence suivante est créée à +7 j, avec son rappel local | EF-TAC-01 |
| T-32 | Logement en vide sanitaire jusqu'à J+5 | Je place un nouveau lot dans ce logement | Alerte (contournable avec une confirmation) | RG-CHE-02 |
| T-33 | Journal déjà saisi pour B01 aujourd'hui, sur un autre appareil hors ligne | Les deux appareils se synchronisent | Un seul journal pour (B01, aujourd'hui), avec ses champs fusionnés | RG-JOU-05 |
| T-34 | Abonnement Pro expiré à J, téléphone hors ligne | J+3, puis J+8 | J+3 : modules Pro accessibles (grâce) ; J+8 : modules Pro en lecture seule ; données intactes | RG-ABO-01 |
| T-35 | Certificat antirabique partagé | Un tiers scanne le QR (`/certificates/verify`) | « Valide jusqu'au … » ; ni le téléphone ni le nom complet du propriétaire ne sont exposés | EF-VAC-06, GOV-06 |
| T-36 | Zone où seules 3 exploitations ont consenti | Une Structure ouvre la carte de couverture | La cellule est masquée (< 5) | RG-SUR-02 |
| T-37 | Passerelle neuve et code QR | J'associe la passerelle à mon exploitation | Certificat client délivré une seule fois ; passerelle « en ligne » en moins de 2 min ; révocation possible | EF-IOT-01 |
| T-38 | Capteur de poulailler, règle par défaut > 32 °C pendant 30 min | La température reste à 33 °C pendant 31 min | Alerte critique ouverte et notifiée (push + SMS) en moins de 2 min après la 30e minute | EF-IOT-05, ENF-IOT-01 |
| T-39 | Internet coupé à la ferme (passerelle sans données mobiles), SIM active | Débit d'eau nul pendant 2 h en journée | Sirène locale et SMS de secours envoyés par la passerelle ; alerte remontée au serveur au retour du réseau, avec `origin = passerelle` | EF-IOT-06 |
| T-40 | Alerte critique, astreinte à 2 niveaux | Personne n'acquitte | Niveau 2 prévenu à 15 min, appel vocal à 30 min ; l'escalade s'arrête dès l'acquittement | EF-IOT-07 |
| T-41 | Alerte critique de chaleur ; 40 morts saisies 6 h plus tard dans le même logement | Je résous l'alerte sans action, puis avec une action | Refus sans action (RG-IOT-02) ; mortalité reliée à l'alerte (RG-IOT-03) | EF-IOT-08 |
| T-42 | Pack pays CM avec rappel antirabique annuel `verrouillée` | Un pack d'organisation passe l'intervalle à 2 ans | Publication refusée à la validation (RG-PAR-01) ; message indiquant la politique et le niveau | EF-PAR-02 |
| T-43 | Version de `filiere.porcin` rédigée par A | A tente de la publier seul | Refus `RG-PAR-04` ; publication possible après approbation de B | EF-PAR-06 |
| T-44 | Version 2.1.0 publiée, erreur signalée | Retour arrière vers 2.0.0 | Les téléphones repassent à 2.0.0 à la synchronisation suivante ; les saisies faites en 2.1.0 gardent `param_version = 2.1.0` et restent lisibles | EF-PAR-06, RG-PAR-03 |
| T-45 | Pack pays avec correspondance DHIS2, consentements et convention en place | J'exporte la couverture antirabique d'un mois | Fichier produit en moins de 10 min, empreinte sha256, cellules de moins de 5 exploitations masquées, export journalisé | EF-INT-02, ENF-INT-01 |
| T-46 | Traitement à l'oxytétracycline (principe actif renseigné, 2 g) | Calcul des agrégats annuels | Quantité comptée dans la classe « tétracyclines » pour l'espèce et la zone ; aucun identifiant d'exploitation | EF-AMU-01/02 |
| T-47 | Champ RFID | Je saisis 15 chiffres dont le code pays n'existe pas, puis un numéro valide | Erreur de format, puis acceptation | ISO 11784 (`14`) |
| T-48 | Animal avec 3 événements | Export ICAR ADE | Document valide selon les schémas ICAR ADE v1.5 (validation automatique) | EF-INT-01 |
| T-49 | Utilisateur au Cameroun, région `prod-cm` | Une tâche tente de copier ses données personnelles vers une autre région | Opération refusée et journalisée ; seuls les agrégats autorisés sortent | EF-CMP-03 |
| T-50 | Jeu de 5 000 vecteurs (expressions, résolution, rappels, projection, consanguinité) | Exécution en Dart et en TypeScript | Résultats identiques à 100 % | ENF-PAR-02 |
| T-51 | Pack d'organisation qui ajoute le champ « couleur de bague » au journal | Synchronisation, saisie, puis retrait du champ | Le champ apparaît sans mise à jour de l'application ; valeur stockée dans `attributes` et validée ; après le retrait, la valeur reste visible dans l'historique | EF-PAR-04, RG-MDD-07 |
| T-52 | Analytique désactivée dans les réglages ; puis activée | J'utilise l'application | Aucun événement envoyé ; puis des événements sans contenu saisi ni identifiant direct | ENF-ANA-01 |
| T-53 | Vétérinaire, éleveur sans smartphone | Le vétérinaire crée l'éleveur, l'éleveur confirme par SMS, puis réclame sa fiche dans l'application | Rappels envoyés par SMS ; transfert de propriété tracé (`farm_claims`) | EF-VTR-01/02 |
| T-54 | Téléphone simple, rappel antirabique du jour | Menu USSD : 1 → choisir le rappel → « Fait » | Rappel confirmé, occurrence suivante planifiée ; session de moins de 3 min | EF-NOT-05 |
| T-55 | Fichier de 312 lignes, dont 4 erronées | Import du cheptel d'une coopérative | 308 lignes importées après validation ; rapport des 4 erreurs (ligne, champ, message) | EF-INT-09 |

## 3. Matrice de traçabilité (exigence → écran → données → API → test)

| Exigence | Écran | Données | API | Test |
|---|---|---|---|---|
| EF-VAC-01/03 | E22, E20 | health_events, reminders | POST /health-events | T-01 |
| EF-VAC-04 | E21 | reminders | POST /reminders/:id/confirm | T-02 |
| RG-VAC-02 | E10, E20 | reminders | GET /reminders | T-03 |
| EF-VAC-05, RG-VEN-02 | E14, E25 | health_events, products_sales | POST /farms/:id/sales | T-20 |
| EF-VAC-06 | E23 | health_events | GET /health-events/:id/certificate, /certificates/verify | T-35 |
| EF-STK-01, RG-STK-01 | E27 | stock_movements | GET /farms/:id/stock-summary | T-04 |
| RG-JOU-03/05/06 | E13 | daily_logs | POST /farms/:id/daily-logs | T-05, T-28, T-33 |
| EF-ABO-01/02, RG-ABO-01 | E50, verrous | subscriptions, ref_plan_features | /subscriptions/*, /payments/webhook | T-06, T-08, T-34 |
| EF-SYN-03 | (transverse) | toutes | /sync/push, /sync/pull | T-07, T-33 |
| §3.2, EF-MAR-03 | E67 | memberships, audit_log | (autorisation) | T-09 |
| RG-VEN-01 | E25 | products_sales | POST /farms/:id/sales | T-10 |
| EF-CAN-02 | E30 | dogs, health_events | GET /dogs/:id | T-11 |
| RG-SUR-01/02 | E61 | schéma surveillance | GET /surveillance/* | T-12, T-36 |
| EF-GEN-01→04, RG-GEN-* | E16, E24 | animals/dogs (sire_id, dam_id), mating_checks | POST /mating-checks, POST /reproduction-events | T-13→T-16 |
| RG-MDD-05 | E12 | animals, dogs | PATCH /animals/:id | T-17 |
| EF-CAM-*, RG-CAM-02 | E63, E64 | cameras, camera_events, camera_access | /cameras/* | T-18, T-19 |
| CT-06, RG-MDD-06 | E26, E28 | expenses, ref_currencies | /expenses, /cashflow | T-21 |
| EF-DRE-04/05, RG-DRE-* | E34, E35 | boarding_stays, invoices, invoice_lines, payments | /boarding-stays, /invoices/* | T-22, T-23 |
| EF-CON-*, RG-CON-01 | E03, E65 | consents, account_requests | /me/consents, /me/export, DELETE /me | T-24, T-25 |
| RG-NOT-02, RG-VAC-04 | E60 | outbound_messages, notification_preferences | (tâche planifiée serveur) | T-26 |
| EF-REP-03, EF-CAN-03 | E24 | litters, batches, dogs | POST /litters/:id/wean | T-27 |
| EF-BIO-01/03 | E42, E43 | checklist_runs, disease_signals, tasks | /checklist-runs, /disease-signals | T-28, T-29 |
| EF-PRJ-*, RG-PRJ-* | E29 | projection_scenarios, ref_projection_defaults | POST /projection/compute | T-30 |
| EF-TAC-01 | E44 | tasks, reminders | /tasks/:id/done | T-31 |
| RG-CHE-02 | E12, E15 | housing_units, batches | POST /farms/:id/batches | T-32 |
| EF-IOT-01 à 08 | E70 à E74 | gateways, devices, telemetry, alert_* , oncall_schedules | /gateways, /devices, /alerts, MQTT | T-37 à T-41 |
| EF-PAR-01 à 06 | studio S01 à S07 | param_* | /params, /studio | T-42 à T-44, T-50, T-51 |
| EF-INT-01, 02 | E79 | export_jobs | /exports, /icar/v1 | T-45, T-48 |
| EF-INT-09 | E78 | import_jobs | /imports | T-55 |
| EF-AMU-01/02 | E22 | health_events, ref_active_substances | POST /health-events | T-46 |
| EF-CMP-03 | — | (régions) | — | T-49 |
| EF-VTR-01/02 | E75, E76 | farm_claims | /vet/* | T-53 |
| EF-NOT-05 | E80 | reminders | /inbound/ussd | T-54 |
| ENF-ANA-01 | E60 (réglages) | (entrepôt) | /analytics/events | T-52 |

## 4. Livrables

| Livrable | Contenu | Lot |
|---|---|---|
| Code source | Mobile, backend, PWA, bibliothèques partagées (projection, consanguinité) ; documenté ; droits cédés | Tous |
| Moteurs et schémas *(v2.2)* | `engines-ts`, `engines-dart`, `schemas`, `test-vectors` ; documentation du langage d'expressions | MVP |
| Packs *(v2.2)* | `global.core`, `filiere.*`, `pays.*` avec leurs tests et leurs comptes rendus de revue | MVP → V3 |
| Studio *(v2.2)* | S01 à S07 (V1), S08 et S09 (V2), S10 (V3) | V1 → V3 |
| Suivi à distance *(v2.2)* | `iot-ingest`, logiciel de passerelle, cahier des charges matériel, procédure d'installation | V3 |
| Exploitation *(v2.2)* | infrastructure décrite en code (Terraform, Helm), procédures RB-01 à RB-09, tableaux SLO | MVP |
| Applications | Android (APK/AAB signé), iOS (ultérieur), PWA organisation | MVP / V1 |
| Backend déployable | Conteneurs, migrations, **seed des référentiels** (protocoles, maladies, intrants, check-lists, calendriers, paramètres de projection, formules) | MVP / V1 |
| Maquettes complémentaires | Écrans sans maquette listés à la fin de `02` | avant chaque lot |
| Documentation | Technique (installation, exploitation, API OpenAPI) et utilisateur (guides par filière) | Tous |
| Tests | Jeux automatisés, rapport de couverture, **tests dorés de projection**, données de recette | Tous |
| Exploitation | Plan de sauvegarde et de restauration ; supervision ; réversibilité | Tous |
| Formation | Équipe et utilisateurs pilotes (dont les agents de coopérative) | MVP / V1 |

## 5. Démarche et lots
Méthode agile, livraisons par lots, comité de suivi régulier avec le référent métier. Les charges sont à chiffrer par le prestataire (en jours-homme) ; le découpage en sprints est dans `07`.

| Lot | Contenu | Charge |
|---|---|---|
| Lot 1 — MVP | Socle de paramétrage (moteurs, packs volaille, canin, Cameroun), hors ligne et synchronisation, consentements, cheptel et chien, journal, santé et rappels, tâches simples, stocks, ventes, dépenses, SMS et test USSD, certificat QR, import en masse, Découverte/Pro et paiement (pilote), export et suppression, analytique. Pilote rage canine + volaille. | ≈ 570 j-h (estimation `16`) |
| Lot 2 — V1 | Gouvernance et studio interne, 4 packs filières, logements, mouvements, pesées, reproduction, **généalogie et consanguinité**, antimicrobiens, biosécurité, signalement, trésorerie, **projection**, dressage, pension, facturation, Pro canin, mode vétérinaire de terrain, marché, Structure et mode agent, multi-pays, WhatsApp, PWA, registres | ≈ 600 j-h |
| Lot 3 — V2 | **Caméras**, campagnes, surveillance et carte, exports nationaux et ICAR ADE, studio ouvert aux Structures, API en lecture, ISO 27001, packs SN et CI ; K9 et vocal si le budget le permet | ≈ 350 à 1 440 j-h selon le périmètre |
| Lot 4 — V3 | **Capteurs IoT et passerelle**, alertes prédictives, assistant WhatsApp, API en écriture, EPCIS, marque blanche, bibliothèque de packs, nouvelles filières | à chiffrer |

## 6. Maintenance, niveaux de service, réversibilité

| Criticité | Exemple | Prise en charge | Résolution visée |
|---|---|---|---|
| Bloquant | Application inutilisable, perte de données, paiement débité sans activation | 2 h ouvrées | 1 jour ouvré |
| Majeur | Rappels non envoyés, paiement en échec, synchronisation bloquée | 1 jour ouvré | 3 jours ouvrés |
| Mineur | Anomalie cosmétique | 3 jours ouvrés | version suivante |

- Garantie de correction des anomalies pendant une période à définir après chaque mise en production.
- Maintenance corrective et évolutive (TMA) selon les niveaux ci-dessus.
- **Réversibilité** : propriété du code et des données, documentation de reprise par un tiers, export dans un format ouvert, option d'hébergement souverain.

## 7. Attendus du prestataire
- Proposition technique : architecture (monolithe modulaire → services), gestion du hors ligne et de la synchronisation, choix technologiques, stratégie vidéo (V2).
- Planning par lots, jalons, charges en jours-homme, composition de l'équipe, références.
- Devis détaillé : développement par lot, licences, hébergement, **coûts unitaires SMS/WhatsApp et frais mobile money**, serveur média, TMA ; hypothèses.
- Modalités de suivi, de recette, de garantie et de réversibilité.
