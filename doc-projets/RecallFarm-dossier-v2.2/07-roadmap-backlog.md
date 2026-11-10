# 07 — Feuille de route et backlog (v2.2)

> Version 2.2 — 27/10/2026. Les priorités et les versions sont **strictement identiques** à celles de `01` §4 et des fichiers `12` à `17` ; en cas d'écart, `01` fait foi. Notation : (M) Must, (S) Should, (C) Could. Formule minimale entre crochets : 🆓 Découverte, ⭐ Pro, 🏢 Structure, 🏛 Institution.

## 1. Jalons et décisions de passage

| Version | Période indicative | Objectif | Décision de passage à la sortie (`17` §1) |
|---|---|---|---|
| **MVP** | mois 0 à 3 | tenir le cahier, ne rater aucun vaccin ; socle paramétrable | **Go pilote** |
| *Pilote* | mois 4 à 6 | Yaoundé : chiens + volaille, 300 utilisateurs | **Go payant** (≈ mois 7) |
| **V1** | mois 4 à 6 (développement parallèle au pilote), mise en service au mois 7 | exploitation complète, activité canine professionnelle, revenus, studio interne, 6 filières | — |
| **V2** | mois 7 à 12 | vidéo, campagnes, surveillance, exports nationaux, studio ouvert aux Structures | **Go expansion** (≈ mois 12) |
| **V3** | mois 13 à 24 | capteurs IoT, alertes prédictives, assistant WhatsApp, API publique en écriture, marque blanche, nouvelles filières | — |

## 2. Contenu par version

### MVP — « socle paramétrable, carnet et rappels » (pilote rage canine urbaine + volaille)
- (M) **Socle de paramétrage** : packs signés, résolution à 5 niveaux, moteur de formulaires, langage d'expressions partagé (EF-PAR-01 à 05) ; packs `global.core`, `filiere.volaille`, `filiere.canin`, `pays.CM`. [—]
- (M) Onboarding, compte par OTP, consentements, exploitation ; DPO, registre, déclarations (EF-CMP-01, 03, 04, 07). [🆓]
- (M) **Hors ligne d'abord**, synchronisation delta, base locale chiffrée, packs et droits par la synchronisation. [🆓]
- (M) Cheptel (lots, animaux, chiens), journal adaptatif. [🆓]
- (M) **Santé, vaccination, moteur de rappels**, délais d'attente ; rappels SMS et journal des envois, plafonnement. [🆓/⭐]
- (S) Certificat QR (rage) ; (S) tâches simples ; (S) **test USSD** (E80). [⭐/🆓]
- (M) Stocks, ventes, dépenses, KPIs ; (M) **import en masse** pour l'enrôlement (EF-INT-09). [🆓/🏢]
- (M) Découverte + Pro, **paiement mobile money (pays pilote)**, feature gating hors ligne ; export et suppression du compte. [🆓/⭐]
- (M) **Analytique produit**, tableaux de pilotage et d'exploitation, feature flags (EF-ANA-01, 02, 04). [—]
- (S) Contenus audio de base. [🆓]

### V1 — « exploitation complète, activité canine pro, revenus, 6 filières »
- (M) **Gouvernance des packs et studio interne** S01 à S07 (EF-PAR-06, 07, 09, 11) ; workflows configurables (EF-PAR-08) ; packs `filiere.porcin`, `filiere.petits_ruminants`, `filiere.bovin`, `filiere.lapin`. [—]
- (S) Logements, mouvements, pesées ; reproduction, portées, **généalogie et consanguinité**. [🆓/⭐]
- (S) Calendriers types ; seuils de stock, péremption ; **antimicrobiens par principe actif** (EF-AMU-01). [🆓/⭐]
- (S) Biosécurité, signalement de suspicion. [⭐/🆓]
- (S) Trésorerie, **simulateur de projection** (6 filières, tests dorés). [⭐]
- (M) Dressage, pension, devis et factures, encaissement ; **variante Pro canin** (EF-ABO-06). [⭐]
- (M) Marché et demandes de service ; **Structure, mode agent**, prix par tranche (EF-ABO-05) ; multi-pays. [🆓/🏢]
- (S) **Mode vétérinaire de terrain** (EF-VTR-01 à 03). [⭐]
- (S) WhatsApp ; confirmation par SMS et USSD ; PWA organisation ; registres d'audit (EF-INT-08) ; retour utilisateur (EF-ANA-03). [⭐/🏢]

### V2 — « surveillance, vidéo, échelle »
- (S) **Caméras** (camera-service) ; événements vidéo dans le moteur d'alertes (EF-IOT-12). [⭐]
- (S) **Campagnes de masse**, surveillance et carte de la rage (k-anonymat). [🏢]
- (S) **Exports nationaux** : DHIS2, ARIS, GARC, EMA-i+ ; ICAR ADE (EF-INT-01 à 05) ; agrégats d'antimicrobiens (EF-AMU-02). [🏢/🏛]
- (S) **Studio ouvert aux Structures** et bac à sable (EF-PAR-10). [🏢]
- (S) API publique en lecture pour l'offre Institution ; (C) K9 ; (C) serveur vocal en langues locales (EF-NOT-07). [🏛/🏢]
- (S) Certification ISO/IEC 27001 (EF-CMP-06) ; packs `pays.SN`, `pays.CI`. [—]

