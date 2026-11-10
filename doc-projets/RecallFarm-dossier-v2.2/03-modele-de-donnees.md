# 03 — Modèle de données (v2.2)

> Version 2.2 — 27/10/2026. Remplace la v2.1. Ajouts v2.2 : §0.4 (attributs paramétrés), §15 (paramétrage), §16 (suivi à distance), §17 (antimicrobiens, mode vétérinaire, divers). Les changements sont listés dans `CHANGELOG-v2.2.md`.
> Ce fichier fait autorité pour les noms de tables, de champs et d'énumérations. Les autres fichiers du dossier s'y réfèrent.

Base relationnelle : **PostgreSQL 15+ (+ PostGIS)** côté serveur, miroir local **SQLite chiffré (Drift + SQLCipher)** côté mobile. Les identifiants sont des **UUID v4 générés côté client**, ce qui permet la création hors ligne.

## 0. Conventions

### 0.1 Champs communs à toutes les tables synchronisées

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid, PK | généré par le client |
| `created_at`, `updated_at` | timestamptz (UTC) | horodatage |
| `deleted_at` | timestamptz, null | **suppression logique** (jamais de suppression physique en exploitation) |
| `created_by`, `updated_by` | uuid → users | auteur de l'écriture |
| `sync_version` | bigint | version serveur faisant autorité (delta sync) |
| `client_rev` | int | révision locale (résolution de conflits) |

Les tables de **référentiel** (préfixe `ref_`) sont en lecture seule côté mobile et sont livrées par le seed et par `GET /sync/pull`.

### 0.2 Montants et devises *(harmonisé en v2.1)*

- Tout montant est stocké en **`bigint` dans l'unité mineure ISO 4217** de sa devise, avec un champ `currency` (char(3)) sur la même ligne, ou hérité de l'exploitation quand c'est précisé.
- Exposants : XOF = 0, XAF = 0, GNF = 0, CDF = 2, MGA = 2 (table `ref_currencies`). Exemple : 2 500 FCFA → `amount_minor = 2500`, et 1 250,50 CDF → `amount_minor = 125050`.
- Aucun taux de change n'est géré (hors périmètre). Les agrégats multi-devises restent séparés par devise.
- Dans l'API, les montants circulent sous la forme `{ "amount_minor": 2500, "currency": "XAF" }`.
- Les libellés d'interface n'écrivent jamais « FCFA » en dur : ils affichent le symbole de la devise de l'exploitation.

### 0.3 Références polymorphes

`subject_type` + `subject_id` désignent un sujet de cheptel : `batch` → `batches`, `animal` → `animals`, `dog` → `dogs`. L'intégrité est contrôlée par l'application et par un trigger serveur (voir RG-MDD-04).

---

### 0.4 Attributs paramétrés et version de paramètres *(nouveau v2.2)*
- Les entités saisies par des formulaires paramétrés portent deux colonnes supplémentaires :
  - `attributes jsonb not null default '{}'` : champs propres à une filière, un pays ou une organisation, validés au serveur par le JSON Schema du formulaire résolu (`12` §6.1) ;
  - `param_version text` : identifiant du pack et de la version utilisés à la saisie, par exemple `filiere.porcin@2.0.0`.
- Entités concernées : `batches`, `animals`, `dogs`, `daily_logs`, `health_events`, `reproduction_events`, `litters`, `weighings`, `animal_movements`, `checklist_runs`, `disease_signals`, `products_sales`, `expenses`, `training_sessions`, `boarding_stays`.
- Index : GIN sur `attributes`, et index d'expression sur les attributs utilisés en filtre (déclarés dans le pack : `indexed: true`).
- **RG-MDD-07** : un attribut retiré d'un formulaire n'est jamais supprimé des données ; il reste lisible dans l'historique.

## 1. Comptes, organisations, droits

### users
`phone`* (text, unique, E.164), `email` (text, null, unique), `full_name`, `locale` (enum `locale`), `country` (enum `country`), `default_currency` (enum `currency`), `otp_verified` (bool), `pin_hash` (text, null — verrou local optionnel, jamais synchronisé en clair), `account_status` (enum `account_status`).

### organisations *(clients Structure)*
`name`*, `type` (enum `organisation_type`), `country`, `region`, `currency`, `plan` (enum `plan`), `data_hosting` (enum : `standard`, `souverain`).

### memberships
`user_id`*, `organisation_id`*, `role` (enum `role`), `farmer_scope` (jsonb : liste des `farm_id` gérées si agent), `status` (enum : `invite`, `actif`, `retire`).

### farms *(exploitations)*
`owner_id`* (→ users), `organisation_id` (null si individuel), `name`*, `speculations` (enum `speculation`[]), `country`*, `region`, `currency`* (déduite du pays, modifiable), `gps_lat`, `gps_lng` (numeric, null), `area_ha` (numeric, null), `manager_name`.

### housing_units *(bâtiments, cages, parcs — nouveau)*
`farm_id`*, `parent_id` (→ housing_units, null : une cage dans un clapier, un box dans un chenil), `type` (enum `housing_type`), `name`*, `capacity` (int, null), `area_m2` (numeric, null), `sanitary_void_until` (date, null — vide sanitaire en cours), `notes`.

### ref_plan_features *(référentiel du feature gating — nouveau)*
`plan` (enum `plan`)*, `feature_key` (text)*, `enabled` (bool), `quota` (int, null — ex. `max_farms`, `max_cameras`). Les droits effectifs sont mis en cache sur le mobile (voir `subscriptions`).

---

## 2. Cheptel

