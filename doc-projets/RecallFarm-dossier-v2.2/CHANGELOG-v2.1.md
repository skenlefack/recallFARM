# CHANGELOG — dossier RecallFarm v2.0 → v2.1 (26/10/2026)

## Documents remplacés
- `RecallFarm-cahier-des-charges-detaille.docx` (v2.0) → `RecallFarm-cahier-des-charges-v2.1.docx` (généré à partir des fichiers .md).
- `RecallFarm-addendum-consanguinite-cameras.docx` → **intégré** dans `01` (§4.11 GEN, §4.23 CAM), `02` (E16, E63, E64), `03` (§4 et §9), `04` (§5 et §8), `05` (§9 et §18), `07`, `11` (T-13 → T-19).
- Dossier développeur v2.0 (`00` → `09`) → v2.1 ; ajout de `10-filieres.md` et `11-recette-tracabilite.md`.

## Incohérences corrigées

| # | Incohérence v2.0 | Correction v2.1 | Fichiers |
|---|---|---|---|
| 1 | Pro vendu au MVP, mais paiement mobile money en V1 | Paiement mobile money au MVP (pays pilote) | 01, 07 |
| 2 | Mode agent V2 (C) dans `01`, V1 (M) dans `07` | V1 (M) | 01, 07 |
| 3 | Certificat QR au MVP dans les jalons et en V1 dans l'user story | MVP (S) | 01, 07 |
| 4 | Montants en `numeric(12,2)` (`03`) et en « entier FCFA » (`05`, cahier des charges) ; « FCFA » en dur dans les formulaires | `bigint` en unité mineure ISO + `currency` ; objet `Money` dans l'API ; symbole de la devise de l'exploitation | 03, 05, 02 |
| 5 | État `annule` des rappels absent du modèle ; état `grace` absent des abonnements | Énumérations complétées (`annule`, `clos`, `grace`, `cloture`) | 01 §5, 03 |
| 6 | Synchronisation : `GET /sync?since` (`04`) contre `/sync/pull` (`05`) | Endpoint unique `/sync/push` + `/sync/pull` | 04, 05 |
| 7 | `POST /invoices` sans table | Tables `invoices`, `invoice_lines`, `payments` + machine à états | 01, 03, 05 |
| 8 | Consentement exigé (`08`) sans table, écran ni API | Table `consents`, écrans E03/E65, endpoints `/me/consents` | 01, 02, 03, 05 |
| 9 | Export et suppression du compte (GOV-01) sans moyen | Table `account_requests`, `POST /me/export`, `DELETE /me` | 01, 03, 05 |
| 10 | Pas de journal des envois SMS/WhatsApp, alors qu'un plafonnement est exigé | Tables `outbound_messages`, `notification_preferences` ; RG-NOT-02 | 01, 03, 05 |
| 11 | `litters.sire_ref` en texte et `pups` hors de `dogs` : pedigree rompu | `sire_id`/`dam_id` sur `animals` et `dogs` ; `pups` supprimée (chiot = `dogs.litter_id`) ; `litters` généralisée à toutes les espèces | 03 |
| 12 | Énumérations centrées sur la volaille (maladies, aliments, dépenses, produits) | Énumérations élargies aux 6 filières ; `feed_type` → référentiel `ref_stock_items` ; `feed_stock` → `stock_movements` | 03, 09 |
| 13 | Maladies citées dans `09` mais absentes de l'énumération `disease` (VHD, myxomatose, rouget, bronchite…) | Énumération complète, avec indicateurs réglementée / zoonose / sans vaccin | 03, 09 |
| 14 | Microservices (dossiers filières, addendum) contre API unique (`04`) | Monolithe modulaire dont les modules sont les futurs services ; `camera-service` séparé dès la V2 | 04 |
| 15 | Moteur de projection décrit dans les 6 dossiers, absent du cahier des charges | Module PRJ, écran E29, API `/projection/*`, tests dorés | 01, 02, 05, 10, 11 |
| 16 | Tâches (`source_type = task`) sans table | Tables `tasks` et `ref_task_templates` (calendriers des dossiers) | 01, 03, 10 |
| 17 | Biosécurité, signalement des maladies réglementées, mouvements, pesées, traite, logements : décrits dans les dossiers, absents du modèle | Tables `checklist_*`, `disease_signals`, `animal_movements`, `weighings`, `housing_units` ; champs lait dans `daily_logs` | 01, 03 |
| 18 | Tests, traçabilité, SLA et livrables présents uniquement dans le .docx | Repris et complétés dans `11` | 11 |
| 19 | Pas de stocks de produits vétérinaires (péremption) | `ref_stock_items` (catégories vétérinaire et vaccin), `lot_no`, `expiry_date` | 03 |
| 20 | Dossier porcins §5 : « ~40 portées, ~360 nés, ~306 sevrés » pour 10 truies | Valeurs du classeur : 20 portées, 180 nés, 153 sevrés (dossier .docx à corriger) | 10 |
| 21 | Newcastle : rappel J21–J28 (cahier des charges) contre J18–J21 (dossier aviculture) | J18–J21 retenu ; **à trancher par le référent** | 09 |
| 22 | Modèle financier : revenus Structure dès le mois 1 alors que Structure arrive en V1 ; utilisateurs gratuits sans coût | Ouverture de Structure au mois V1 (9) ; coût par utilisateur gratuit ; mois V1/V2 paramétrés | 06 |

