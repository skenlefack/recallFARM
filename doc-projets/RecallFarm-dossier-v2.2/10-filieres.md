# 10 — Spécificités par filière et moteur de projection (v2.2)

> Version 2.2 — 27/10/2026. En v2.2, chaque filière décrite ici devient un **pack** `filiere.*` (`12`) : ce fichier est la source fonctionnelle de ces packs ; les capteurs conseillés par filière sont ajoutés au §8. Il traduit les six dossiers filières (`*-dossier-detaille.docx`) et les classeurs de projection (`*-modele-projection.xlsx`) en exigences pour le développement : ce que l'application saisit, calcule, rappelle et affiche pour chaque filière.
> Les dossiers restent la référence zootechnique. **Les classeurs sont la référence de calcul** du moteur de projection (RG-PRJ-01).

## 0. Cadre commun

Chaque filière est définie par la même grille :
1. **Gestion** : lot, individuel ou mixte ; ce qui est créé dans `batches`, `animals` ou `dogs`.
2. **Journal** : champs spécifiques de E13.
3. **Reproduction** : événements suivis et création des jeunes.
4. **KPIs** : les 3 KPIs de l'accueil (E10), puis la liste complète (E14, E28).
5. **Calendrier type** : les modèles de tâches (`ref_task_templates`) issus du §11 des dossiers.
6. **Santé** : maladies prioritaires et protocoles (`09`), check-list de biosécurité.
7. **Projection** : unité d'entrée, paramètres par défaut, formules, **valeurs de contrôle** (tests dorés).

Le moteur de projection est une bibliothèque de **fonctions pures** : `project(speculation, production_type, parameters) → results`. Il est identique sur le mobile (Dart) et sur le serveur et la PWA (TypeScript). Les paramètres par défaut sont seedés dans `ref_projection_defaults` à partir des feuilles « Paramètres » des classeurs. Tous les montants par défaut sont en FCFA (XOF/XAF) ; pour un autre pays, les prix par défaut sont à saisir dans `ref_projection_defaults` (sinon les champs de prix restent vides et doivent être renseignés).

---

## 1. Aviculture

**Gestion** : par bande (`batches`, `production_type` = chair, ponte ou poulette). Tout plein – tout vide ; vide sanitaire de 10 à 15 jours entre deux bandes (le logement passe en `sanitary_void_until`).

**Journal** : ponte : œufs pondus, œufs cassés, température ; chair : température, poids moyen hebdomadaire (pesée). Calculs : taux de ponte, mortalité cumulée, IC.

**KPIs de l'accueil** : chair : mortalité cumulée %, IC, âge de la bande (j) ; ponte : taux de ponte du jour %, œufs de la semaine, mortalité cumulée %.
**KPIs complets** : IC (kg d'aliment par kg vif), GMQ, mortalité par bande et par an, taux de ponte, œufs par poule et par an, calibre ; couverture vaccinale (% du programme réalisé à l'échéance), rappels respectés ; marge brute par sujet ou par poule, coût de revient par kg vif ou par œuf, part de l'aliment dans les charges ; ventes (volume, prix moyen, invendus).

**Calendrier type** : quotidien : aliment, eau, observation, mortalités, ramassage des œufs, température et ventilation · hebdomadaire : pesée (chair), courbe de ponte, nettoyage, contrôle des stocks · par bande : vaccinations (protocole), vide sanitaire, préparation de la bande, tri pour la vente · mensuel : bilan sanitaire, contrôle des vaccins et médicaments (stock, péremption, chaîne du froid), point économique.

**Santé** : protocole volaille (`09` §4) ; check-list `bio_volaille_bande` ; **IAHP** réglementée : mortalité anormale → signalement proposé.

**Projection — chair** (classeur `aviculture-modele-projection.xlsx`, feuille Poulet_de_chair)

| Paramètre | Défaut |
|---|---|
| Poussins par bande | 500 |
| Bandes par an | 6 |
| Mortalité par bande | 5 % |
| Durée du cycle / vide sanitaire | 42 j / 14 j |
| Poids vif à l'abattage | 2 kg |
| Indice de consommation | 2 |
| Densité | 10 sujets/m² |
| Ratio eau/aliment | 1,8 |
| Prix de vente / kg vif ; poussin ; aliment | 2 000 ; 500 ; 380 FCFA/kg |
| Vétérinaire / sujet ; litière, énergie, main-d'œuvre / sujet | 100 ; 200 FCFA |