### V3 — « ferme connectée et intelligence »
- (S) **Capteurs IoT et passerelle de ferme** (EF-IOT-01 à 11, 14), option « Ferme connectée » (EF-ABO-07). [⭐]
- (C) **Alertes prédictives** (EF-IOT-13). [⭐]
- (C) **Assistant conversationnel WhatsApp** (EF-NOT-06). [⭐]
- (S) API publique en écriture, OAuth 2.0 complet (EF-INT-06) ; EPCIS (EF-INT-07) ; marque blanche. [🏛]
- (C) Bibliothèque partagée de packs (EF-PAR-12) ; packs `filiere.pisciculture`, `filiere.apiculture`. [🏢]
- (C) Finance intégrée (score de suivi sanitaire → crédit d'intrants, assurance), avec consentement. [—]

### Pas pour l'instant
Comptabilité fiscale complète ; e-commerce transactionnel ; fabrication de matériel ; taux de change.

## 3. Epics → user stories (extrait ; les stories v2.1 restent valables)

**Epic Paramétrage**
- En tant que référent vétérinaire, je veux modifier l'intervalle d'un protocole pour mon pays et le publier après relecture, sans attendre une version de l'application. *(M, V1)*
- En tant que référent, je veux voir la frise des rappels qu'un protocole produira sur un animal fictif avant de le publier. *(S, V1)*
- En tant qu'administrateur de coopérative, je veux ajouter deux champs à notre journal et un protocole maison. *(S, V2)*
- En tant que responsable produit, je veux revenir à la version précédente d'un pack en un clic si une erreur est signalée. *(M, V1)*

**Epic Suivi à distance**
- En tant qu'éleveur de volaille, je veux être appelé si la température de mon poulailler dépasse 32 °C pendant 30 minutes, même si Internet est coupé à la ferme. *(S, V3)*
- En tant qu'éleveur, je veux qu'une alerte non prise en charge passe à mon gardien après 15 minutes. *(S, V3)*
- En tant qu'éleveur, je veux que la température et la consommation d'eau remplissent seules mon journal. *(S, V3)*

**Epic Interopérabilité**
- En tant que service vétérinaire, je veux recevoir chaque mois la couverture antirabique par district dans notre DHIS2. *(S, V2)*
- En tant que coopérative, je veux importer nos 300 éleveurs depuis un tableur. *(M, MVP)*

**Epic Vétérinaire de terrain**
- En tant qu'auxiliaire vétérinaire, je veux enregistrer la vaccination d'un éleveur sans smartphone pour qu'il reçoive ses rappels par SMS. *(S, V1)*

**Epic Pilotage**
- En tant que fondateur, je veux suivre chaque semaine le taux de rappels confirmés et la conversion, par agent et par filière. *(M, MVP)*

## 4. Découpage en sprints (indicatif, 2 semaines)

| Sprint | Contenu | Jalon |
|---|---|---|
| 1 | Socle projet, monorepo, CI/CD, auth OTP, consentements ; **schémas et moteurs (résolution, expressions, formulaires)** ; décisions D-02 et D-06 | |
| 2 | Exploitation, cheptel, journal par formulaires paramétrés ; synchronisation ; packs `global.core` et `filiere.volaille` ; USSD (D-03) | |
| 3 | Moteur de rappels, santé, protocoles, délais d'attente, tâches ; pack `filiere.canin` ; notifications et SMS | |
| 4 | Stocks, ventes, dépenses, KPIs ; certificat QR ; import en masse ; analytique et tableaux de pilotage | |
| 5 | Formules, gating, paiement (pilote), export et suppression ; pack `pays.CM` ; recette, tests terrain | **MVP → Go pilote** |
| 6 | Gouvernance des packs, studio S01 à S04 ; logements, mouvements, pesées | |
| 7 | Reproduction, portées, généalogie, consanguinité ; packs porcin et lapin ; antimicrobiens | |
| 8 | Biosécurité, signalement ; trésorerie, simulateur et studio S05 ; packs petits ruminants et bovins | |
| 9 | Dressage, pension, facturation, Pro canin ; mode vétérinaire de terrain | |
| 10 | Marché, Structure, mode agent, prix par tranche ; WhatsApp ; PWA ; studio S06 et S07 ; recette | **V1** |
| 11 à 22 | V2 : caméras, campagnes, surveillance, exports nationaux, studio Structures, API en lecture, ISO 27001, packs SN et CI | **V2 → Go expansion** |
| 23 et suivants | V3 : IoT, prédiction, assistant, API en écriture, nouvelles filières | **V3** |

> Par rapport à la v2.1, le socle de paramétrage est avancé aux sprints 1 et 2 : c'est lui qui rend les sprints suivants plus rapides, puisque chaque filière devient un pack. Le prestataire confirme ce découpage dans sa proposition.
