# 09 — Glossaire et référentiels (v2.2)

> Version 2.2 — 27/10/2026. Ajouts v2.2 : termes du paramétrage et du suivi à distance, principes actifs, capteurs (§13 à §15). Les référentiels deviennent des **packs** (`global.core`, `filiere.*`, `pays.*`, voir `12`). Les protocoles ci-dessous sont **indicatifs** et **éditables** dans l'application. Ils doivent être **validés et adaptés par pays** avec les programmes nationaux et le référent (Jean-Marc). Ils servent de valeurs par défaut au moteur de rappels et sont seedés dans `vaccination_protocols`. Les codes techniques sont ceux de `03` §13.

## 1. Glossaire (FR / EN)

| Terme | English | Définition |
|---|---|---|
| Spéculation | Production type / enterprise | Activité de production précise d'une exploitation (aviculture, cuniculture, élevage canin, dressage…) |
| Lot / bande | Batch / flock | Ensemble d'animaux gérés collectivement (volaille, petits ruminants, porcs, lapins) |
| Logement | Housing unit | Bâtiment, cage, case, box ou parc |
| Rappel | Reminder (recall) | Relance programmée d'une action (vaccination, traitement, tâche, séance) |
| Tâche | Task | Action d'élevage datée ou récurrente qui génère un rappel |
| Délai d'attente | Withdrawal period | Période après un traitement pendant laquelle la viande, le lait ou les œufs ne doivent pas être consommés ni vendus |
| Vide sanitaire | Sanitary downtime | Période sans animaux entre deux bandes, après nettoyage et désinfection |
| Mode agent | Agent mode | Un animateur de coopérative gère et saisit pour un portefeuille d'éleveurs |
| Couverture vaccinale | Vaccination coverage | Part des animaux d'une zone effectivement vaccinés (clé pour la rage : 70 % en campagne) |
| Structure | Organisation plan | Client organisationnel (coopérative, clinique, centre canin, projet, unité K9, service vétérinaire) |
| Feature gating | Feature gating | Contrôle d'accès aux fonctions selon la formule |
| Delta sync | Delta sync | Synchronisation incrémentale par entité, avec un curseur de version |
| Pedigree / généalogie | Pedigree | Ascendance d'un reproducteur (père, mère, et ainsi de suite) |
| Père / mère | Sire / dam | Reproducteurs parents |
| Coefficient de consanguinité (F) | Inbreeding coefficient | Probabilité que deux allèles d'un individu soient identiques par descendance ; seuil d'alerte par défaut de 6,25 % |
| Vérifier un accouplement | Check a mating | Calcul de F attendu pour la descendance d'un mâle et d'une femelle |
| Projection | Projection / simulation | Calcul des effectifs, de la production, des intrants et de l'économie à partir d'une unité d'entrée |
| Indice de consommation (IC) | Feed conversion ratio (FCR) | kg d'aliment par kg de poids vif produit |
| GMQ | Average daily gain (ADG) | Gain moyen quotidien (g/jour) |
| Productivité numérique | Weaned per female per year | Nombre de sevrés par femelle et par an |
| Signalement | Disease report | Déclaration d'une suspicion de maladie par l'éleveur |
| Maladie réglementée | Notifiable disease | Maladie à déclaration obligatoire (liste OMSA et listes nationales) |
| Surveillance à distance | Remote monitoring | Option caméras (Wi-Fi ou 4G), avec détection de mouvement et clips |
| Unité mineure | Minor unit | Plus petite subdivision d'une devise (ISO 4217) ; base de stockage des montants |

## 2. Spéculations, espèces, modes de gestion

| Spéculation | Espèces | Mode de gestion | Unité d'entrée de la projection |
|---|---|---|---|
| aviculture | volaille | lot (bande) | poussins par bande (chair) ; pondeuses (ponte) |
| petits_ruminants | ovin, caprin | lot + reproducteurs individuels | femelles reproductrices |
| bovins | bovin | individuel | vaches |
| porcins | porcin | lot (engraissement) + truies et verrats individuels | truies |
| cuniculture | lapin | lot (engraissement) + lapines et mâles individuels | lapines reproductrices |
| elevage_canin | chien | individuel | chiennes reproductrices |
| dressage, pension_canine | chien | individuel (chiens de clients) | chiens en dressage, chiens en pension |
| veterinaire, cooperative | toutes | selon les exploitations suivies | — |

