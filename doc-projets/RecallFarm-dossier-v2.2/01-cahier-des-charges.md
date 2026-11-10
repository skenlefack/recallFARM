# 01 — Cahier des charges fonctionnel (v2.2)

> Version 2.2 — 27/10/2026. Ce fichier consolide le cahier des charges v2.0, l'addendum « consanguinité & caméras », les six dossiers filières (v2.1) et le **document conceptuel** du 26/10/2026 (v2.2 : paramétrage, suivi à distance, normes, interopérabilité, analytique). En cas de divergence, **la v2.2 fait foi**. Les fichiers `12` à `17` détaillent les nouveaux domaines.
> Les champs des formulaires sont décrits **une seule fois**, dans `02-specifications-ecrans.md`. Les tables et énumérations sont dans `03-modele-de-donnees.md`.

## 1. Introduction

### 1.1 Contexte
RecallFarm est une application mobile et web de **gestion d'élevage et d'activité canine** pour l'Afrique francophone. Elle fonctionne **hors ligne d'abord** et repose sur un **moteur de rappels multicanal** (notification locale, SMS/USSD, WhatsApp, vocal). Elle s'adresse au petit éleveur comme aux professionnels canins (élevage, dressage, pension, K9), aux coopératives, aux vétérinaires et aux services vétérinaires publics.

### 1.2 Objectifs (SMART)
- **OBJ-01** : un éleveur tient un registre complet et programme ses rappels en **moins de 5 minutes par jour**, hors ligne.
- **OBJ-02** : mesurer un **taux de confirmation des rappels** (dont la rage) par zone, pour alimenter la couverture vaccinale.
- **OBJ-03** : couvrir **6 filières** (aviculture, petits ruminants, bovins, porcins, cuniculture, activité canine), 3 formules d'abonnement plus l'option Institution, et le paiement mobile money multi-pays.
- **OBJ-04** : fonctionner sur un Android d'entrée de gamme, en 2G/EDGE, avec une synchronisation **sans perte**.
- **OBJ-05** : ajouter une filière ou ouvrir un pays **sans nouvelle version de l'application**, par publication d'un pack de paramètres validé (`12`).
- **OBJ-06** : détecter et notifier à distance les situations critiques (chaleur, eau, intrusion, maladie) en **moins de 2 minutes**, et **même sans Internet** grâce à la passerelle de ferme (`13`).
- **OBJ-07** : être **interopérable** avec les systèmes de référence (ICAR ADE, DHIS2, ARIS, GARC, EMA-i+) et **conforme** à la Convention de Malabo et aux lois nationales (`14`).

### 1.3 Vision produit
Le **rappel** est le cœur du produit. Chaque rappel sert à la fois le propriétaire (santé, performance) et l'épidémiologie (couverture vaccinale, dont la rage ; signaux sanitaires). Toute fonction est priorisée à l'aune de cette double valeur.

### 1.4 Historique des versions

| Version | Date | Objet |
|---|---|---|
| 1.0 | 16/09/2026 | Cahier des charges initial |
| 2.0 | 16/09/2026 | Version détaillée : champs, dictionnaire, endpoints, états, tests, traçabilité |
| Addendum 1.0 | 16/09/2026 | Options généalogie & consanguinité, caméras |
| 2.1 | 26/10/2026 | Consolidation : addendum intégré, 6 filières, tables manquantes, priorités/versions harmonisées, montants multi-devises, projection, biosécurité, consentement |
| **2.2** | **27/10/2026** | **Intégration du document conceptuel : plateforme paramétrable (studio, packs, moteurs), suivi à distance IoT, normes et conformité, interopérabilité (ICAR ADE, DHIS2, ARIS, GARC, EMA-i+), antimicrobiens, mode vétérinaire de terrain, analytique, version V3** |

## 2. Périmètre, contraintes, dépendances

### 2.1 Inclus
Les modules du §4 : onboarding ; comptes ; consentement et données personnelles ; cheptel (lots, individuels, chiens, logements, mouvements, pesées) ; journal adaptatif ; santé et rappels ; tâches et calendrier ; biosécurité et signalement ; module canin ; reproduction et portées ; généalogie et consanguinité ; dressage, pension et facturation ; K9 ; stocks d'intrants ; ventes ; dépenses et trésorerie ; projection et simulation ; tableau de bord ; surveillance et campagnes ; marché ; contenus ; abonnement et paiement ; caméras ; notifications ; hors ligne et synchronisation ; **paramétrage (studio, packs, moteurs)** ; **suivi à distance par capteurs** ; **interopérabilité et conformité** ; **usage des antimicrobiens** ; **mode vétérinaire de terrain** ; **analytique produit**.