Formules : sujets/an = poussins × (1 − mortalité) × bandes ; poids vif = sujets × poids ; aliment = poids vif × IC ; eau = aliment × ratio ; surface = poussins ÷ densité ; marge = recette − (poussins + aliment + vétérinaire + divers).
**Contrôle** : 2 850 sujets ; 5 700 kg vif ; 11 400 kg d'aliment ; 20 520 L d'eau ; 50 m² ; recette 11 400 000 ; coût 6 687 000 ; **marge 4 713 000** ; marge par sujet 1 654 ; coût de revient 1 173 par kg.

**Projection — ponte** (feuille Pondeuses)

| Paramètre | Défaut |
|---|---|
| Pondeuses | 100 |
| Taux de ponte moyen | 75 % |
| Durée de ponte / élevage avant ponte | 60 sem. / 18 sem. |
| Mortalité annuelle | 8 % |
| Aliment par pondeuse | 115 g/j |
| Œufs par plateau | 30 |
| Ratio eau/aliment | 2 |
| Prix d'un œuf ; aliment ; poulette ; poule de réforme | 100 ; 380/kg ; 3 500 ; 2 500 FCFA |
| Vétérinaire ; énergie et main-d'œuvre (par pondeuse et par an) | 300 ; 500 FCFA |

**Contrôle** : 26 280 œufs ; 876 plateaux ; 4 197,5 kg d'aliment ; 66,7 poules de réforme par an ; **marge 886 283** ; coût de revient 72,6 par œuf.

---

## 2. Petits ruminants (ovins, caprins)

**Gestion** : troupeau en lot (`batches`, viande ou lait) ; reproducteurs individualisés si l'éleveur suit la reproduction ou la généalogie (`animals`, `batch_id` = troupeau). Embouche = lot spécifique (`production_type = embouche`).

**Journal** : effectif, mortalité, complément, eau ; lait (caprins laitiers).

**Reproduction** : lutte (saillie groupée), mise-bas (prolificité), sevrage (environ 90 j) → les jeunes passent en lot.

**KPIs de l'accueil** : productivité numérique, mortalité des jeunes %, couverture PPR %.
**KPIs complets** : productivité numérique, prolificité, intervalle entre mises-bas, mortalité avant et après sevrage, GMQ (embouche), poids ou état à la vente ; couverture PPR, rappels respectés ; marge brute et marge par femelle, marge d'embouche, coût de revient par kg vif ; ventes (saisonnalité, fêtes).

**Calendrier type** : quotidien : complément, eau, observation, mortalités, surveillance des mises-bas · hebdomadaire : pesées (embouche), nettoyage, stocks · par cycle ou saison : lutte groupée, mises-bas, sevrage, déparasitage stratégique, vaccinations (PPR) · annuel : renouvellement, planification de l'embouche (fêtes).

**Santé** : **PPR** (ancrage sanitaire : campagnes, couverture) ; check-list `bio_ruminant`.

**Projection** (classeur `petits-ruminants-modele-projection.xlsx`) — unité d'entrée : femelles reproductrices = 50 ; femelles par mâle 25 ; prolificité 1,5 ; mises-bas par femelle et par an 1,3 ; renouvellement 25 % ; mortalité avant / après sevrage 20 % / 10 % ; sevrage 90 j ; vente 300 j à 25 kg ; élevage des futures reproductrices 300 j ; fourrage 1 / 0,5 kg MS par jour (adulte / jeune) ; complément 200 / 100 g par jour ; eau 4 / 2 L par jour ; lait 0 ; prix 2 000 /kg vif, complément 250 /kg, lait 500 /L ; vétérinaire 800, future reproductrice 25 000, main-d'œuvre 2 000, fumier 500 (par femelle et par an).
**Contrôle** : 2 mâles ; 65 mises-bas ; 97,5 nés ; 78 sevrés ; 57,7 vendus ; 1 442,5 kg vif ; effectif présent 126,7 ; complément 5 645,2 kg ; **marge 1 046 200** ; 20 924 par femelle.

---

## 3. Bovins

**Gestion** : individuel (`animals`, boucle obligatoire). Mouvements tracés (EF-CHE-05) : achat, transhumance, vente, ce qui alimente la surveillance.

**Journal** : par vache ou pour le troupeau : lait produit (L), lait vendu ou collecté ; complément ; eau.

**Reproduction** : chaleurs, IA ou saillie, diagnostic de gestation, tarissement, vêlage (283 j) ; le veau est créé individuellement (filiation).