Durées de gestation (`ref_species`) : lapin 31 j · porcin 114 j · ovin et caprin 150 j · bovin 283 j · chien 63 j.

## 3. Maladies prioritaires par espèce

R = réglementée (déclaration obligatoire, à confirmer par pays) · Z = zoonose · ✗ = pas de vaccin.

| Espèce | Maladies (code) |
|---|---|
| Volaille | newcastle (R), gumboro, marek, bronchite_infectieuse, variole_aviaire, coccidiose, coryza, salmonellose (Z), colibacillose, **influenza_aviaire (R, Z)** |
| Petits ruminants | **ppr (R)**, ppcc, clavelee (R), variole_caprine (R), charbon (R, Z), ecthyma (Z), parasitisme_gi, gale |
| Bovins | **fievre_aphteuse (R)**, **ppcb (R)**, dermatose_nodulaire (R), charbon (R, Z), brucellose (R, Z), tuberculose (R, Z), trypanosomose, mammite |
| Porcins | **peste_porcine_africaine (R, ✗)**, peste_porcine_classique (R), rouget (Z), colibacillose_porcelet, anemie_porcelet, gale |
| Lapins | vhd (R), myxomatose, coccidiose, pasteurellose, enterite, gale |
| Chiens | **rage (R, Z)**, chppil (valences : carré, hépatite de Rubarth, parvovirose, parainfluenza, leptospirose), toux_chenil, ehrlichiose, babesiose, leishmaniose (Z) |

## 4. Protocoles vaccinaux et prophylactiques — valeurs par défaut

Format : maladie — primo — rappel — remarque. Âges en jours (J) ou en semaines (sem.).

**Volaille — chair**
- marek — J1 (couvoir) — — — souvent fait au couvoir : à saisir comme acte reçu.
- newcastle + bronchite_infectieuse — J7 (HB1, oculaire) — rappel J18–J21 (La Sota) — *v2.1 : harmonisé avec le dossier aviculture (la v2.0 indiquait J21–J28 ; à trancher par le référent)*.
- gumboro — J10–J14 — rappel J18–J21.

**Volaille — ponte (en plus du programme chair)**
- gumboro — rappel J18–J21.
- variole_aviaire — 6–8 sem. — 1 fois (transfixion alaire).
- newcastle (vaccin huileux) — 6–8 sem. — rappels avant la ponte (16–18 sem.), puis toutes les 6–8 semaines en ponte selon le programme.
- bronchite_infectieuse — rappel avant la ponte (16–18 sem.).
- coccidiose — prévention par anticoccidien au démarrage (traitement, pas vaccination).

**Petits ruminants**
- ppr — dès 3–4 mois — selon la campagne nationale (immunité longue ; suivi de couverture).
- clavelee / variole_caprine — selon la zone — annuel.
- ppcc / charbon — zones à risque — annuel.
- parasites_internes — déparasitage stratégique 2 à 4 fois par an (saison des pluies).
- parasites_externes — selon le besoin (tiques, gale).

