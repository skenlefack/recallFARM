# RecallFarm — dossier de développement v2.2

> Version 2.2 — 27/10/2026. Ce dossier **remplace** le dossier v2.1. Il intègre le **document conceptuel** du 26/10/2026 : plateforme paramétrable, suivi à distance, normes internationales, interopérabilité, dimensionnement, organisation, pilote et indicateurs. Le document maître consolidé est `RecallFarm-cahier-des-charges-v2.2.docx` : il est généré à partir des fichiers `.md` ci-dessous, qui font foi.

RecallFarm est une plateforme web et mobile de **gestion d'élevage et d'activité canine** pour l'Afrique.
- **Paramétrable pour toute espèce et tout pays** : les règles sont des packs de paramètres, pas du code.
- **Hors ligne d'abord.**
- **Moteur de rappels multicanal** : application, SMS, USSD, WhatsApp, voix.
- **Suivi à distance** par capteurs et caméras.
- **Interopérable** avec les systèmes sanitaires (ICAR ADE, DHIS2, ARIS, GARC, EMA-i+).

## Contenu du dossier

| Fichier | Objet | Nouveau ou modifié en v2.2 |
|---|---|---|
| `00-README.md` | Vue d'ensemble, conventions, ordre de lecture | modifié |
| `01-cahier-des-charges.md` | Exigences fonctionnelles (30 modules, ID, priorité, version, formule), règles, machines à états, feature gating | modifié : §4.26 à §4.30, nouvelles formules, V3 |
| `02-specifications-ecrans.md` | Écrans E01 → E81, correspondance avec la maquette | modifié : E70 à E81 |
| `03-modele-de-donnees.md` | **Référence** des tables, champs, énumérations, intégrité | modifié : §0.4, §15 à §17 |
| `04-architecture-technique.md` | Monolithe modulaire → services, synchronisation, moteurs, IoT, analytique, hébergement par pays | modifié : §14 à §17 |
| `05-api.md` | API REST v1 et API publique | modifié : §23 à §28 |
| `06-modele-financier.xlsx` | Modèle financier sur 36 mois | modifié : infrastructure séparée, facteur de budget de développement |
| `07-roadmap-backlog.md` | MVP → V1 → V2 → V3, décisions de passage, epics, sprints | réécrit |
| `08-exigences-non-fonctionnelles.md` | Cibles mesurables, sécurité, gouvernance des données | modifié |
| `09-glossaire-referentiels.md` | Glossaire, maladies, protocoles, intrants, produits, check-lists, pays, principes actifs | modifié |
| `10-filieres.md` | 6 filières, KPIs, calendriers, projection, valeurs de contrôle, packs et capteurs | modifié : §8 |
| `11-recette-tracabilite.md` | Tests T-01 → T-55, traçabilité, livrables, lots, SLA | modifié |
| `12-parametrage.md` | **Métamodèle, packs, résolution, langage d'expressions, moteurs, gouvernance, studio** | **nouveau** |
| `13-suivi-a-distance-iot.md` | **Capteurs, passerelle de ferme, MQTT, alertes, astreinte, tableau de bord** | **nouveau** |
| `14-normes-conformite-interoperabilite.md` | **Normes → exigences → preuves ; conformité des données ; antimicrobiens ; exports et API** | **nouveau** |
| `15-exploitation-dimensionnement.md` | **Volumes, SLO, environnements, hébergement par pays, infrastructure, CI/CD, sauvegardes, supervision, procédures, support, coûts** | **nouveau** |
| `16-methodes-organisation.md` | **Équipe et effort, gouvernance, Scrum, DoR/DoD, monorepo, tests, registre des décisions D-01 → D-10** | **nouveau** |
| `17-pilote-deploiement-indicateurs.md` | **Décisions de passage, pilote de Yaoundé, ouverture des pays, indicateurs, analytique, tableaux de bord** | **nouveau** |
| `CHANGELOG-v2.2.md` | Modifications depuis la v2.1 | nouveau |
| `CHANGELOG-v2.1.md` | Historique de la v2.1 | inchangé |
| `maquette/recallfarm-maquette.html` | Maquette cliquable (22 écrans) | inchangé |
| `filieres/` | 6 dossiers techniques et 6 classeurs de projection (référence zootechnique et de calcul) | inchangé |
| `marche/` | Étude de marché et annexe FAOSTAT | inchangé |

Documents liés, dans le projet recallFARM :
- `concept/document-conceptuel-recallfarm.md` (cadre stratégique) ;
- l'étude des systèmes mondiaux de gestion des fermes (artifact) ;
- `claude/revue-coherence-dossier-v2.0.md`.

## Ordre de lecture conseillé
1. **Comprendre** : `00` → document conceptuel → `01` → `12` (paramétrage)
2. **Construire** : `03` → `05` → `04` → `13` → `14`
3. **Écrans** : `02` + maquette + studio (`12` §9)
4. **Livrer et exploiter** : `07` → `16` → `15` → `11` → `17`
5. **Métier** : `10` + `09` + dossiers des filières

## Conventions
- Langue : **français** (i18n prévue ; anglais au MVP).
- **Montants** : `bigint` en unité mineure ISO 4217 + `currency` ; jamais « FCFA » en dur à l'écran.
- Dates ISO 8601 ; identifiants **UUID v4 générés par le client** ; horodatage UTC.
- Entités synchronisées : `id`, `created_at`, `updated_at`, `deleted_at`, `created_by`, `sync_version`, `client_rev` ; entités saisies par formulaire : `attributes` et `param_version`.
- Identifiants :
  - exigences : `EF-<MODULE>-NN [Priorité · Version]` ;
  - règles : `RG-…` ;
  - exigences non fonctionnelles : `ENF-…` ;
  - tests : `T-NN` ;
  - décisions : `D-NN` ;
  - écrans : `E-NN` (application) et `S-NN` (studio) ;
  - procédures : `RB-NN`.
- Packs : `niveau.code@semver` (ex. `filiere.porcin@2.0.0`).

## Priorités de livraison (voir `07`)
1. **MVP (mois 0 à 3)** : socle paramétrable, hors ligne, carnet et rappels (local + SMS, test USSD), cheptel, journal, stocks, ventes, certificat QR, import en masse, Découverte/Pro et paiement, analytique. Packs volaille, canin et Cameroun. → **pilote à Yaoundé**.
2. **V1 (mise en service au mois 7)** : studio interne et 6 filières, reproduction et généalogie, antimicrobiens, biosécurité, trésorerie, projection, dressage, pension, facturation, mode vétérinaire de terrain, marché, Structure.
3. **V2 (mois 7 à 12)** : caméras, campagnes, surveillance, exports nationaux, studio ouvert aux Structures, API en lecture, ISO 27001, Sénégal et Côte d'Ivoire.
4. **V3 (mois 13 à 24)** : capteurs IoT, alertes prédictives, assistant WhatsApp, API en écriture, nouvelles filières.

## Décisions ouvertes (registre complet dans `16` §7)
- **D-01** : hébergement au Cameroun.
- **D-02** : langage d'expressions.
- **D-03** : USSD au MVP.
- **D-04** : budget de développement.
- **D-05** : mode de réalisation.
- **D-06** : valeurs proposées en v2.1.
- **D-07** : agrégateurs.
- **D-08** : matériel IoT.
- **D-09** : rappel Newcastle.
- **D-10** : prix Pro canin et Structure.

Contact produit : Jean-Marc (épidémiologiste vétérinaire) — arbitrages fonctionnels et référentiels sanitaires.