## Décisions proposées en v2.1 — **à valider** par la direction produit et le référent

| Sujet | Valeur proposée | Où |
|---|---|---|
| Période de grâce de l'abonnement | 7 jours | RG-ABO-01 |
| Plafond de messages | 3 par jour et par utilisateur, hors priorité critique ; regroupement des rappels du jour | RG-NOT-02 |
| Quotas de caméras | Pro : 2 ; Structure : par contrat | 01 §4.22 |
| Conservation des clips | 7 jours (30 au maximum) | RG-CAM-02 |
| k-anonymat de la surveillance | 5 exploitations par cellule | RG-SUR-02 |
| Verdict de consanguinité | « à éviter » si F ≥ 6,25 % (cousins germains inclus) | RG-GEN-02 |
| Exploitations par formule | Découverte : 1, Pro : 3 | 01 §4.22 |
| Mortalité anormale | > 3 × la moyenne sur 7 jours, ou > 2 % en volaille, ou toute mortalité brutale en porcins | RG-JOU-06 |
| Délai d'expiration d'une demande de service | 7 jours | 01 §5.3 |
| Coût par utilisateur gratuit (modèle financier) | 10 FCFA par mois | 06, cellule B27 |
| Pays pilote du paiement au MVP | Cameroun (Orange Money + MTN MoMo via un agrégateur) | 07 |

## Impact sur le modèle financier (scénario de base)

| Indicateur | v2.0 | v2.1 |
|---|---|---|
| Clients Structure à 36 mois | 85 | 53 |
| Revenu mensuel récurrent à 36 mois | 4,16 M FCFA | 3,51 M FCFA |
| Premier mois à marge positive | mois 22 | mois 26 |
| Point bas de trésorerie | −27,4 M FCFA | −33,3 M FCFA |
| Trésorerie au mois 36 | −10,1 M FCFA | −25,5 M FCFA |

Le besoin de financement augmente d'environ 6 M FCFA. Les deux causes principales sont l'ouverture plus tardive de la formule Structure et le coût des utilisateurs gratuits.

## Restent ouverts
- Schéma d'export de surveillance (RESCAM ou réseaux nationaux) : à définir avec le référent.
- Grille des prix par pays hors FCFA (`ref_plan_prices`) et paramètres de projection par pays.
- Maquettes des écrans ajoutés (liste à la fin de `02`).
- Annexes `recallfarm-specification.md` et `cahier-de-ferme.xlsx` : non fournies pour la consolidation.
- Corriger le §5 du dossier porcins et les exemples des dossiers .docx si la décision n°21 évolue.