### batches *(lots/bandes : volaille, petits ruminants, porcins, lapins)*
`farm_id`*, `code`* (unique par exploitation), `species`* (enum `species`), `production_type` (enum `production_type`), `strain` (text), `initial_count`* (int ≥ 1), `current_count` (int, **dérivé**), `start_date`* (date), `birth_date_estimate` (date, null), `origin` (text), `origin_litter_id` (→ litters, null : bande issue d'un sevrage interne), `housing_unit_id` (→ housing_units, null), `purchase_cost_minor` (bigint), `status` (enum `batch_status`).

### animals *(individuels : bovins, reproducteurs de toutes espèces de rente)*
`farm_id`*, `species`*, `tag`* (boucle/identifiant, unique par exploitation), `name` (null), `sex`* (enum `sex`), `breed`, `birth_date` (null), `role` (enum `animal_role`), `repro_status` (enum `repro_status`), `housing_unit_id` (null), `batch_id` (→ batches, null : reproducteur rattaché à un troupeau géré en lot), `origin_litter_id` (→ litters, null), **`sire_id`** (→ animals, null), **`dam_id`** (→ animals, null), `pedigree_ref` (text, null), `inbreeding_coef` (numeric(6,5), **dérivé**), `inbreeding_complete` (bool, **dérivé** : faux si le pedigree est incomplet, et le coefficient est alors une borne inférieure), `photo_uri`, `status` (enum `animal_status`).

> Les reproducteurs d'une espèce gérée en lot (truies, lapines, brebis) sont enregistrés comme `animals` individuels quand l'éleveur veut suivre leur reproduction ou leur généalogie. Les animaux de production restent en `batches`.

### dogs *(chiens)*
`farm_id`*, `owner_client_id` (→ clients, null si le chien appartient à l'exploitation), `name`*, `breed`, `sex`*, `birth_date`, `coat`, `size`, `identification_type` (enum `identification_type`), `identification_value`, `temperament`, `status` (enum `dog_status`), `litter_id` (→ litters, null : chiot né dans l'élevage), **`sire_id`** (→ dogs, null), **`dam_id`** (→ dogs, null), `pedigree_ref` (LOF/registre), `inbreeding_coef` (dérivé), `inbreeding_complete` (dérivé), `birth_weight_g` (int, null), `weaning_date` (null), `buyer_client_id` (→ clients, null), `sale_id` (→ products_sales, null), `photo_uri`.

> **Changement v2.1** : la table `pups` est supprimée. Un chiot est un `dogs` avec `litter_id`, ce qui garde le pedigree continu d'une génération à l'autre.

### animal_movements *(entrées, sorties, transferts — nouveau)*
`farm_id`*, `subject_type`*, `subject_id`*, `movement_type`* (enum `movement_type`), `movement_date`*, `count` (int — pour un lot), `from_location`, `to_location` (text ou → housing_units), `counterpart` (text — vendeur/acheteur/marché), `document_ref` (laissez-passer, certificat), `sale_id` (→ products_sales, null), `notes`.
Règle : l'effectif courant d'un lot se recalcule à partir des mouvements et de la mortalité (RG-CHE-01).

### weighings *(pesées — nouveau)*
`subject_type`*, `subject_id`*, `weigh_date`*, `avg_weight_kg`* (numeric), `sample_size` (int, null), `notes`.

---

## 3. Journal, santé, rappels, tâches

### daily_logs *(journal quotidien adaptatif)*
`farm_id`*, `subject_type`* (`batch` ou `animal`), `subject_id`*, `log_date`*, `present_count` (int), `mortality` (int, défaut 0), `culled` (int, défaut 0), `eggs` (int, null — volaille), `eggs_broken` (int, null), `milk_l` (numeric, null — bovins/caprins laitiers), `milk_sold_l` (numeric, null), `feed_kg` (numeric, null), `feed_item_id` (→ ref_stock_items, null), `water_l` (numeric, null), `temperature_c` (numeric, null), `notes`.
Contrainte : un seul log par (`subject_type`, `subject_id`, `log_date`). Une deuxième saisie le même jour met à jour le log existant.

### health_events *(actes sanitaires)*
`subject_type`*, `subject_id`*, `event_type`* (enum `event_type`), `disease` (enum `disease`, null), `product`, `product_batch_no` (n° de lot du vaccin), `dose_route`, `event_date`*, `next_due` (null), `withdrawal_meat_until` (date, null), `withdrawal_milk_until` (date, null), `withdrawal_eggs_until` (date, null), `protocol_id` (→ vaccination_protocols, null), `protocol_step` (int, null), `cost_minor` (bigint), `currency`, `performed_by` (text), `performed_by_provider_id` (→ providers, null), `campaign_id` (→ campaigns, null), `stock_movement_id` (→ stock_movements, null : sortie de stock du produit), `notes`.

### reminders *(occurrences de rappel)*
`farm_id`*, `source_type`* (enum `reminder_source`), `source_id`*, `subject_type`, `subject_id`, `subject_ref` (libellé), `due_date`*, `channel_plan` (jsonb : `[{offset_days:-7, channels:["push","sms"]}, …]`), `status`* (enum `reminder_status`), `priority` (enum : `normale`, `haute`, `critique` — la rage et les maladies réglementées sont `critique`), `sent_at` (null), `confirmed_at` (null), `confirmed_by` (null), `snoozed_until` (null), `cancel_reason` (null).

### tasks *(tâches d'élevage récurrentes — nouveau)*
`farm_id`*, `template_id` (→ ref_task_templates, null), `subject_type`, `subject_id` (null : tâche d'exploitation), `title`*, `category` (enum `task_category`), `due_date`*, `recurrence` (text RRULE, null), `assignee_user_id` (null), `status` (enum : `a_faire`, `fait`, `annule`), `done_at` (null).
Chaque tâche datée génère un `reminder` (`source_type = task`).

### ref_task_templates *(calendriers types par filière — nouveau)*
`speculation`*, `production_type` (null), `title`*, `category`, `trigger` (enum : `date_fixe`, `relatif_debut_lot`, `relatif_mise_bas`, `relatif_saillie`, `recurrent`), `offset_days` (int, null), `recurrence` (RRULE, null), `default_on` (bool). Le seed vient des calendriers d'actions des dossiers filières (§11) et figure en `10-filieres.md`.

### vaccination_protocols *(référentiel éditable)*
`species`*, `production_type` (null), `disease`*, `country` (null = générique), `organisation_id` (null = protocole système, sinon version d'une organisation), `steps` (jsonb : `[{step, primo_age_days, booster_interval_days, route, mandatory}]`), `label`, `editable` (bool), `validated_by` (text — référent), `validated_at`.

### checklist_templates / checklist_runs *(biosécurité, admission, vide sanitaire — nouveau)*
- `checklist_templates` : `code`*, `speculation` (null), `label`*, `items` (jsonb : `[{key, label, critical:bool}]`), `version`.
- `checklist_runs` : `farm_id`*, `template_id`*, `subject_type`, `subject_id` (null), `run_date`*, `answers` (jsonb `{key: true|false|"na"}`), `score_pct` (dérivé), `critical_failures` (int, dérivé), `notes`.

### disease_signals *(signalement de suspicion — nouveau)*
`farm_id`*, `subject_type`, `subject_id`, `suspected_disease` (enum `disease`), `signs` (enum `clinical_sign`[]), `affected_count` (int), `dead_count` (int), `onset_date`, `reported_at`*, `status` (enum `signal_status`), `notified_to` (jsonb : `[{type:"veterinaire"|"organisation"|"service_veterinaire", id, at}]`), `outcome_notes`.
Une suspicion de maladie réglementée (`ref_diseases.notifiable = true`) déclenche une alerte **critique** au propriétaire, avec la proposition de prévenir son vétérinaire ou sa Structure.

---

## 4. Reproduction et généalogie

### reproduction_events *(rente et canin)*
`subject_type`* (`animal` ou `dog`, la femelle), `subject_id`*, `event`* (enum `repro_event`), `event_date`*, `sire_id` (→ même table que la femelle, null), `sire_ref` (text, null — mâle extérieur ou paillette), `semen_ref` (text, null), `mating_check_id` (→ mating_checks, null), `expected_birth` (date, null — calculée selon `ref_species.gestation_days`), `result` (enum : `positif`, `negatif`, `inconnu`, null — pour un diagnostic de gestation), `notes`.

### litters *(portées/mises-bas, toutes espèces — généralisée en v2.1)*
`farm_id`*, `species`*, `dam_type`* (`animal` ou `dog`), `dam_id`*, `sire_id` (null), `sire_ref` (null), `mating_event_id` (→ reproduction_events, null), `expected_birth` (null), `birth_date` (null), `born_alive` (int), `stillborn` (int), `weaned_count` (int, null), `weaning_date` (null), `offspring_batch_id` (→ batches, null : porcelets, lapereaux, agneaux mis en lot au sevrage), `notes`.
Les jeunes suivis individuellement (veaux, chiots, futurs reproducteurs) sont créés dans `animals`/`dogs` avec `origin_litter_id`/`litter_id` et héritent de `sire_id`/`dam_id`.

### mating_checks *(vérification d'accouplement — addendum A)*
`farm_id`*, `species`*, `sire_type`, `sire_id`*, `dam_type`, `dam_id`*, `expected_coef` (numeric(6,5)), `complete` (bool : faux = borne inférieure), `generations_used` (int), `threshold` (numeric, défaut 0,0625), `verdict` (enum `mating_verdict`), `checked_at`*, `checked_by`.

---

## 5. Stocks, ventes, dépenses, facturation

### ref_stock_items *(intrants — remplace l'énumération `feed_type`)*
`code`*, `category`* (enum `stock_category`), `label`*, `species` (enum[], null = toutes), `unit`* (enum `unit`), `perishable` (bool).

### stock_movements *(remplace `feed_stock`)*
`farm_id`*, `item_id`* (→ ref_stock_items), `movement_date`*, `direction`* (enum : `entree`, `sortie`, `ajustement`), `quantity`* (numeric > 0, dans l'unité de l'intrant), `unit_cost_minor` (bigint, null), `currency`, `supplier`, `lot_no` (null), `expiry_date` (null — médicaments/vaccins), `subject_type`, `subject_id` (null : destination d'une sortie), `expense_id` (→ expenses, null), `notes`.
Les seuils d'alerte sont dans `stock_thresholds` (`farm_id`, `item_id`, `min_quantity`).

### products_sales *(production et ventes)*
`farm_id`*, `product`* (enum `product`), `species` (null), `quantity`* (> 0), `unit`* (enum `unit`), `unit_price_minor`* (bigint ≥ 0), `amount_minor` (**dérivé** = quantité × prix, arrondi à l'unité mineure), `currency`*, `client_id` (→ clients, null), `client_name` (text, null), `payment` (enum `payment_method`), `payment_status` (enum : `paye`, `partiel`, `a_credit`), `sale_date`*, `subject_type`, `subject_id` (null), `invoice_id` (→ invoices, null).
Blocage : une vente de viande, de lait ou d'œufs issus d'un sujet sous délai d'attente est refusée (RG-VEN-02).

### expenses *(dépenses)*
`farm_id`*, `category`* (enum `expense_category`), `description`, `quantity` (null), `amount_minor`* (bigint ≥ 0), `currency`*, `payment_method` (enum `payment_method`), `supplier`, `expense_date`*, `subject_type`, `subject_id` (null : affectation analytique à un lot/animal).

### clients *(clients d'un dresseur, d'une pension, d'un vétérinaire, ou acheteurs)*
`organisation_id` ou `farm_id`* (exactement un des deux), `full_name`*, `phone` (E.164), `whatsapp_opt_in` (bool), `notes`.

### invoices *(devis et factures — nouveau)*
`issuer_type` (`farm` ou `organisation`)*, `issuer_id`*, `client_id`*, `kind`* (enum : `devis`, `facture`, `avoir`), `number`* (séquence unique par émetteur, attribuée **au serveur** ; numéro provisoire `PROV-<uuid court>` hors ligne), `issue_date`*, `due_date`, `currency`*, `total_minor` (dérivé), `paid_minor` (dérivé), `status`* (enum `invoice_status`), `converted_from_id` (→ invoices, null : facture issue d'un devis), `notes`.

### invoice_lines
`invoice_id`*, `description`*, `quantity`*, `unit_price_minor`*, `amount_minor` (dérivé), `source_type` (enum : `training_session`, `boarding_stay`, `sale`, `libre`), `source_id` (null).

### payments *(encaissements et paiements d'abonnement — nouveau)*
`payer_type` (`client`, `user`, `organisation`)*, `payer_id`*, `purpose`* (enum : `facture`, `abonnement`), `invoice_id` (null), `subscription_id` (null), `amount_minor`*, `currency`*, `method`* (enum `payment_method`), `provider_ref` (text, null — référence de l'agrégateur), `status`* (enum `payment_status`), `paid_at`, `fees_minor` (null).

---

## 6. Dressage, pension, K9

### training_programs
`organisation_id` ou `farm_id`*, `name`* (enum `training_program` ou texte libre), `default_price_minor`, `currency`, `sessions_planned` (int, null), `objectives`.

### training_sessions
`client_id`*, `dog_id`*, `program_id`*, `session_date`* (timestamptz), `duration_min` (défaut 45), `location` (enum : `centre`, `domicile`, `terrain`), `progress_notes`, `level` (int 1–4), `attended` (bool, null tant que la séance n'a pas eu lieu), `trainer_user_id` (null), `invoice_line_id` (null).

### boarding_stays *(pension)*
`dog_id`*, `client_id`*, `housing_unit_id` (box, null), `check_in`*, `check_out` (null), `daily_rate_minor`, `currency`, `admission_checklist_run_id` (→ checklist_runs), `admission_status` (enum : `admis`, `differe`, `refuse`), `invoice_line_id` (null), `notes`.
Règle : l'admission est **différée** si la rage n'est pas à jour (RG-DRE-02).

### k9_units / k9_assignments *(V2)*
- `k9_units` : `organisation_id`*, `name`*, `authority` (enum : `gendarmerie`, `police`, `douanes`, `armee`, `securite_privee`, `autre`).
- `k9_assignments` : `unit_id`*, `dog_id`*, `handler_name`*, `aptitudes` (enum `k9_aptitude`[]), `certified_until` (date, null), `last_training` (date), `next_recycling` (date — génère un rappel), `fit_for_service` (bool, dérivé : aptitude valide **et** rage à jour).

---

## 7. Marché, campagnes, surveillance, contenus

### providers *(annuaire)*
`type`* (enum `provider_type`), `name`*, `user_id` (null : prestataire inscrit), `country`, `region`, `gps_lat`, `gps_lng`, `specialties` (text[]), `phone`, `whatsapp` (bool), `rating` (dérivé), `verified` (bool), `verified_at`.

### service_requests
`requester_farm_id`*, `provider_id`*, `need`* (enum `service_need` ou texte), `subject_type`, `subject_id`, `subject_ref`, `source_reminder_id` (→ reminders, null : demande issue d'un rappel manqué), `preferred_date`, `location`, `message`, `status` (enum `service_request_status`), `channel` (enum : `app`, `whatsapp`, `sms`), `status_history` (jsonb).

### provider_reviews *(V2)*
`service_request_id`*, `rating` (1–5), `comment`.

### campaigns *(V2)*
`organisation_id`*, `disease`*, `species`*, `zone` (geometry ou code administratif)*, `start_date`, `end_date`, `target_count` (int), `status` (enum `campaign_status`), `message_template_id` (null).

### surveillance_reports *(agrégats anonymisés — V2)*
`zone`*, `period_start`*, `period_end`*, `disease`, `species`, `coverage_pct`, `vaccinated_count`, `population_estimate`, `bites_count` (null), `signals_count` (null), `k_anonymity_min` (int — seuil de diffusion, défaut 5), `generated_at`.
Cette table est **physiquement séparée** (schéma `surveillance`) et ne contient aucun identifiant individuel (RG-MDD-03).

### media_contents
`title`, `species` (null), `topic`, `type` (enum : `fiche`, `audio`, `video`), `lang` (enum `locale`), `uri`, `size_kb`, `offline_available` (bool), `source` (ex. AfricaVet).

---

## 8. Données personnelles, consentement, notifications

### consents *(nouveau)*
`user_id`*, `farm_id` (null), `organisation_id` (null — destinataire du partage), `scope`* (enum `consent_scope`), `granted`* (bool), `text_version`* (version des conditions acceptées), `granted_at`, `revoked_at` (null), `channel` (enum : `app`, `ussd`, `agent` — un agent peut recueillir un consentement, et le canal le trace).
Règle : seul le dernier enregistrement par (`user_id`, `scope`, `organisation_id`) fait foi. Une révocation exclut les données de l'utilisateur des agrégats calculés après la révocation.

### account_requests *(export et suppression — nouveau)*
`user_id`*, `type`* (enum : `export`, `suppression`), `status`* (enum : `recue`, `en_cours`, `prete`, `executee`, `annulee`), `requested_at`*, `scheduled_for` (null — suppression après un délai de rétractation de 30 jours), `export_uri` (null, lien signé de durée limitée), `completed_at`.

### notification_preferences *(nouveau)*
`user_id`*, `channel`* (enum `channel`), `enabled` (bool), `quiet_hours` (jsonb, null), `max_per_day` (int, défaut 3), `language` (enum `locale`).

### outbound_messages *(journal des envois — nouveau)*
`reminder_id` (null), `campaign_id` (null), `service_request_id` (null), `recipient_user_id` (null), `recipient_phone`*, `channel`*, `template_code`*, `lang`, `status`* (enum `message_status`), `provider_ref`, `cost_minor`, `currency`, `queued_at`, `sent_at`, `delivered_at`, `error_code`.
Usage : plafonnement de fréquence (RG-NOT-02), facturation des envois et suivi de délivrabilité. Cette table est **côté serveur uniquement** et n'est pas synchronisée vers le mobile.

### audit_log *(serveur uniquement)*
`entity`, `entity_id`, `action` (enum : `create`, `update`, `delete`, `restore`, `conflict_merge`), `actor_id`, `actor_role`, `on_behalf_of_farm_id` (null : saisie par un agent), `at`, `diff` (jsonb).

### subscriptions
`account_type` (`user` ou `organisation`)*, `account_id`*, `plan`* (enum `plan`), `period` (enum : `mensuel`, `annuel`), `price_minor`, `currency`, `payment_provider` (enum `payment_method`), `started_at`, `expires_at`, `grace_until` (null), `status`* (enum `subscription_status`), `entitlements_snapshot` (jsonb — droits mis en cache sur le mobile, signés par le serveur).

---

## 9. Caméras — addendum B (V2)

### cameras
`farm_id`*, `housing_unit_id` (null), `name`*, `zone` (text), `model` (text), `connectivity` (enum : `wifi`, `4g`), `status` (enum `camera_status`), `stream_ref` (identifiant côté serveur média : jamais une URL RTSP en clair sur le mobile), `default_quality` (enum : `basse`, `moyenne`, `haute` ; défaut `basse`), `night_vision` (bool), `motion_detection` (bool), `last_seen_at`.

### camera_events
`camera_id`*, `type`* (enum `camera_event_type`), `at`*, `clip_uri` (null — object storage, lien signé), `clip_duration_s` (défaut 20), `expires_at` (purge automatique, voir RG-CAM-02), `acknowledged_by` (null).

### camera_access *(droits fins)*
`camera_id`*, `user_id`*, `granted_by`*, `granted_at`. Par défaut, seuls le propriétaire et les agents autorisés y figurent (EF-CAM-05).

---

## 10. Référentiels (tables `ref_*`, seedées)

| Table | Contenu |
|---|---|
| `ref_species` | espèce, `gestation_days` (volaille null, lapin 31, porcin 114, ovin 150, caprin 150, bovin 283, chien 63), `management_mode` (`lot`, `individuel`, `mixte`) |
| `ref_diseases` | code, libellés, espèces, `notifiable` (bool), `zoonosis` (bool), `vaccine_available` (bool) |
| `ref_currencies` | code ISO, exposant, symbole |
| `ref_countries` | pays, devise, opérateurs mobile money, langues |
| `ref_stock_items` | intrants (voir §5) |
| `ref_task_templates` | calendriers types (voir §3) |
| `ref_plan_features` | feature gating (voir §1) |
| `ref_plan_prices` | prix des formules par pays, devise et période (`plan`, `country`, `period`, `price_minor`, `currency`) |
| `ref_projection_defaults` | paramètres par défaut du moteur de projection, par filière et par pays (voir `10-filieres.md`) |
| `checklist_templates` | check-lists (voir §3) |
| `vaccination_protocols` | protocoles (voir §3 et `09`) |

### projection_scenarios *(simulations enregistrées — nouveau)*
`farm_id`*, `speculation`*, `production_type` (null), `name`, `parameters` (jsonb), `results` (jsonb, **dérivé**), `engine_version`* (text), `created_at`.

---

## 11. Relations principales

- `organisations 1—N memberships N—1 users` ; `organisations 1—N farms` ; `users 1—N farms`.
- `farms 1—N housing_units / batches / animals / dogs / daily_logs / stock_movements / products_sales / expenses / tasks / cameras`.
- `animals 1—N animals` (via `sire_id` et `dam_id`) ; `dogs 1—N dogs` (idem).
- `litters N—1 animals|dogs` (mère) ; `litters 1—N animals|dogs` (jeunes individualisés) ; `litters 1—1 batches` (jeunes en lot).
- `health_events 1—N reminders` ; `tasks 1—N reminders` ; `training_sessions 1—N reminders` ; `k9_assignments 1—N reminders`.
- `reminders 1—N outbound_messages` ; `reminders 1—N service_requests` (demande depuis un rappel manqué).
- `invoices 1—N invoice_lines` ; `invoices 1—N payments` ; `subscriptions 1—N payments`.
- `cameras 1—N camera_events` ; `cameras 1—N camera_access`.

## 12. Règles d'intégrité

- **RG-MDD-01** : suppression logique systématique ; l'historique est conservé. La seule suppression physique est l'exécution d'une `account_requests` de type `suppression`, qui anonymise les tables de journal.
- **RG-MDD-02** : les agrégats dérivés (`current_count`, stocks, taux, `amount_minor` dérivés, `inbreeding_coef`, `results` de projection) sont recalculés à partir des événements. La source de vérité est l'événement.
- **RG-MDD-03** : cloison physique entre les données individuelles (schéma `app`) et les agrégats de surveillance (schéma `surveillance`). Seul le `surveillance-service` écrit dans `surveillance` ; il ne lit que des vues agrégées qui filtrent sur les consentements actifs.
- **RG-MDD-04** : les références polymorphes (`subject_type`/`subject_id`) sont contrôlées par l'application et par un trigger serveur.
- **RG-MDD-05** : un pedigree ne peut pas contenir de boucle. Un animal ne peut pas être son propre ascendant, et `sire_id`/`dam_id` doivent référencer un sujet de même espèce, de bon sexe et né avant lui.
- **RG-MDD-06** : les montants d'une même ligne partagent la même devise. Aucune somme n'additionne des devises différentes.

---

## 13. Énumérations

> Les libellés affichés sont traduits (fichiers i18n). Les valeurs ci-dessous sont des codes techniques stables.

| Énumération | Valeurs |
|---|---|
| `speculation` | aviculture, petits_ruminants, bovins, porcins, cuniculture, elevage_canin, dressage, pension_canine, veterinaire, cooperative |
| `species` | volaille, ovin, caprin, bovin, porcin, lapin, chien |
| `production_type` | chair, ponte, poulette, reproducteur, naissage, engraissement, naissage_engraissement, embouche, lait, viande, mixte |
| `batch_status` | en_cours, vide_sanitaire, vendue, reformee, terminee |
| `animal_role` | reproducteur, reproductrice, production, jeune, travail |
| `animal_status` | actif, vendu, reforme, mort, perdu |
| `repro_status` | non_saillie, saillie, gestante, vide, allaitante, tarie, reforme |
| `dog_status` | compagnie, reproducteur, travail, dressage, pension, chiot, cede, decede |
| `identification_type` | puce, tatouage, boucle, photo, aucune |
| `sex` | M, F |
| `housing_type` | batiment, poulailler, cage, clapier, case, porcherie, bergerie, etable, parc, box, chenil, autre |
| `movement_type` | achat, naissance, transfert_interne, transhumance_depart, transhumance_retour, vente, don, mort, perte, abattage_auto |
| `event_type` | vaccination, traitement, deparasitage, vitamines, desinfection, depistage, soin_neonatal |
| `disease` | **Volaille** : newcastle, gumboro, marek, bronchite_infectieuse, variole_aviaire, coccidiose, coryza, salmonellose, colibacillose, influenza_aviaire · **Petits ruminants** : ppr, ppcc, clavelee, variole_caprine, ecthyma, parasitisme_gi · **Bovins** : fievre_aphteuse, ppcb, dermatose_nodulaire, brucellose, tuberculose, trypanosomose, mammite · **Porcins** : peste_porcine_africaine, peste_porcine_classique, rouget, colibacillose_porcelet, anemie_porcelet · **Lapins** : vhd, myxomatose, pasteurellose, enterite · **Chiens** : rage, chppil, parvovirose, maladie_carre, hepatite_rubarth, leptospirose, toux_chenil, ehrlichiose, babesiose, leishmaniose · **Transverses** : charbon, gale, parasites_externes, parasites_internes, autre |
| `clinical_sign` | mortalite_brutale, fievre, abattement, signes_respiratoires, diarrhee, signes_nerveux, lesions_cutanees, chute_ponte, chute_lait, avortement, boiterie, morsure, autre |
| `signal_status` | brouillon, envoye, pris_en_charge, confirme, infirme, clos |
| `reminder_source` | health_event, task, training_session, reproduction_event, k9_assignment, boarding_stay, subscription |
| `reminder_status` | a_venir, envoye, confirme, manque, annule, clos |
| `task_category` | alimentation, eau, hygiene, pesee, reproduction, biosecurite, stock, traite, economie, autre |
| `repro_event` | chaleurs, saillie, ia, diagnostic_gestation, tarissement, mise_bas, avortement, sevrage |
| `mating_verdict` | acceptable, a_eviter, minore_acceptable, minore_a_eviter |
| `stock_category` | aliment, fourrage, mineral, litiere, veterinaire, vaccin, desinfectant, reproduction, autre |
| `unit` | kg, sac, litre, tete, unite, plateau, dose, seance, jour |
| `product` | oeufs_plateau, oeuf_unite, poulet_vif, poulet_abattu, poule_reforme, lapin_vif, lapin_carcasse, porc_vif, porcelet, porc_carcasse, petit_ruminant_vif, bovin_vif, animal_reforme, reproducteur, lait, fumier, peau, chiot, prestation, autre |
| `expense_category` | achat_animaux, aliment, fourrage, veterinaire, reproduction, main_oeuvre, energie_eau, equipement, batiment_entretien, transport, litiere, biosecurite, frais_marche_taxes, communication, abonnement, divers |
| `payment_method` | orange_money, mtn_momo, moov_money, wave, free_money, airtel_money, mpesa, mvola, especes, virement, credit, cheque |
| `payment_status` | initie, en_attente, confirme, echoue, rembourse |
| `invoice_status` | brouillon, emis, partiellement_paye, paye, annule, converti |
| `currency` | XOF, XAF, GNF, CDF, MGA |
| `locale` | fr, en, wo, bm, dyu, ff, mos, ln, sw, sg, ewo, mg |
| `country` | SN, CI, ML, BF, BJ, TG, NE, GW, CM, GA, CG, TD, CF, GQ, GN, CD, MG (la Mauritanie, présente dans l'étude de marché, exigerait d'ajouter la devise MRU : hors périmètre v2.1) |
| `organisation_type` | cooperative, clinique, centre_canin, projet, ong, unite_k9, service_veterinaire |
| `role` | proprietaire, membre, agent, veterinaire, admin, prestataire ; rôles internes RecallFarm : param_author, referent_sanitaire, param_publisher, support, ops |
| `account_status` | provisoire, verifie, actif, suspendu, cloture |
| `plan` | decouverte, pro, structure, institution |
| `subscription_status` | actif, expire, grace, suspendu, cloture |
| `training_program` | education_chiot, obeissance, protection, detection, pistage, chasse, agility, rehabilitation |
| `k9_aptitude` | detection_stupefiants, detection_explosifs, detection_devises, patrouille, mordant, pistage, recherche_personnes |
| `provider_type` | veterinaire, auxiliaire_veterinaire, inseminateur, dresseur, pension, fournisseur, acheteur |
| `service_need` | visite_veterinaire, vaccination, insemination, castration, dressage, pension, achat_intrants, vente_animaux, autre |
| `service_request_status` | envoyee, vue, acceptee, refusee, cloturee, expiree |
| `campaign_status` | brouillon, planifiee, en_cours, terminee, annulee |
| `consent_scope` | cgu_confidentialite, surveillance_agregats, partage_organisation, partage_veterinaire, partage_prestataire, messages_whatsapp, messages_sms |
| `channel` | push, sms, ussd, whatsapp, vocal |
| `message_status` | en_file, envoye, delivre, echoue, plafonne, desinscrit |
| `camera_status` | en_ligne, hors_ligne, en_association, desactivee |
| `camera_event_type` | mouvement, hors_ligne, retour_en_ligne, intrusion, son |
| `param_level` *(v2.2)* | global, filiere, pays, org |
| `param_status` *(v2.2)* | brouillon, en_revue, teste, publie, retire |
| `override_policy` *(v2.2)* | libre, bornee, ajout_seulement, verrouillee |
| `device_type` *(v2.2)* | gateway, temp_rh, nh3, co2, water_flow, water_level, silo_level, scale, activity_tag, door_contact, power, water_quality, camera |
| `device_status` *(v2.2)* | en_association, en_ligne, hors_ligne, batterie_faible, desactive, revoque |
| `alert_severity` *(v2.2)* | info, attention, critique |
| `alert_status` *(v2.2)* | ouverte, escaladee, acquittee, resolue, close |
| `alert_source` *(v2.2)* | daily_logs, telemetry, reminders, stock_movements, camera_events |
| `amr_class` *(v2.2)* | classes d'antimicrobiens du référentiel OMSA/OMS (`ref_active_substances`) |

## 14. Synchronisation (voir `04`)

- Chaque écriture locale incrémente `client_rev` et entre dans la file locale. Le serveur renvoie le `sync_version` qui fait autorité.
- En cas de conflit, la fusion se fait **au niveau du champ** : la dernière écriture gagne pour chaque champ, et la fusion est journalisée (`audit_log.action = conflict_merge`).
- Les champs marqués **dérivé** ne sont jamais acceptés comme vérité en `push`. Le serveur les recalcule.
- Tables **non synchronisées vers le mobile** : `audit_log`, `outbound_messages`, `payments` (sauf statut de la facture), schéma `surveillance`, `camera_events.clip_uri` (lien signé à la demande).


---

## 15. Paramétrage *(nouveau v2.2 — voir `12`)*

### param_packs
`code`* (ex. `filiere.porcin`, unique), `level`* (enum `param_level`), `scope_ref` (null pour `global` ; code filière, code pays ou `organisation_id`), `title`, `owner_user_id`, `review_required` (bool).

### param_pack_versions
`pack_id`*, `version`* (semver, unique par pack), `status`* (enum `param_status`), `content` (jsonb, document du pack), `content_hash` (sha256), `signature` (Ed25519, à la publication), `requires` (jsonb), `changelog` (text), `author_id`, `published_by`, `published_at`, `retired_at`, `rollout` (jsonb : `{percent:10}` ou `{farm_ids:[…]}`).
Contraintes : une seule version `publie` sans `rollout` par pack ; le contenu d'une version publiée est immuable.

### param_reviews
`version_id`*, `reviewer_id`*, `decision`* (enum : `approuve`, `refuse`, `commentaire`), `comments`, `reviewed_at`.
**RG-PAR-04** : `reviewer_id ≠ author_id` pour les niveaux `global`, `filiere` et `pays`.

### param_test_runs
`version_id`*, `kind` (enum : `schema`, `golden`, `cross_engine`, `resolution`, `simulation`), `passed` (bool), `report` (jsonb), `ran_at`.

### param_publications *(journal)*
`version_id`*, `action` (enum : `publish`, `rollback`, `retire`, `rollout_change`), `actor_id`, `at`, `reason`.

### farm_settings
`farm_id`* (unique), `alert_thresholds` (jsonb : surcharges bornées des règles), `targets` (jsonb : objectifs d'indicateurs), `dashboard_kpis` (text[]), `oncall_default` (jsonb).

### param_override_events *(serveur uniquement)*
`farm_id`, `object_ref`, `attempted_value`, `policy`, `at`. Journal des surcharges refusées (RG-PAR-01).

---

## 16. Suivi à distance *(nouveau v2.2 — voir `13`)*

### gateways
`farm_id`*, `name`*, `serial`* (unique), `model`, `firmware_version`, `cert_fingerprint`, `cert_expires_at`, `sim_msisdn` (chiffré), `status` (enum `device_status`), `last_seen_at`, `battery_pct`, `power_source` (enum : `secteur`, `solaire`, `batterie`), `location` (geometry, null).

### devices
`farm_id`*, `gateway_id` (null : capteur ou caméra connecté directement), `housing_unit_id` (null), `type`* (enum `device_type`), `sensor_profile_code` (code du pack), `name`*, `serial`, `protocol` (enum : `lorawan`, `ble`, `wifi`, `modbus`, `onvif`), `dev_eui` (LoRaWAN, null), `status`, `last_seen_at`, `battery_pct`, `calibration` (jsonb : décalage, facteur, date).

### telemetry *(hypertable TimescaleDB, base séparée)*
`device_id`*, `ts`* (timestamptz), `metric`* (text, ex. `temp_c`), `value`* (double), `quality` (smallint : 0 = brute, 1 = valide, 2 = aberrante). Clé (`device_id`, `metric`, `ts`).
Agrégats continus : `telemetry_1h` et `telemetry_1d` (min, max, moyenne, nombre). Rétention : brut 90 jours, horaire 2 ans, journalier sans limite.
Cette table n'est **pas synchronisée** vers le mobile : l'application lit les agrégats par l'API.

### alert_rules *(règles résolues)*
`farm_id`*, `source_rule_code`* (code de la règle dans le pack), `param_version`, `source`* (enum `alert_source`), `scope` (jsonb : logement, appareil, sujet), `when_expr`*, `for_seconds`, `severity`*, `channels` (enum `channel`[]), `recipients` (jsonb), `escalation` (jsonb : `[{after_s:900, to:'astreinte_2'}, {after_s:1800, channel:'vocal'}]`), `cooldown_s` (défaut 3600), `edge` (bool), `enabled` (bool), `threshold_overrides` (jsonb, issus de `farm_settings`).

### alert_events
`farm_id`*, `rule_id`*, `opened_at`*, `status`* (enum `alert_status`), `severity`, `trigger_value` (jsonb : mesures ou valeurs ayant déclenché), `subject_type`, `subject_id`, `housing_unit_id`, `device_id`, `repeat_count` (int), `acknowledged_by`, `acknowledged_at`, `resolved_at`, `resolution_cause` (enum : `chaleur`, `panne_eau`, `panne_electrique`, `capteur_defectueux`, `intrusion`, `maladie`, `fausse_alerte`, `autre`), `resolution_action` (text), `linked_mortality_log_id` (null, RG-IOT-03), `origin` (enum : `serveur`, `passerelle`, `mobile`).

### alert_notifications
`alert_event_id`*, `recipient_user_id`, `channel`*, `level` (int, niveau d'escalade), `outbound_message_id` (null), `sent_at`, `delivered_at`, `ack_via` (null : `app`, `sms`, `vocal`).

### oncall_schedules
`farm_id`*, `name`, `rotation` (jsonb : plages horaires, jours, personnes par niveau), `timezone`, `active` (bool).

### device_commands
`gateway_id` ou `device_id`*, `kind`* (enum : `config`, `rules`, `ota`, `reboot`, `revoke`), `payload` (jsonb, signé), `status` (enum : `en_attente`, `envoye`, `applique`, `echoue`), `created_at`, `applied_at`.

Ajouts aux tables existantes :
- `daily_logs.measured_fields` (text[]) : champs remplis automatiquement par les capteurs (EF-IOT-10) ;
- `daily_logs.alert_event_id` (null) : lien RG-IOT-03 ;
- `camera_events.alert_event_id` (null) : EF-IOT-12.

---

## 17. Autres ajouts v2.2

### ref_active_substances *(antimicrobiens et autres principes actifs — EF-AMU)*
`code`*, `name`*, `amr_class` (enum `amr_class`, null si non antimicrobien), `who_importance` (enum : `critique_priorite_haute`, `critique`, `tres_important`, `important`, null), `species_allowed` (enum `species`[]).
Ajouts à `health_events` : `active_substance_code` (null), `quantity_value` (numeric, null), `quantity_unit` (enum `unit`, null), `doses_count` (int, null).

### farm_claims *(transfert de propriété — mode vétérinaire de terrain, EF-VTR-02)*
`farm_id`*, `created_by_user_id`* (le vétérinaire), `owner_phone`* (E.164), `consent_sms_code_hash`, `consent_confirmed_at`, `claimed_by_user_id` (null), `claimed_at` (null).
**RG-VTR-02** : tant que la fiche n'est pas réclamée, le vétérinaire créateur agit comme gestionnaire délégué, dans la limite du consentement.

### feature_flags
`key`*, `description`, `rules` (jsonb : pays, cohortes, pourcentage, formule), `enabled` (bool), `updated_by`, `updated_at`. Les valeurs résolues descendent avec les droits signés (EF-ANA-04).

### export_jobs *(EF-INT)*
`kind`* (enum : `icar_ade`, `dhis2`, `aris`, `garc`, `ema_i`, `epcis`, `registre_pdf`, `csv`), `requested_by`*, `scope` (jsonb), `mapping_version` (pack `export_mapping`), `status` (enum : `en_file`, `en_cours`, `pret`, `echoue`, `envoye`), `file_uri`, `file_hash`, `destination` (text), `created_at`, `completed_at`.

### import_jobs *(EF-INT-09)*
`kind`* (enum : `cheptel`, `clients`, `historique_sanitaire`), `farm_id` ou `organisation_id`*, `file_uri`*, `status`, `rows_total`, `rows_ok`, `errors` (jsonb : ligne, champ, message), `created_by`, `created_at`.

### Relations ajoutées
- `param_packs 1—N param_pack_versions 1—N param_reviews / param_test_runs / param_publications`.
- `farms 1—N gateways 1—N devices 1—N telemetry` ; `farms 1—N alert_rules 1—N alert_events 1—N alert_notifications`.
- `alert_events 0—1 daily_logs` (mortalité liée) ; `camera_events 0—1 alert_events`.