**KPIs de l'accueil** : lait par vache et par jour, intervalle vêlage-vêlage (mois), couverture vaccinale %.
**KPIs complets** : lait par vache et par an, intervalle entre vêlages, taux de vêlage, mortalité des veaux, âge au premier vêlage, GMQ (embouche) ; couverture (fièvre aphteuse, PPCB…), rappels respectés et mouvements tracés ; marge brute par vache (hors amortissement), coût de revient du litre ou du kg vif, taux de collecte laitière.

**Calendrier type** : quotidien : traite, complément, eau, observation, relevé de production · hebdomadaire : détection des chaleurs, stocks, hygiène · par cycle : IA ou saillie, diagnostic de gestation, tarissement, vêlage, sevrage, déparasitage, vaccinations · mensuel : bilan sanitaire, **dépistage brucellose et tuberculose** (laitier), produits vétérinaires · annuel : renouvellement des génisses, mise à jour des mouvements.

**Santé** : fièvre aphteuse, PPCB, dermatose nodulaire (réglementées) ; zoonoses (brucellose, tuberculose) ; délai d'attente **lait** ; check-list `bio_ruminant` (hygiène de traite).

**Projection** (classeur `bovins-modele-projection.xlsx`) — unité d'entrée : vaches = 10 ; intervalle de vêlage 14 mois ; mortalité des veaux 12 % ; vaches par taureau 25 (0 si IA) ; renouvellement 20 % ; lait 5 L par jour sur 270 jours ; vente des jeunes à 24 mois, 200 kg ; réforme 300 kg ; fourrage 8 / 4 kg MS ; complément 2 / 1 kg par jour ; eau 40 / 20 L par jour ; lait 350 /L ; prix 1 500 /kg vif ; complément 250 /kg ; vétérinaire 5 000, main-d'œuvre 20 000, fumier 5 000 (par vache et par an).
**Contrôle** : 1 taureau ; 8,571 vêlages ; 7,543 veaux ; 13 500 L de lait ; 5,543 jeunes vendus ; 2 réformes ; effectif 26,09 ; complément 12 806,3 kg ; recette 7 337 857 ; **marge 3 886 286** (hors amortissement) ; 388 629 par vache ; coût de revient 237 par litre (indicatif).
Mention obligatoire à l'écran : « marge brute avant amortissement des animaux et des infrastructures ».

---

## 4. Porcins

**Gestion** : truies et verrats individualisés (`animals`) ; porcelets et porcs d'engraissement en lots (`batches`, créés au sevrage depuis la portée).

**Journal** : effectif, mortalité, aliment par phase, eau ; **mortalité brutale → alerte PPA** (RG-JOU-06, toute mortalité inexpliquée).

**Reproduction** : saillie ou IA, diagnostic de gestation, mise-bas (114 j), **fer à J3** (tâche automatique), sevrage (42 j) → lot d'engraissement.

**KPIs de l'accueil** : sevrés par truie et par an, mortalité avant sevrage %, score de biosécurité %.
**KPIs complets** : porcs vendus par truie et par an, sevrés par truie et par an, nés vivants par portée, portées par truie et par an, mortalité avant et après sevrage, IC d'engraissement ; conformité de biosécurité, rappels respectés, suspicions notifiées ; marge brute par truie (coûts variables), coût de revient par kg vif, coût de l'aliment.

**Calendrier type** : quotidien : aliment, eau, observation (fièvre, mortalité soudaine = alerte PPA), hygiène · hebdomadaire : pesées, stocks, **check-list biosécurité** · par bande : saillie ou IA, diagnostic, mise-bas, fer, sevrage, vide sanitaire · mensuel : audit de biosécurité, produits vétérinaires, point économique.

**Santé** : **PPA (réglementée, sans vaccin)** : la biosécurité est le pilier ; check-list `bio_porc_hebdo` (★ pas de swill non traité) ; PPC, rouget.

**Projection** (classeur `porcins-modele-projection.xlsx`) — unité d'entrée : truies = 10 ; truies par verrat 15 (0 si IA) ; 2 portées par truie et par an ; 9 nés vivants par portée ; renouvellement 35 % ; mortalité avant / après sevrage 15 % / 8 % ; sevrage 42 j à 12 kg ; abattage 210 j à 80 kg ; IC 3,5 ; aliment truie et verrat 2,5 kg par jour ; eau 15 / 6 L par jour ; prix 1 500 /kg vif ; aliment 300 /kg ; vétérinaire 3 000, cochette 60 000, main-d'œuvre 5 000, fumier 1 000.
**Contrôle** : 1 verrat ; **20 portées ; 180 nés ; 153 sevrés** ; 140,76 finis ; 137,26 porcs vendus ; 10 980,8 kg vif ; aliment 43 538,4 kg ; eau 202 111 L ; recette 16 481 200 ; **marge 3 129 686** ; 312 969 par truie.
> ⚠️ **Correction v2.1** : le §5 du dossier porcins annonce « ~40 portées, ~360 nés, ~306 sevrés » pour 10 truies. Ces chiffres sont doublés et incohérents avec les 137 porcs vendus et avec le classeur (2 portées × 10 truies = 20). **Le classeur fait foi** ; le dossier est à corriger.