### 2.2 Hors périmètre (à ce stade)
Comptabilité fiscale et paie complètes ; e-commerce transactionnel intégré ; fabrication de matériel (RecallFarm intègre du matériel standard, il n'en fabrique pas) ; gestion des taux de change ; envoi automatique de notifications officielles à WAHIS (prérogative des États).

### 2.3 Contraintes
- **CT-01 Hors ligne d'abord** : aucune saisie ni aucun rappel local ne dépend du réseau. Seuls l'OTP, le paiement, la vidéo des caméras et l'envoi de messages serveur exigent le réseau.
- **CT-02** : les feature phones sont adressés par SMS/USSD, puis par vocal (IVR) en langues locales.
- **CT-03** : 2G/EDGE, Android d'entrée de gamme, APK de taille maîtrisée (cibles dans `08`).
- **CT-04** : français par défaut, anglais, langues locales (au moins vocal/SMS).
- **CT-05** : paiement et encaissement par mobile money, multi-pays et multi-opérateurs.
- **CT-06** : multi-devise (XOF, XAF, GNF, CDF, MGA) **sans conversion** ; montants en unité mineure ISO (voir `03` §0.2).

### 2.4 Dépendances externes

| Dépendance | Nature | Impact si indisponible |
|---|---|---|
| Agrégateur mobile money | Paiement, encaissement | Abonnements payants suspendus ; Découverte reste utilisable ; droits en cache maintenus jusqu'à la fin de la grâce |
| Passerelle SMS/USSD | Rappels sortants, feature phones | Rappels limités au push et à l'app |
| WhatsApp Business API | Rappels, certificats | Repli sur SMS ou push |
| FCM (push) | Notifications applicatives | Repli sur SMS ; rappels locaux inchangés |
| Serveur média (caméras) | Flux vidéo, clips | Module caméras indisponible ; aucun impact sur le reste |
| Référent sanitaire (Jean-Marc) | Validation des protocoles et des maladies réglementées par pays | Valeurs génériques marquées « à valider » |
| Hébergeur national ou autorisation de transfert | Résidence des données (`15` §4) | Ouverture du pays retardée |
| Fournisseurs de matériel IoT et installateurs | Passerelles, capteurs, pose | Option « Ferme connectée » indisponible ; aucun impact sur le reste |
| Formats des systèmes publics (ARIS, DHIS2, GARC, EMA-i+) | Exports d'agrégats | Export CSV générique en attendant |

## 3. Acteurs, rôles, permissions

### 3.1 Personas
1. **Éleveur individuel** — rural, smartphone modeste, réseau intermittent. Il veut ne rater aucun vaccin et suivre ses coûts.
2. **Éleveur canin / dresseur** — urbain, gère plusieurs chiens et clients et doit facturer ; forte exigence sur la rage et les certificats.
3. **Animateur de coopérative (agent)** — gère un portefeuille d'éleveurs, saisit pour eux, lance des campagnes.
4. **Vétérinaire / clinique** — tient des dossiers, envoie des rappels aux clients, facture des prestations.
5. **Responsable K9** — gendarmerie, douanes, sécurité privée : chiens de travail, aptitudes, conformité.
6. **Analyste / service vétérinaire** — tableaux de bord, cartographie, export de surveillance.
7. **Vétérinaire ou auxiliaire de terrain** — sert des éleveurs sans smartphone : actes, certificats, factures sur sa propre application.
8. **Référent métier (paramétrage)** — vétérinaire ou zootechnicien qui rédige, relit et publie les packs dans le studio.

### 3.2 Matrice des permissions
C = créer, L = lire, M = modifier, S = supprimer (logique). Un **agent** agit uniquement dans son `farmer_scope`, et chaque écriture qu'il fait est tracée avec `on_behalf_of_farm_id`.

| Module | Propriétaire | Membre | Agent | Vétérinaire | Admin org. | Prestataire |
|---|---|---|---|---|---|---|
| Cheptel, journal, santé, tâches | CLMS | CLM | CLM (portée) | L + actes (si partage consenti) | CLMS | — |
| Biosécurité, signalements | CLMS | CLM | CLM (portée) | L (signalements reçus) | L | — |
| Reproduction, généalogie | CLMS | CLM | CLM (portée) | L | CLMS | — |
| Stocks, ventes, dépenses, trésorerie | CLMS | CLM | CLM (portée) | — | CLMS | — |
| Dressage, pension, facturation | CLMS | CLM | — | — | CLMS | — |
| Projection | CLMS | CL | CL (portée) | — | CLMS | — |
| Caméras | CLMS + attribution des accès | L si accès accordé | L si accès accordé | — | CLMS | — |
| Campagnes, surveillance | — | — | L | L | CLMS | — |
| Marché (demandes) | CL | CL | CL (portée) | L (reçues) | CL | L + statut (reçues) |
| Abonnement | CLMS | L | — | — | CLMS | — |
| Consentements, export, suppression | CLMS (les siens) | les siens | recueil tracé | — | — | — |
| Capteurs, passerelles, alertes | CLMS + astreinte | L, acquittement | L, acquittement (portée) | L (alertes partagées) | CLMS | — |
| Paramètres de l'exploitation (seuils, objectifs) | CLM | L | CLM (portée) | — | CLM | — |
| Packs d'organisation (studio) | — | — | — | — | CLM + publication (V2) | — |
| Packs `global`, `filiere`, `pays` | — | — | — | — | — | rôles internes `param_author`, `referent_sanitaire`, `param_publisher` (`12` §7) |

### 3.3 Multi-tenant et cycle de vie du compte
- Hiérarchie : Organisation (Structure) → Exploitations → Logements → Lots, animaux et chiens. Un utilisateur peut appartenir à plusieurs organisations, avec des rôles distincts.
- Cycle du compte : `provisoire` (hors ligne) → `verifie` (OTP) → `actif` → `suspendu` (non-paiement d'une formule payante : retour aux droits Découverte, données conservées) → `cloture` (suppression à la demande, voir EF-CON-04).

## 4. Exigences fonctionnelles

Notation : **[Priorité MoSCoW · Version]**. Les versions sont **MVP**, **V1**, **V2** et **V3** ; la roadmap `07` reprend exactement ces valeurs. Formule minimale : 🆓 Découverte, ⭐ Pro, 🏢 Structure (voir §4.22).

### 4.1 Onboarding et configuration (ONB)
- **EF-ONB-01 [M · MVP]** : choisir une ou plusieurs spéculations, ce qui conditionne les champs, les protocoles, les calendriers de tâches et les actions proposées. 🆓 1 spéculation active à la fois ; ⭐ plusieurs.
- **EF-ONB-02 [M · MVP]** : créer l'exploitation (nom, pays, région, GPS optionnel, superficie, responsable). La devise est déduite du pays.
- **EF-ONB-03 [S · V1]** : choix de la langue (fr/en au MVP, langues locales pour le vocal et le SMS en V2).
- **EF-ONB-04 [S · MVP]** : à la création, proposer d'activer le calendrier type de la filière (`ref_task_templates`).
- Critère d'acceptation : choisir « élevage canin » affiche la fiche chien individuelle et masque la saisie par bande.

### 4.2 Comptes et authentification (AUT)
- **EF-AUT-01 [M · MVP]** : inscription par téléphone et OTP SMS ; e-mail optionnel.
- **EF-AUT-02 [M · MVP]** : compte provisoire hors ligne, rattaché à la première synchronisation.
- **EF-AUT-03 [S · V1]** : verrouillage optionnel par code PIN.
- **EF-AUT-04 [M · MVP]** : rôles et portée conformes au §3.2.
- **RG-AUT-01** : l'OTP expire après 10 minutes ; 5 tentatives au maximum, puis temporisation de 15 minutes.

### 4.3 Consentement et données personnelles (CON) — *nouveau*
- **EF-CON-01 [M · MVP]** : à l'inscription, acceptation horodatée et versionnée des CGU et de la politique de confidentialité (`consents.scope = cgu_confidentialite`).
- **EF-CON-02 [M · MVP]** : consentements séparés et révocables pour le partage avec une organisation ou un vétérinaire, pour la contribution aux agrégats de surveillance, et pour les messages WhatsApp et SMS.
- **EF-CON-03 [M · MVP]** : export des données de l'utilisateur (JSON + CSV) à la demande, disponible sous 72 h.
- **EF-CON-04 [M · MVP]** : suppression du compte à la demande, exécutée après un délai de rétractation de 30 jours. Les données individuelles sont supprimées et les journaux anonymisés.
- **EF-CON-05 [S · V1]** : un agent peut recueillir un consentement pour un éleveur sans smartphone (`channel = agent`), avec confirmation par SMS.
- **RG-CON-01** : une révocation exclut les données de l'utilisateur de tous les agrégats calculés après la date de révocation.

### 4.4 Cheptel et registre (CHE)
- **EF-CHE-01 [M · MVP]** : créer, consulter, modifier et archiver un lot/bande, un animal individuel ou un chien.
- **EF-CHE-02 [M · MVP]** : formulaire adapté à la filière (voir `02` E12 et `10`) ; photo d'identification.
- **EF-CHE-03 [S · V1]** : recherche et filtres par statut, logement, espèce et type de production.
- **EF-CHE-04 [S · V1]** : logements (`housing_units`) : bâtiments, cages, cases, box, avec capacité et vide sanitaire.
- **EF-CHE-05 [S · V1]** : mouvements (achat, transfert, transhumance, vente, mort), avec pièce justificative. Pour les bovins, la traçabilité des mouvements alimente la surveillance.
- **EF-CHE-06 [S · V1]** : pesées (individuelles ou moyenne d'un échantillon) et courbe de croissance.
- **RG-CHE-01** : effectif courant d'un lot = effectif initial − Σ mortalité − Σ réformes − Σ sorties + Σ entrées, recalculé à partir des événements.
- **RG-CHE-02** : on ne peut pas placer un lot dans un logement en vide sanitaire avant la date `sanitary_void_until`. Une alerte s'affiche, contournable avec une confirmation.

### 4.5 Journal quotidien (JOU)
- **EF-JOU-01 [M · MVP]** : saisie par jour et par lot (ou par animal pour la traite) : effectif présent, mortalité, réformes, aliment, eau, observations. Les champs varient selon la filière : œufs (ponte), lait (bovins, caprins laitiers), température (volaille).
- **EF-JOU-02 [S · V1]** : saisie rapide « en une ligne » et duplication du jour précédent.
- **RG-JOU-01** : taux de ponte = œufs ÷ effectif présent.
- **RG-JOU-02** : taux de mortalité cumulé = Σ mortalité ÷ effectif initial.
- **RG-JOU-03** : la mortalité du jour doit rester ≤ à l'effectif présent, sinon l'erreur est bloquante.
- **RG-JOU-04** : indice de consommation = aliment cumulé ÷ (poids vif total actuel − poids vif initial). Il n'est calculé qu'après au moins une pesée.
- **RG-JOU-05** : une seule saisie par sujet et par jour ; une deuxième saisie modifie la première.
- **RG-JOU-06 [S · V1]** : une mortalité du jour supérieure à 3 fois la moyenne mobile sur 7 jours (ou > 2 % de l'effectif en volaille, ou toute mortalité brutale en porcins) affiche une alerte et propose un **signalement** (EF-BIO-03).

### 4.6 Santé, vaccination et moteur de rappels (VAC) — cœur
- **EF-VAC-01 [M · MVP]** : enregistrer un acte (type, maladie, produit, n° de lot, dose/voie, date, coût, réalisé par).
- **EF-VAC-02 [M · MVP]** : protocoles préchargés par espèce et par pays (voir `09`), qui proposent le prochain rappel ; la date reste ajustable.
- **EF-VAC-03 [M · MVP]** : rappels locaux (notification) dans toutes les formules. ⭐ Rappels SMS **[M · MVP]** et WhatsApp **[S · V1]** quand l'utilisateur est en ligne et l'a consenti. Relances à J-7, J-1, jour J et J+3.
- **EF-VAC-04 [M · MVP]** : confirmer un rappel le clôture et planifie le suivant.
- **EF-VAC-05 [M · MVP]** : délais d'attente viande, lait et œufs : alerte visuelle et blocage des ventes concernées jusqu'à l'échéance (RG-VEN-02).
- **EF-VAC-06 [S · MVP]** ⭐ : certificat de vaccination avec QR code (dont antirabique), en PDF, partageable et consultable hors ligne.
- **EF-VAC-07 [S · V2]** 🏢 : campagnes de masse et suivi de couverture (voir SUR).
- **EF-VAC-08 [S · V1]** : un acte vétérinaire décrémente le stock du produit utilisé (`stock_movement_id`).
- **RG-VAC-01** : `date_rappel = date_acte + intervalle` (étape suivante du protocole).
- **RG-VAC-02** : un rappel manqué reste actif, remonte en priorité et alimente la couverture.
- **RG-VAC-03** : la fréquence des envois est plafonnée (voir RG-NOT-02) ; on peut se désinscrire canal par canal.
- **RG-VAC-04** : les rappels de rage et de maladies réglementées ont la priorité `critique`. Ils ne sont jamais plafonnés en push, et ils ne sont plafonnés en SMS qu'au-delà de 1 par jour.
- Critères d'acceptation : voir `11` (T-01, T-02, T-03).

### 4.7 Tâches et calendrier d'élevage (TAC) — *nouveau*
- **EF-TAC-01 [S · MVP]** : tâches récurrentes ou datées par exploitation ou par sujet (alimentation, pesée, nettoyage, contrôle de stock, traite…), qui génèrent des rappels locaux.
- **EF-TAC-02 [S · V1]** : calendriers types par filière, activables en un clic. Ils sont dérivés des calendriers d'actions des dossiers (voir `10`), par exemple le vide sanitaire à la sortie d'une bande, le sevrage à J+30 d'une mise-bas de lapins ou le fer au porcelet à J3.
- **EF-TAC-03 [C · V1]** : attribution d'une tâche à un membre de l'exploitation.

### 4.8 Biosécurité et signalement (BIO) — *nouveau*
- **EF-BIO-01 [S · V1]** ⭐ : check-lists de biosécurité par filière (accès, pédiluve, quarantaine, vide sanitaire, gestion des cadavres ; en porcins, absence de swill non traité). Elles produisent un score et signalent les manquements critiques.
- **EF-BIO-02 [S · V1]** : rappel périodique de la check-list (hebdomadaire en porcins, par bande en volaille).
- **EF-BIO-03 [S · V1]** : signalement d'une suspicion de maladie (signes, effectifs touchés, morts). Pour une maladie réglementée (IAHP, PPA, fièvre aphteuse, PPR, PPCB, rage…), l'alerte est critique et propose de notifier le vétérinaire ou la Structure, avec le consentement de l'éleveur.
- **EF-BIO-04 [C · V2]** 🏢 : les signalements alimentent les agrégats de surveillance (nombre par zone, jamais d'identité).

### 4.9 Module canin (CAN)
- **EF-CAN-01 [M · MVP]** : fiche chien individuelle complète (champs dans `02` E12/E30).
- **EF-CAN-02 [M · MVP]** : rage annuelle obligatoire avec alerte ; CHPPiL, toux de chenil, antiparasitaires.
- **EF-CAN-03 [S · V1]** : portées (chaleurs, saillie, gestation d'environ 63 jours, mise-bas, chiots individualisés comme `dogs`), poids de naissance, sevrage, cession tracée vers l'acheteur avec certificat.
- **EF-CAN-04 [S · V1]** : courbe de poids et de croissance.
- **RG-CAN-01** : mise-bas prévue = date de saillie + 63 jours (indicatif, ajustable).
- **RG-CAN-02** : un chiot cédé passe au statut `cede`, sa fiche est transmissible à l'acheteur (export ou invitation) et son carnet de santé le suit.

### 4.10 Reproduction et portées — rente (REP)
- **EF-REP-01 [S · V1]** ⭐ : chaleurs, saillie ou IA, diagnostic de gestation, tarissement, mise-bas, sevrage, pour toutes les espèces à reproduction suivie.
- **EF-REP-02 [S · V1]** : alerte de mise-bas prévue selon `ref_species.gestation_days` (lapin 31 j, porcin 114 j, ovin et caprin 150 j, bovin 283 j, chien 63 j).
- **EF-REP-03 [S · V1]** : enregistrer une portée (nés vivants, morts-nés, sevrés). Au sevrage, on crée soit un lot (porcelets, lapereaux, agneaux), soit des jeunes individualisés (veaux, futurs reproducteurs).
- **EF-REP-04 [S · V1]** : indicateurs de fécondité (voir `10` par filière).

### 4.11 Généalogie et consanguinité (GEN) — *addendum A intégré*
- **EF-GEN-01 [S · V1]** ⭐ : enregistrer le père et la mère de chaque reproducteur ; le pedigree se construit automatiquement pour les jeunes nés dans l'élevage.
- **EF-GEN-02 [S · V1]** : arbre généalogique sur au moins 3 générations, 5 par défaut.
- **EF-GEN-03 [S · V1]** : « Vérifier un accouplement » : à partir d'un mâle et d'une femelle, calcul du coefficient de consanguinité attendu de la descendance et verdict.
- **EF-GEN-04 [S · V1]** : alerte automatique au moment d'enregistrer une saillie (EF-REP-01) si le verdict est « à éviter ».
- **EF-GEN-05 [C · V2]** : détection des boucles et incohérences ; référence de registre (LOF ou herd-book).
- **RG-GEN-01** : coefficient F de la descendance = coefficient de parenté du père et de la mère, calculé par la **méthode de Wright** (chemins de parenté) ou par la méthode tabulaire équivalente, sur `generations_used` générations. Calcul **local, hors ligne**, recalculé au serveur.
- **RG-GEN-02** : seuil paramétrable, 6,25 % par défaut. **Clarification v2.1** : verdict `a_eviter` si F ≥ seuil (accouplement de cousins germains ou plus proche), `acceptable` si F < seuil.
- **RG-GEN-03** : si un ascendant manque dans la profondeur utilisée, le coefficient est une **borne inférieure** et le verdict est préfixé `minore_`.
- Valeurs de contrôle : demi-frère × demi-sœur → 12,5 % ; plein frère × sœur → 25 % ; cousins germains → 6,25 % ; aucun ancêtre commun → 0 %.

### 4.12 Dressage, pension et facturation (DRE)
- **EF-DRE-01 [M · V1]** ⭐ : clients reliés à un ou plusieurs chiens ; contrat et consentement.
- **EF-DRE-02 [M · V1]** : programmes (éducation chiot, obéissance, protection, détection, pistage, chasse, agility, réhabilitation).
- **EF-DRE-03 [M · V1]** : séances : planning, rappel au client et au dresseur, présence, durée, lieu, progression, niveau de 1 à 4.
- **EF-DRE-04 [M · V1]** : pension : admission avec check-list vaccinale (dont rage), box, tarif journalier, sortie.
- **EF-DRE-05 [M · V1]** : devis et factures (séances, journées de pension, ventes), conversion d'un devis en facture, encaissement mobile money ou espèces, paiements partiels.
- **RG-DRE-01** : montant d'une ligne = quantité × prix unitaire ; total = Σ des lignes. Un numéro de facture **définitif** n'est attribué qu'au serveur ; hors ligne, la facture porte un numéro provisoire.
- **RG-DRE-02** : admission en pension **différée** si la rage n'est pas à jour à la date d'entrée ; la toux de chenil est recommandée (alerte non bloquante).

### 4.13 Chiens de travail / K9 (K9)
- **EF-K9-01 [C · V2]** 🏢 : unités ou brigades, affectation chien ↔ maître-chien, aptitudes et certifications, recyclage (rappels), conformité vaccinale. `fit_for_service` = aptitude valide **et** rage à jour.

### 4.14 Alimentation et stocks d'intrants (STK)
- **EF-STK-01 [M · MVP]** : entrées et sorties par intrant (aliments, fourrages, minéraux, litière, vaccins, médicaments, désinfectants, semences), avec coûts.
- **EF-STK-02 [S · V1]** : seuils d'alerte et estimation de l'autonomie (jours de stock) à partir de la consommation moyenne sur 14 jours.
- **EF-STK-03 [S · V1]** : n° de lot et date de péremption des produits vétérinaires, avec alerte 30 jours avant l'échéance.
- **RG-STK-01** : stock d'un intrant = Σ entrées − Σ sorties ± ajustements.

### 4.15 Production et ventes (VEN)
- **EF-VEN-01 [M · MVP]** : recettes par produit (œufs, animaux, lait, chiots, fumier, peaux…) : quantité, unité, prix, client, mode de paiement, statut de paiement.
- **RG-VEN-01** : montant = quantité × prix unitaire, arrondi à l'unité mineure de la devise.
- **RG-VEN-02** : vente refusée si le sujet est sous délai d'attente pour le produit concerné (viande, lait, œufs). Message explicite avec la date de fin.
- **EF-VEN-02 [S · V1]** : une vente d'animaux crée le mouvement de sortie correspondant (`animal_movements`).

### 4.16 Dépenses et trésorerie (DEP)
- **EF-DEP-01 [M · MVP]** : charges par catégorie, mode de paiement, fournisseur ; affectation optionnelle à un lot ou un animal.
- **EF-DEP-02 [S · V1]** ⭐ : trésorerie mensuelle par devise, marge brute, coût de revient par unité (kg vif, œuf, litre, chiot).

### 4.17 Projection et simulation (PRJ) — *nouveau*
- **EF-PRJ-01 [S · V1]** ⭐ : simulateur par filière : à partir d'une unité d'entrée (poussins par bande, pondeuses, femelles, truies, vaches, chiennes, chiens en dressage ou en pension), il projette les effectifs, la production, l'aliment, l'eau, le logement et l'économie (voir les formules dans `10`).
- **EF-PRJ-02 [S · V1]** : paramètres par défaut par filière et par pays (`ref_projection_defaults`), tous modifiables ; scénarios enregistrables et comparables.
- **EF-PRJ-03 [C · V2]** : préremplir les paramètres à partir des données réelles de l'exploitation (taux de mortalité observé, IC, taille de portée).
- **RG-PRJ-01** : le moteur reproduit **exactement** les formules des classeurs `*-modele-projection.xlsx` de référence (tests dorés : `11` T-30).
- **RG-PRJ-02** : le calcul est **local** (hors ligne), avec un `engine_version` enregistré dans chaque scénario.

### 4.18 Tableau de bord et indicateurs (KPI)
- **EF-KPI-01 [M · MVP]** : KPIs par exploitation, adaptés à la filière (liste dans `10`) : mortalité, ponte, IC, stocks, marge, coût de revient, rappels respectés.
- **EF-KPI-02 [S · V2]** 🏢 : tableau de bord consolidé de l'organisation et cartographie (PWA).

### 4.19 Surveillance, campagnes et export (SUR)
- **EF-SUR-01 [S · V2]** 🏢 : agrégats anonymisés : couverture vaccinale par zone (dont antirabique), morsures, signalements, mortalités anormales.
- **EF-SUR-02 [S · V2]** 🏢 : campagnes de masse : zone, maladie, cible, relance groupée, suivi de couverture en temps réel.
- **EF-SUR-03 [S · V2]** 🏢 : export au format des réseaux nationaux (schéma à convenir avec le référent, par exemple RESCAM au Cameroun).
- **RG-SUR-01** : aucune donnée individuelle identifiante dans les vues ni les exports ; consentement `surveillance_agregats` requis.
- **RG-SUR-02** : une cellule (zone × période × maladie) ne contenant que **moins de 5 exploitations** n'est pas diffusée (k-anonymat).

### 4.20 Marché et mise en relation (MAR)
- **EF-MAR-01 [M · V1]** : annuaire géolocalisé (vétérinaires, auxiliaires, inséminateurs, dresseurs, pensions, fournisseurs, acheteurs).
- **EF-MAR-02 [M · V1]** : demande de service en un clic, y compris depuis un rappel manqué ; le prestataire reçoit la demande dans l'app et par WhatsApp.
- **EF-MAR-03 [M · V1]** 🏢 : **mode agent** : un animateur gère un portefeuille d'éleveurs, saisit pour eux et émet des demandes en leur nom.
- **EF-MAR-04 [C · V2]** : notation des prestataires et historique.

### 4.21 Contenus et formation (CTN)
- **EF-CTN-01 [S · MVP]** : fiches et audio par espèce et par thème (passerelle éditoriale AfricaVet), disponibles hors ligne. Un pack de base est inclus en 🆓.

### 4.22 Abonnement, formules et paiement (ABO)
- **EF-ABO-01 [M · MVP]** : formules Découverte (gratuite) et Pro, en mensuel ou annuel, avec paiement **mobile money** (un agrégateur et le pays pilote au MVP).
- **EF-ABO-02 [M · MVP]** : feature gating fonctionnant hors ligne (droits signés et mis en cache, plus une période de grâce).
- **EF-ABO-03 [M · V1]** : formule Structure et paiement multi-pays et multi-opérateurs.
- **EF-ABO-04 [C · V2]** : option Institution (licence hors application, hébergement souverain, API ou marque blanche).
- **EF-ABO-05 [S · V1]** 🏢 : prix Structure indexé sur le nombre d'éleveurs suivis (tranches paramétrées dans le pack pays : `plan`).
- **EF-ABO-06 [S · V1]** : variante « Pro canin » (dressage, pension, facturation, rappels clients) à un prix distinct, testé au pilote (décision D-10).
- **EF-ABO-07 [S · V3]** : option « Ferme connectée » : abonnement de supervision ajouté à la formule, kit payable comptant ou en mensualités mobile money ; quotas de capteurs et de passerelles (EF-IOT-14).
- **RG-ABO-01** : à l'expiration, période de **grâce de 7 jours** (paramétrable), puis passage en **lecture seule** des modules payants. Les données ne sont jamais supprimées pour non-paiement.

| Formule | Mensuel | Annuel | Cible |
|---|---|---|---|
| Découverte | 0 | 0 | Petit éleveur, démarrage |
| Pro | 2 500 FCFA | 25 000 FCFA (2 mois offerts) | Éleveur, éleveur canin, dresseur, vétérinaire solo |
| Pro canin (à tester) | au-dessus du Pro | — | Centre canin, pension, dresseur |
| Structure | dès 15 000 FCFA, puis par tranche d'éleveurs suivis | dès 150 000 FCFA | Coopérative, clinique, centre canin, projet, K9 |
| Ferme connectée (option) | forfait de supervision + kit | — | Éleveur intermédiaire ou grand |
| Institution | sur devis | sur devis | Service vétérinaire, unité de sécurité |

Prix dans les autres devises : grille par pays dans `ref_plan_prices`, servie par `GET /plans`.

**Feature gating** (source : `ref_plan_features`, valeurs initiales) :

| Fonction | 🆓 Découverte | ⭐ Pro | 🏢 Structure |
|---|---|---|---|
| Exploitations | 1 | 3 | illimité (par membre) |
| Cheptel, journal, santé, rappels locaux, tâches, stocks, ventes, dépenses | ✔ | ✔ | ✔ |
| Marché (annuaire, demandes de service), signalement de suspicion | ✔ | ✔ | ✔ |
| Rappels SMS / WhatsApp | — | ✔ | ✔ |
| Certificat QR | — | ✔ | ✔ |
| Reproduction, généalogie & consanguinité | — | ✔ | ✔ |
| Biosécurité (check-lists) | — | ✔ | ✔ |
| Trésorerie, projection | — | ✔ | ✔ |
| Dressage, pension, facturation | — | ✔ | ✔ |
| Caméras | — | ✔ (2 caméras*) | ✔ (quota par contrat*) |
| Multi-utilisateurs, mode agent | — | — | ✔ |
| Campagnes, surveillance, carte, export | — | — | ✔ |
| K9 | — | — | ✔ |
| Contenus audio (pack de base) | ✔ | ✔ (complet) | ✔ (complet) |
| Capteurs et passerelles (option Ferme connectée) | — | ✔ (quota*) | ✔ (quota par contrat*) |
| Studio : packs d'organisation | — | — | ✔ (V2) |
| API publique, exports nationaux | — | — | Institution |

\* Quotas proposés, à valider par la direction produit.

### 4.23 Surveillance à distance par caméras (CAM) — *addendum B intégré*
- **EF-CAM-01 [S · V2]** ⭐ : assistant d'installation et d'association d'une caméra (Wi-Fi ou 4G) ; nom, zone, logement.
- **EF-CAM-02 [S · V2]** : flux en direct (mosaïque et plein écran), en basse résolution par défaut.
- **EF-CAM-03 [S · V2]** : détection de mouvement → notification et clip court (20 s).
- **EF-CAM-04 [S · V2]** : statut en ligne/hors ligne (alerte si une caméra est hors ligne depuis plus de 30 minutes) ; vision nocturne.
- **EF-CAM-05 [M · V2]** : accès restreint au propriétaire et aux personnes explicitement autorisées (`camera_access`) ; aucun flux vers des tiers ; réglage basse consommation.
- **EF-CAM-06 [S · V2]** : bouton « Caméra du box » sur la fiche d'un animal ou d'un chien quand son logement a une caméra.
- **RG-CAM-01** : basse résolution par défaut ; clips courts déclenchés par la détection.
- **RG-CAM-02** : conservation des clips limitée à **7 jours** (paramétrable par Structure, 30 jours au maximum), puis purge automatique.
- **RG-CAM-03** : le flux vidéo n'est jamais synchronisé ni stocké sur l'appareil ; il exige le réseau.
- Réserves : consommation de données, coût du matériel à la charge de l'éleveur, alimentation électrique et réseau du site.

### 4.24 Notifications et messages (NOT) — *nouveau*
- **EF-NOT-01 [M · MVP]** : préférences par canal (push, SMS, WhatsApp, vocal) et heures calmes.
- **EF-NOT-02 [M · MVP]** : journal serveur de chaque envoi (`outbound_messages`) : statut, coût, délivrabilité.
- **EF-NOT-03 [S · V1]** : modèles de messages traduits, avec variables (sujet, maladie, date, lien de confirmation).
- **EF-NOT-04 [S · V1]** : confirmer un rappel par réponse SMS (code court) ou par USSD.
- **EF-NOT-05 [S · MVP]** : **test USSD au pilote** : menu court « rappels du jour / confirmer un acte / demander un vétérinaire » (décision D-03).
- **EF-NOT-06 [C · V3]** : **assistant conversationnel WhatsApp** en langues locales, qui répond à partir du carnet, des rappels et des indicateurs de l'exploitation (« que dois-je faire cette semaine ? »). Il ne donne pas de diagnostic, renvoie vers un vétérinaire et ne cite que les données de l'utilisateur.
- **EF-NOT-07 [C · V2]** : rappels et confirmations par **serveur vocal** en langues locales (touche 1 = fait).
- **RG-NOT-01** : choix du canal = formule × consentement × préférence × disponibilité ; ordre de repli WhatsApp → SMS → push.
- **RG-NOT-02** : au plus 3 messages sortants (SMS + WhatsApp) par utilisateur et par jour, hors priorité critique ; les rappels du même jour sont regroupés en un seul message.

### 4.25 Hors ligne et synchronisation (SYN)
- **EF-SYN-01 [M · MVP]** : `sync_version` (serveur) et `client_rev` (local) sur chaque entité ; un curseur par table.
- **EF-SYN-02 [M · MVP]** : `POST /sync/push` idempotent par lots ; `GET /sync/pull?since=`.
- **EF-SYN-03 [M · MVP]** : fusion au niveau du champ (la dernière écriture gagne par champ), journalisée.
- **RG-SYN-01** : les agrégats dérivés ne sont jamais acceptés en push ; ils sont recalculés au serveur.
- **EF-SYN-04 [M · MVP]** : les packs de paramètres et les droits signés descendent par la synchronisation et sont vérifiés hors ligne (EF-PAR-03).

### 4.26 Paramétrage (PAR) — *nouveau v2.2*
Spécification complète dans `12-parametrage.md`. Exigences EF-PAR-01 à EF-PAR-12 :
- résolution à 5 niveaux ;
- packs signés ;
- moteur de formulaires générique et langage d'expressions partagé ;
- gouvernance avec relecture à quatre yeux ;
- studio pour les référents (V1), puis pour les Structures (V2) ;
- bibliothèque partagée (V3).

### 4.27 Suivi à distance par capteurs (IOT) — *nouveau v2.2*
Spécification complète dans `13-suivi-a-distance-iot.md`. Exigences EF-IOT-01 à EF-IOT-14 :
- passerelle de ferme avec règles locales et SMS de secours ;
- capteurs standard (LoRaWAN, MQTT) ;
- alertes paramétrées avec astreinte et escalade ;
- tableau de bord temps réel ;
- journal rempli automatiquement ;
- alertes prédictives (V3).

Les événements de caméra passent par le même moteur d'alertes (EF-IOT-12, V2).

### 4.28 Interopérabilité, conformité, antimicrobiens (INT, CMP, AMU) — *nouveau v2.2*
Spécification complète dans `14-normes-conformite-interoperabilite.md` :
- EF-INT-01 à EF-INT-09 : ICAR ADE, DHIS2, ARIS, GARC, EMA-i+, API publique OAuth 2.0, EPCIS, registres d'audit, import en masse ;
- EF-CMP-01 à EF-CMP-08 : registre des traitements, analyses d'impact, déclarations, DPO, violations, ISO 27001, charte des données, conventions ;
- EF-AMU-01 et EF-AMU-02 : antimicrobiens par principe actif et par classe.

### 4.29 Mode vétérinaire de terrain (VTR) — *nouveau v2.2*
- **EF-VTR-01 [S · V1]** : un vétérinaire ou un auxiliaire (`role = veterinaire`) dispose d'une vue « clientèle ». Il crée ou retrouve un éleveur par numéro de téléphone, sans que l'éleveur ait un smartphone. Il enregistre des actes, émet des certificats et des factures. L'éleveur reçoit ses rappels par SMS ou USSD.
- **EF-VTR-02 [S · V1]** : l'éleveur sans smartphone donne son consentement par SMS (code de confirmation) ; sa fiche reste sa propriété et peut être réclamée plus tard dans l'application (transfert de propriété tracé).
- **EF-VTR-03 [S · V1]** : tournée du jour : liste des rappels manqués de la clientèle du vétérinaire, triés par distance (GPS facultatif).
- **RG-VTR-01** : un vétérinaire ne voit que les éleveurs qui l'ont désigné (consentement `partage_veterinaire`) ou qu'il a créés pour eux.

### 4.30 Analytique produit (ANA) — *nouveau v2.2*
- **EF-ANA-01 [M · MVP]** : événements d'usage pseudonymisés (catalogue de `17` §5), envoyés par lots, désactivables dans les réglages.
- **EF-ANA-02 [M · MVP]** : tableaux de bord de pilotage et d'exploitation (`17` §6).
- **EF-ANA-03 [S · V1]** : formulaire « Signaler un problème » intégré (capture, journaux techniques sans donnée personnelle).
- **EF-ANA-04 [S · MVP]** : interrupteurs de fonctionnalités par pays et par cohorte.

## 5. Machines à états

### 5.1 Rappel (`reminders.status`)

| État | Déclencheur | États suivants |
|---|---|---|
| a_venir | création à partir d'un acte, d'une tâche, d'une séance… | envoye (à la première relance), annule |
| envoye | une relance émise (local ou serveur) | confirme ; manque (J+3 sans confirmation) ; annule |
| manque | J+3 dépassé sans confirmation | confirme (rattrapage) ; clos (abandon explicite ou sujet sorti) |
| confirme | l'utilisateur confirme l'exécution | clos + planification de l'occurrence suivante |
| annule | suppression ou sortie du sujet, ou de l'acte source | — (terminal) |
| clos | fin de vie | — (terminal) |

### 5.2 Abonnement (`subscriptions.status`)

| État | Déclencheur | États suivants |
|---|---|---|
| actif | paiement confirmé (webhook) | expire (fin de période) |
| expire | fin de période sans renouvellement | grace (automatique) |
| grace | 7 jours (paramétrable) | actif (paiement) ; suspendu |
| suspendu | fin de la grâce : modules payants en lecture seule | actif (paiement) ; cloture |
| cloture | fermeture du compte | — |

### 5.3 Demande de service (`service_requests.status`)
`envoyee` → `vue` → `acceptee` | `refusee` ; `acceptee` → `cloturee` ; `envoyee`/`vue` → `expiree` (sans réponse après 7 jours, l'éleveur est invité à contacter un autre prestataire).

### 5.4 Lot (`batches.status`)
`en_cours` → `vendue` | `reformee` | `terminee` → (le logement passe en vide sanitaire) ; un lot ne repasse jamais `en_cours`.

### 5.5 Séjour en pension
`admission demandée` → `admis` | `differe` (rage non à jour) | `refuse` ; `admis` → `sorti` (check-out) → facturation.

### 5.6 Facture (`invoices.status`)
`brouillon` → `emis` (numéro définitif attribué au serveur) → `partiellement_paye` → `paye` ; `emis` → `annule` (via un avoir) ; un devis `emis` → `converti` (crée une facture).

### 5.7 Signalement (`disease_signals.status`)
`brouillon` → `envoye` → `pris_en_charge` → `confirme` | `infirme` → `clos`.

### 5.8 Caméra (`cameras.status`)
`en_association` → `en_ligne` ⇄ `hors_ligne` ; tout état → `desactivee`.

### 5.9 Compte (`users.account_status`)
`provisoire` → `verifie` → `actif` ⇄ `suspendu` ; `actif`/`suspendu` → `cloture` (après exécution d'une demande de suppression).

### 5.10 Pack de paramètres (`param_pack_versions.status`)
`brouillon` → `en_revue` → `teste` → `publie` → `retire` ; `en_revue` → `brouillon` (refus) ; `teste` → `brouillon` (échec des tests). Détail dans `12` §7.

### 5.11 Alerte (`alert_events.status`)
`ouverte` → `escaladee` (non acquittée) → `acquittee` → `resolue` (avec action) → `close`. Détail dans `13` §4.

## 6. Règles transverses
- **Hors ligne d'abord** (CT-01) ; synchronisation différée (voir `04`).
- **Multilingue** : tous les libellés sont externalisés et les référentiels traduisibles.
- **Traçabilité** : suppression logique, horodatage et auteur sur chaque écriture ; saisies d'agent marquées.
- **Confidentialité** : les données individuelles sont privées au propriétaire ; les agrégats sont anonymisés et ne contiennent que les données des utilisateurs qui y ont consenti.
- **Multi-devise** : aucune somme ne mélange des devises différentes (RG-MDD-06).
- **Paramétrage** : aucune règle propre à une espèce, un pays ou une organisation n'est codée en dur (EF-PAR-01).
- **Normes** : chaque exigence liée à une norme est tracée dans `14` §1.

## 7. Critères d'acceptation
Les cas de test T-01 à T-55 et la matrice de traçabilité sont dans `11-recette-tracabilite.md`.