**Bovins**
- fievre_aphteuse — selon le programme national — rappels périodiques (associer le contrôle des mouvements).
- ppcb — selon la campagne — annuel (zone d'endémie).
- dermatose_nodulaire — annuel (zone à risque) ; lutte anti-vecteurs.
- charbon — annuel (zone à risque).
- brucellose / tuberculose — **dépistage** périodique (troupeaux laitiers) ; `event_type = depistage`.
- parasites internes et externes — stratégique, saisonnier.

**Porcins**
- peste_porcine_africaine — **pas de vaccin** : biosécurité (check-list hebdomadaire) et signalement immédiat de toute mortalité brutale.
- peste_porcine_classique — selon disponibilité et indication nationale.
- rouget — truies : avant la saillie, rappel semestriel (indicatif).
- anemie_porcelet — **fer injectable à J3** (`event_type = soin_neonatal`).
- parasites_internes — truies avant la mise-bas ; porcelets au sevrage (indicatif).

**Lapins**
- vhd / myxomatose — selon la disponibilité du vaccin et le contexte local (sinon biosécurité et lutte anti-vecteurs) ; rappel annuel ou semestriel selon le vaccin.
- coccidiose — anticoccidien au sevrage (traitement).
- quarantaine — 2 à 3 semaines pour tout animal introduit (tâche).

**Chiens**
- **rage** — primo dès 3 mois — **rappel annuel obligatoire** (priorité critique ; base de la couverture antirabique).
- chppil — primo 6–8 sem. ; rappels toutes les 3–4 sem. jusqu'à 16 sem. ; puis **rappel annuel**.
- toux_chenil — avant la mise en collectivité ou en pension — annuel.
- parasites_internes — trimestriel (indicatif) ; parasites_externes — mensuel en saison.

## 5. Intrants (`ref_stock_items`, valeurs initiales)

| Catégorie | Codes |
|---|---|
| aliment | aliment_demarrage_chair, aliment_croissance_chair, aliment_finition_chair, aliment_poulette, aliment_ponte, aliment_lapin_granule, aliment_truie_gestation, aliment_truie_lactation, aliment_porcelet, aliment_porc_croissance, aliment_porc_finition, aliment_chien, concentre_ruminant, provende, mais, son_issues, tourteau, dreches |
| fourrage | fourrage_vert, foin, paille, residus_culture |
| mineral | pierre_a_lecher, cmv, calcium_coquille |
| litiere | copeaux, paille_litiere, balle_riz |
| veterinaire / vaccin | vaccin (générique, avec nom commercial et n° de lot), antibiotique, antiparasitaire_interne, antiparasitaire_externe, anticoccidien, fer_injectable, vitamines |
| desinfectant | desinfectant, chaux |
| reproduction | semence_ia, eponge_progestagene |

## 6. Catégories de dépense
achat_animaux · aliment · fourrage · veterinaire · reproduction · main_oeuvre · energie_eau · equipement · batiment_entretien · transport · litiere · biosecurite · frais_marche_taxes · communication · abonnement · divers.

## 7. Produits vendus et unités

| Filière | Produits (code) | Unité par défaut |
|---|---|---|
| Aviculture | oeufs_plateau, oeuf_unite, poulet_vif, poulet_abattu, poule_reforme | plateau, unite, kg/tête |
| Cuniculture | lapin_vif, lapin_carcasse, reproducteur, peau | tête, kg |
| Porcins | porcelet, porc_vif, porc_carcasse, reproducteur | tête, kg |
| Petits ruminants | petit_ruminant_vif, animal_reforme, lait, peau | tête, kg, litre |
| Bovins | lait, bovin_vif, animal_reforme | litre, tête, kg |
| Canin | chiot, prestation (séances et pension, via factures) | tête, séance, jour |
| Transverses | fumier, autre | sac, kg |

Unités : kg · sac · litre · tête · unité · plateau · dose · séance · jour.

## 8. Programmes de dressage
education_chiot · obeissance · protection · detection · pistage · chasse · agility · rehabilitation.

## 9. Check-lists (`checklist_templates`, valeurs initiales)

| Code | Filière | Items critiques (★) et autres |
|---|---|---|
| bio_porc_hebdo | porcins | ★ clôture intacte et accès contrôlé · ★ aucun swill non traité · ★ quarantaine des entrants · pédiluve actif · tenue dédiée · cadavres évacués · lutte contre les nuisibles · pas de matériel partagé avec un autre élevage |
| bio_volaille_bande | aviculture | ★ nettoyage et désinfection faits · ★ vide sanitaire respecté · contrôle des visiteurs · pédiluve · protection contre les oiseaux sauvages · eau propre |
| bio_lapin | cuniculture | ★ quarantaine 2–3 semaines · cages nettoyées · marche en avant · lutte anti-vecteurs |
| bio_ruminant | petits ruminants, bovins | ★ quarantaine des introductions · séparation des lots · gestion des cadavres · hygiène de traite (laitier) |
| admission_pension | pension canine | ★ rage à jour · CHPPiL à jour · toux de chenil (recommandée) · antiparasitaires · contact d'urgence |
| vide_sanitaire | toutes | ★ démontage et lavage · ★ désinfection · séchage · durée minimale respectée |

## 10. Pays, monnaies, mobile money

| Zone | Pays (code) | Devise (exposant) | Mobile money |
|---|---|---|---|
| UEMOA | Sénégal (SN), Côte d'Ivoire (CI), Mali (ML), Burkina Faso (BF), Bénin (BJ), Togo (TG), Niger (NE), Guinée-Bissau (GW) | XOF (0) | Orange Money, MTN MoMo, Moov, Wave, Free Money |
| CEMAC | Cameroun (CM), Gabon (GA), Congo (CG), Tchad (TD), RCA (CF), Guinée équatoriale (GQ) | XAF (0) | Orange Money, MTN MoMo, Airtel Money |
| Guinée | GN | GNF (0) | Orange Money, MTN |
| RDC | CD | CDF (2) | M-Pesa, Orange Money, Airtel Money |
| Madagascar | MG | MGA (2) | Orange Money, MVola, Airtel Money |

Les taux de change ne sont pas gérés à ce stade.

## 11. Langues
- Interface : français (défaut), anglais.
- Vocal et SMS (au moins) : wolof (wo), bambara (bm), dioula (dyu), fulfulde (ff), mooré (mos), lingala (ln), swahili (sw), sango (sg), ewondo (ewo), malgache (mg) — selon le pays.

## 12. Canaux et prestataires
- Types de prestataires : veterinaire · auxiliaire_veterinaire · inseminateur · dresseur · pension · fournisseur · acheteur.
- Canaux de notification : push · sms · ussd · whatsapp · vocal.


## 13. Glossaire v2.2 (FR / EN)

| Terme | English | Définition |
|---|---|---|
| Pack de paramètres | Configuration pack | Document versionné et signé qui décrit formulaires, protocoles, indicateurs, règles, etc. pour un niveau (global, filière, pays, organisation) |
| Résolution | Resolution | Fusion des packs du général au particulier, selon les politiques de surcharge |
| Politique de surcharge | Override policy | libre, bornée, ajout seulement, verrouillée |
| Studio | Configuration studio | Console web d'édition, de revue et de publication des packs |
| Moteur | Engine | Code générique qui exécute des paramètres (formulaires, rappels, calculs, alertes, workflows, droits) |
| Passerelle de ferme | Farm gateway | Boîtier qui relaie les capteurs, applique les règles locales et alerte sans Internet |
| Règle `edge` | Edge rule | Règle d'alerte évaluée sur la passerelle |
| Astreinte | On-call | Personnes prévenues, par niveau et par plage horaire |
| Escalade | Escalation | Passage au niveau suivant si l'alerte n'est pas acquittée |
| Acquittement | Acknowledgement | Prise en charge d'une alerte par une personne |
| Série temporelle | Time series | Mesures horodatées d'un capteur |
| Principe actif | Active substance | Molécule d'un médicament vétérinaire ; classe d'antimicrobien pour les antibiotiques |
| Vétérinaire de terrain | Field vet mode | Usage de l'application par un vétérinaire au service d'éleveurs sans smartphone |

## 14. Profils de capteurs
Voir le catalogue de `13` §3 : `temp_rh`, `nh3`, `co2`, `water_flow`, `water_level`, `silo_level`, `scale`, `activity_tag`, `door_contact`, `power`, `water_quality` (V3). Chaque profil fixe l'unité, la plage, la fréquence par défaut et les règles par défaut (seuils à valider par le référent de la filière).

## 15. Principes actifs et antimicrobiens (`ref_active_substances`)
- Le référentiel est livré dans `global.core`. Chaque substance porte sa classe d'antimicrobien et son niveau d'importance selon la liste de l'OMS des antimicrobiens d'importance médicale (critique de priorité haute, critique, très important, important).
- Les substances autorisées et les délais d'attente par espèce sont **propres à chaque pays**. Ils sont fixés dans le pack pays et validés par le référent sanitaire, à partir des autorisations de mise sur le marché nationales.
- Usage : saisie des traitements (EF-AMU-01) et agrégats anonymes par classe (EF-AMU-02), compatibles avec la collecte ANIMUSE de l'OMSA.