---

## 5. Cuniculture

**Gestion** : lapines et mâles individualisés (`animals`) dans des cages de maternité ; lapereaux en lots d'engraissement (`batches`, créés au sevrage). Logements = cages par catégorie (`housing_units` de type `cage`, rattachées à un `clapier`).

**Journal** : effectif, mortalité, aliment, eau ; contrôle du nid en lactation (observation).

**Reproduction** : saillie, test de gestation (palpation vers J10–J14), préparation du nid, mise-bas (31 j), sevrage (30 j) → lot ; rythme de 7 portées par an.

**KPIs de l'accueil** : productivité numérique (sevrés par lapine et par an), mortalité avant sevrage %, cages occupées / disponibles.
**KPIs complets** : productivité numérique, taux de mise-bas, taille de portée, mortalité avant sevrage et en engraissement, IC, poids moyen à la vente ; couverture prophylactique, incidence des affections, rappels respectés, respect des délais d'attente ; marge par femelle, coût de revient par kg vif, part de l'aliment (60 à 70 %), invendus.

**Calendrier type** : quotidien : alimentation, eau, observation, mortalités, contrôle du nid · hebdomadaire : pesées, nettoyage, stocks · par cycle : saillie, test de gestation, nid, mise-bas, sevrage, anticoccidien, tri pour la vente · annuel : renouvellement des reproducteurs. Quarantaine de 2 à 3 semaines pour tout lapin introduit.

**Santé** : coccidiose, entérites, pasteurellose, gale ; VHD et myxomatose selon la zone ; check-list `bio_lapin`.

**Projection** (classeur `cuniculture-modele-projection.xlsx`) — unité d'entrée : lapines = 10 ; 8 femelles par mâle ; 7 portées par an ; 8 nés vivants par portée ; renouvellement 100 % ; mortalité avant sevrage / engraissement 15 % / 8 % ; sevrage 30 j ; vente 90 j à 2,3 kg ; élevage des futures reproductrices 120 j ; 8 lapins par cage ; 1,1 cage de maternité par femelle ; aliment 200 / 160 / 120 / 130 g par jour (femelle / mâle / engraissement / future reproductrice) ; eau 0,7 / 0,4 / 0,3 L ; prix d'un lapin 4 000 ; aliment 380 /kg ; vétérinaire 1 500, future reproductrice 4 000, main-d'œuvre 3 000, fumier 500.
**Contrôle** : 2 mâles ; 70 portées ; 560 nés ; 476 sevrés ; 437,92 finis ; 427,92 vendus ; 984,2 kg vif ; effectif 87,3 ; **23 cages** (11 + 2 + 9 + 1) ; aliment 4 155,8 kg ; eau 11 089,6 L ; recette 1 716 680 ; **marge 52 467** ; 5 247 par femelle ; coût de revient environ 1 691 par kg vif.
Mention à l'écran : « Montée en régime : premières ventes vers le mois 5 » (feuille Projection_mensuelle du classeur — à reprendre en V2 pour une vue mensuelle).

---

## 6. Activité canine

**Gestion** : individuel (`dogs`). Les chiots naissent dans `dogs` (`litter_id`, filiation). Les chiens de clients (dressage, pension) ont `owner_client_id`.

**Journal** : non utilisé pour l'élevage canin. La pension utilise le séjour (`boarding_stays`) et les tâches quotidiennes (soins des pensionnaires).

**Reproduction** : chaleurs, saillie (avec contrôle de consanguinité), mise-bas (63 j), chiots (poids de naissance), primo-vaccination CHPPiL à 6–8 sem., sevrage (8 sem.), cession (10 sem.).

**KPIs de l'accueil** : élevage : chiots vendus par chienne et par an, rage à jour % des chiens, portées en cours ; dressage et pension : séances de la semaine, taux d'occupation de la pension %, factures impayées.
**KPIs complets** : chiots vendus par chienne et par an, chiots par portée, portées par chienne et par an, mortalité néonatale, taux de vaccination et de vermifugation ; couverture antirabique (clientèle), séances et progression, taux d'occupation de la pension, marges par activité, prix moyens.

**Calendrier type** : quotidien : alimentation, eau, hygiène du chenil, soins des pensionnaires · hebdomadaire : séances, stocks, hygiène approfondie · par portée : saillie, mise-bas, soins néonatals, primo-vaccination, socialisation, cession · annuel : **rage**, CHPPiL, renouvellement des reproducteurs, recyclage des chiens de travail.

**Santé** : **rage** (rappel annuel obligatoire, certificat, admission en pension) ; parvovirose (chiots) ; check-list `admission_pension`.

**Projection — élevage** (classeur `canin-modele-projection.xlsx`, feuille Elevage_canin) — unité d'entrée : chiennes = 5 ; 1,5 portée par an ; 6 chiots par portée ; mortalité néonatale 15 % ; sevrage 8 sem. ; vente 10 sem. ; renouvellement 25 % ; aliment adulte 0,4 kg par jour ; prix d'un chiot 60 000 ; croquettes 800 /kg ; vétérinaire par chienne 15 000 ; soins par chiot 5 000 ; chienne de renouvellement 100 000 ; main-d'œuvre 10 000 par chienne.
**Contrôle** : 1 étalon ; 7,5 portées ; 45 nés ; 38,25 sevrés ; 1,25 gardées ; **37 chiots vendus** ; aliment 1 010 kg ; recette 2 220 000 ; coût 1 242 900 ; **marge 977 100** ; 195 420 par chienne.
> Dans le classeur, le nombre d'étalons utilise un ratio fixe de 5 chiennes par étalon, écrit en dur dans la formule (`ROUNDUP(chiennes/5)`). Le moteur en fait un paramètre (`chiennes_par_etalon`, défaut 5).

**Projection — dressage et pension** (feuille Dressage_pension) — 10 chiens en dressage ; 4 séances par chien et par mois ; 5 000 par séance ; 4 chiens en pension ; 3 000 par jour ; aliment 0,4 kg par jour à 800 /kg ; main-d'œuvre 1 500 000 par an ; installation 400 000 par an.
**Contrôle** : 480 séances ; recette dressage 2 400 000 ; 1 460 journées ; recette pension 4 380 000 ; **recette totale 6 780 000** ; coût 2 367 200 ; **marge 4 412 800**.

---

## 7. Tests dorés du moteur de projection
Pour chaque filière et chaque atelier, avec les paramètres par défaut ci-dessus, le moteur doit reproduire les valeurs de **contrôle** à ±0,5 unité près (avant arrondi d'affichage). Toute évolution de formule incrémente `engine_version` et met à jour à la fois le classeur de référence et les tests (`11` T-30).


## 8. Correspondance filière → pack, capteurs conseillés *(v2.2)*

| Filière | Pack | Version | Objets principaux | Capteurs conseillés (`13` §3) |
|---|---|---|---|---|
| Aviculture | `filiere.volaille` | MVP | chair, ponte, poulette ; journal de ponte ; protocole volaille ; check-list `bio_volaille_bande` ; projections chair et ponte | `temp_rh`, `nh3`, `water_flow`, `silo_level`, `scale` |
| Activité canine | `filiere.canin` | MVP | élevage, dressage, pension ; protocole chien (rage verrouillée par le pack pays) ; check-list `admission_pension` ; projections élevage et services | caméra (box, chenil), `temp_rh` (chenil) |
| Porcins | `filiere.porcin` | V1 | naissage-engraissement ; fer à J3 ; alerte de mortalité brutale (PPA) verrouillée ; check-list `bio_porc_hebdo` ; projection | `temp_rh`, `water_flow`, `door_contact`, caméra (maternité) |
| Petits ruminants | `filiere.petits_ruminants` | V1 | troupeau, embouche, lait ; PPR ; projection | `activity_tag`, `water_level`, `door_contact` |
| Bovins | `filiere.bovin` | V1 | individuel, traite, mouvements ; dépistages ; projection | `activity_tag`, `water_level`, `door_contact` |
| Cuniculture | `filiere.lapin` | V1 | lapines individualisées, cages, sevrage en lot ; projection (23 cages) | `temp_rh`, `nh3` |
| Pisciculture | `filiere.pisciculture` | V3 | cages et étangs, échantillonnages, IC, survie | `water_quality` |
| Apiculture | `filiere.apiculture` | V3 | ruchers, visites, récoltes | balance de ruche (`scale`) |

**Règle de passage d'une filière en production** :
- pack relu par un référent de la filière (RG-PAR-04) ;
- tests dorés de projection au vert (T-30) ;
- 8 à 12 éleveurs testeurs sur le terrain ;
- publication progressive (EF-PAR-09).
