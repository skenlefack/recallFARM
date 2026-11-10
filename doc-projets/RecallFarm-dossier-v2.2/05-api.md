# 05 — API REST (v2.2)

> Version 2.2 — 27/10/2026. Les noms de ressources et de champs suivent `03-modele-de-donnees.md`. Ajouts v2.2 : §23 à §28 (paramétrage, suivi à distance, exports et imports, API publique, mode vétérinaire, analytique) ; champs `attributes`, `param_version` et antimicrobiens.
> Le contrat de référence est le fichier **OpenAPI 3.1** généré depuis le code (`apps/api`) et vérifié en CI (`16` §5). Ce document en est la description fonctionnelle.

Base URL : `https://api.recallfarm.app/v1`. Format : JSON (UTF-8). Authentification : `Authorization: Bearer <JWT>`. Horodatages en UTC (ISO 8601) ; dates métier en `YYYY-MM-DD`.

## Conventions

- **Identifiants** : tout corps de création porte un `id` (UUID v4) fourni par le client. Un `POST` avec un `id` déjà connu est un **upsert idempotent** (rejouable sans doublon).
- **Montants** *(harmonisé en v2.1)* : toujours sous la forme `{ "amount_minor": 2500, "currency": "XAF" }` (unité mineure ISO 4217, voir `03` §0.2). Dans les exemples, `Money` désigne cet objet.
- **Attributs paramétrés** *(v2.2)* : toute entité de `03` §0.4 accepte `attributes` (objet validé par le schéma du formulaire résolu ; erreur `VALIDATION_ERROR` avec le chemin du champ) et renvoie `param_version`.
- **Champs dérivés** (`current_count`, `amount_minor` d'une vente, `inbreeding_coef`, totaux de facture…) : ils sont renvoyés en lecture mais **ignorés en écriture**.
- **Pagination** : `?limit=50&cursor=<opaque>` → `{ "data": [...], "next_cursor": "..." }`.
- **Filtres** : `?farm_id=&status=&since=&subject_type=&subject_id=`.
- **Langue** : `Accept-Language: fr` (libellés des référentiels et des messages d'erreur).
- **Erreurs** (format uniforme) :
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": { "phone": "format invalide" } } }
```

| Code | HTTP | Sens |
|---|---|---|
| UNAUTHENTICATED | 401 | jeton absent ou invalide |
| FORBIDDEN | 403 | rôle ou portée insuffisants |
| PLAN_REQUIRED | 403 | fonction non incluse dans la formule (`details.required_plan`) |
| NOT_FOUND | 404 | ressource inconnue |
| CONFLICT | 409 | conflit de version (sync) ou numéro déjà attribué |
| VALIDATION_ERROR | 422 | champs invalides (détail par champ) |
| BUSINESS_RULE | 422 | règle métier violée (`details.rule`, ex. `RG-VEN-02` délai d'attente, `RG-JOU-03`) |
| QUOTA_EXCEEDED | 429 | quota de formule atteint (exploitations, caméras) |
| RATE_LIMITED | 429 | trop de requêtes |
| SERVER_ERROR | 500 | erreur interne |

## 1. Authentification et compte
- `POST /auth/otp/request` — `{ phone }` → `{ sent: true, retry_after_s }`
- `POST /auth/otp/verify` — `{ phone, code, provisional_user_id? }` → `{ access_token, refresh_token, user }` (le compte provisoire hors ligne est rattaché via `provisional_user_id`)
- `POST /auth/refresh` — `{ refresh_token }` → `{ access_token }`
- `GET /me` → profil, memberships, `entitlements` (droits signés de la formule, avec `expires_at` et `grace_until`)
- `PATCH /me` — langue, nom, devise par défaut

## 2. Données personnelles et consentements *(nouveau)*
- `GET /me/consents` · `POST /me/consents` — `{ id, scope, granted, text_version, organisation_id?, channel }` (chaque changement est un nouvel enregistrement)
- `POST /me/export` → `{ request_id, status: "recue" }` · `GET /me/requests/:id` → statut + `export_uri` (lien signé, 7 jours)
- `DELETE /me` — `{ otp_code }` → `{ request_id, scheduled_for }` (rétractation de 30 jours) · `POST /me/requests/:id/cancel`
- `GET /legal/texts?type=cgu|confidentialite&lang=` → texte versionné

## 3. Organisations et membres (Structure)
- `POST /organisations` · `GET /organisations/:id` · `PATCH /organisations/:id`
- `GET /organisations/:id/members` · `POST /organisations/:id/members` (invitation par téléphone et rôle) · `PATCH /members/:id` (rôle, `farmer_scope`) · `DELETE /members/:id`

## 4. Exploitations et logements
- `GET /farms` · `POST /farms` · `GET /farms/:id` · `PATCH /farms/:id` · `DELETE /farms/:id` (logique)
  - Corps : `{ id, name, speculations[], country, region?, currency, gps_lat?, gps_lng?, area_ha?, manager_name?, organisation_id? }`
- `GET/POST /farms/:farmId/housing-units` · `PATCH/DELETE /housing-units/:id`
- `POST /housing-units/:id/sanitary-void` — `{ until }`

## 5. Cheptel
- **Lots** : `GET/POST /farms/:farmId/batches` · `GET/PATCH/DELETE /batches/:id`
- **Animaux** : `GET/POST /farms/:farmId/animals` · `GET/PATCH/DELETE /animals/:id`
- **Chiens** : `GET/POST /farms/:farmId/dogs` · `GET/PATCH/DELETE /dogs/:id` · `POST /dogs/:id/transfer` — `{ buyer_client_id, sale_id? }` (cession, RG-CAN-02)
- **Mouvements** *(nouveau)* : `GET/POST /farms/:farmId/movements`
- **Pesées** *(nouveau)* : `GET/POST /weighings` (filtre `subject_type`, `subject_id`)

## 6. Journal quotidien
- `GET/POST /farms/:farmId/daily-logs` (filtres `subject_type`, `subject_id`, `date_from`, `date_to`)
- Corps : `{ id, subject_type, subject_id, log_date, present_count, mortality, culled?, eggs?, eggs_broken?, milk_l?, milk_sold_l?, feed_kg?, feed_item_id?, water_l?, temperature_c?, notes? }`
- Unicité (sujet, date) : un `POST` pour un couple existant renvoie `409 CONFLICT` avec l'`id` existant ; le client doit faire un `PATCH /daily-logs/:id`. En synchronisation, la fusion se fait automatiquement.

## 7. Santé, protocoles, rappels, tâches
- `GET/POST /health-events` — `{ id, subject_type, subject_id, event_type, disease?, product?, product_batch_no?, dose_route?, event_date, next_due?, withdrawal_meat_until?, withdrawal_milk_until?, withdrawal_eggs_until?, protocol_id?, protocol_step?, cost?: Money, performed_by?, performed_by_provider_id?, campaign_id?, consume_stock?: { item_id, quantity } }`
  - Réponse 201 : `{ ...health_event, sync_version, reminders: [{ id, due_date, status: "a_venir", priority }] }`
- `GET /protocols?species=&country=&disease=` — protocoles (système + organisation)
- `POST /organisations/:id/protocols` — version d'organisation (🏢)
- `GET /reminders?farm_id=&status=&due_before=&priority=`
- `POST /reminders/:id/confirm` — `{ health_event?: {...} }` → clôture et planifie l'occurrence suivante
- `POST /reminders/:id/snooze` — `{ until }` (≤ +14 j)
- `POST /reminders/:id/cancel` — `{ reason }`
- `GET /health-events/:id/certificate` → PDF + `qr_payload` (⭐)
- `GET /certificates/verify?payload=` *(public, sans authentification)* → `{ valid, animal_name, disease, event_date, valid_until }` (sans données personnelles du propriétaire)
- **Tâches** *(nouveau)* : `GET/POST /farms/:farmId/tasks` · `PATCH /tasks/:id` · `POST /tasks/:id/done`
- `GET /task-templates?speculation=` · `POST /farms/:farmId/task-templates/apply` — `{ template_ids[] }`

## 8. Biosécurité et signalements *(nouveau)*
- `GET /checklist-templates?speculation=`
- `GET/POST /farms/:farmId/checklist-runs`
- `GET/POST /farms/:farmId/disease-signals` · `POST /disease-signals/:id/send` — `{ recipients: [{type, id}] }` (exige le consentement de partage correspondant)
- `GET /disease-signals/received` — signalements reçus par un vétérinaire ou une organisation

## 9. Reproduction, portées, généalogie
- `GET/POST /reproduction-events` — `{ id, subject_type, subject_id, event, event_date, sire_id?, sire_ref?, semen_ref?, result?, notes? }`. Pour une saillie ou une IA avec `sire_id`, la réponse inclut `mating_check` ; un verdict `a_eviter` exige `confirm_inbreeding_risk: true` dans le corps, sinon `422 BUSINESS_RULE` (`EF-GEN-04`).
- `GET/POST /litters` — `{ id, species, dam_type, dam_id, sire_id?, mating_event_id?, birth_date, born_alive, stillborn }`
- `POST /litters/:id/wean` — `{ weaning_date, weaned_count, create: "batch" | "individuals", batch?: {...}, individuals?: [...] }`
- **Généalogie** *(addendum A)* :
  - `GET /animals/:id/pedigree?generations=3` · `GET /dogs/:id/pedigree?generations=3` → arbre + `inconsistencies[]`
  - `POST /mating-checks` — `{ id, species, sire_type, sire_id, dam_type, dam_id, generations?, threshold? }` → `{ expected_coef, complete, generations_used, verdict, common_ancestors[] }`
  - `GET /farms/:farmId/mating-checks`

## 10. Stocks, ventes, dépenses, trésorerie
- `GET /stock-items` (référentiel) · `GET/POST /farms/:farmId/stock-movements` · `GET /farms/:farmId/stock-summary` → `[{ item_id, quantity, unit, autonomy_days?, below_threshold, expiring_soon[] }]`
- `PUT /farms/:farmId/stock-thresholds/:itemId` — `{ min_quantity }`
- `GET/POST /farms/:farmId/sales` — `{ id, product, species?, quantity, unit, unit_price: Money, client_id?, client_name?, payment, payment_status, sale_date, subject_type?, subject_id? }` → montant calculé au serveur ; `422 BUSINESS_RULE RG-VEN-02` si le sujet est sous délai d'attente
- `GET/POST /farms/:farmId/expenses` — `{ id, category, description?, quantity?, amount: Money, payment_method, supplier?, expense_date, subject_type?, subject_id? }`
- `GET /farms/:farmId/cashflow?from=&to=` → par mois et par devise : recettes, dépenses, solde (⭐)
- `GET /farms/:farmId/kpis?period=` → KPIs de la filière (voir `10`)

## 11. Projection *(nouveau)*
- `GET /projection/defaults?speculation=&production_type=&country=` → paramètres par défaut
- `POST /projection/compute` — `{ speculation, production_type?, parameters }` → `{ results, engine_version }` (même moteur que le mobile ; utilisé par la PWA)
- `GET/POST /farms/:farmId/projection-scenarios`

## 12. Dressage, pension, facturation
- `GET/POST /clients` (filtre `organisation_id` ou `farm_id`) · `PATCH /clients/:id`
- `GET/POST /training-programs`
- `GET/POST /training-sessions` — `{ id, client_id, dog_id, program_id, session_date, duration_min, location, progress_notes?, level?, attended? }`
- `GET/POST /boarding-stays` — `{ id, dog_id, client_id, housing_unit_id?, check_in, check_out?, daily_rate: Money }` → la réponse donne `admission_status` (`differe` si la rage n'est pas à jour, RG-DRE-02) · `POST /boarding-stays/:id/checkout`
- **Facturation** *(complétée)* :
  - `GET/POST /invoices` — `{ id, issuer_type, issuer_id, client_id, kind, issue_date, due_date?, currency, lines: [{ id, description, quantity, unit_price_minor, source_type?, source_id? }] }`
  - `POST /invoices/:id/issue` → attribue le numéro définitif
  - `POST /invoices/:id/convert` (devis → facture) · `POST /invoices/:id/cancel` (crée un avoir)
  - `GET /invoices/:id/pdf`
  - `POST /invoices/:id/payments` — `{ id, method, amount: Money, phone? }` → mobile money : `{ payment_id, status: "initie", ussd_push: true }` ; espèces : `{ status: "confirme" }`

## 13. K9 (V2)
- `GET/POST /organisations/:id/k9-units` · `GET/POST /k9-units/:id/assignments` · `PATCH /k9-assignments/:id`

## 14. Marché et mise en relation
- `GET /providers?type=&near=lat,lng&radius_km=&verified=`
- `POST /providers` (inscription d'un prestataire) · `PATCH /providers/:id`
- `POST /service-requests` — `{ id, requester_farm_id, provider_id, need, subject_type?, subject_id?, subject_ref?, source_reminder_id?, preferred_date?, location?, message? }` → notifie le prestataire (app + WhatsApp)
- `GET /service-requests?role=requester|provider&status=` · `POST /service-requests/:id/status` — `{ status }`
- `POST /service-requests/:id/review` — `{ rating, comment? }` (V2)

## 15. Campagnes et surveillance (V2, 🏢)
- `GET/POST /organisations/:id/campaigns` · `POST /campaigns/:id/launch` (relance de masse) · `GET /campaigns/:id/progress`
- `GET /surveillance/coverage?zone=&disease=&species=&period=` — agrégats **anonymisés** ; cellules de moins de 5 exploitations masquées (RG-SUR-02)
- `GET /surveillance/signals?zone=&period=` — comptages de signalements par maladie et par zone
- `GET /surveillance/export?format=&zone=&period=` — format des réseaux nationaux (schéma à convenir)

## 16. Abonnement et paiement
- `GET /plans?country=` → formules, prix (`Money`), fonctions et quotas (`ref_plan_features`)
- `POST /subscriptions/checkout` — `{ account_type, account_id, plan, period, method, phone }` → `{ payment_id, status: "initie", ussd_push | redirect_url }`
- `GET /payments/:id` → statut (le mobile interroge ce point en attendant le webhook, toutes les 5 s pendant 2 min au maximum)
- `POST /payments/webhook` *(système ; signature HMAC de l'agrégateur vérifiée)* → active ou renouvelle l'abonnement, ou marque la facture payée
- `GET /subscriptions/current` → formule, `expires_at`, `grace_until`, `entitlements` signés (cache local du feature gating)

## 17. Notifications *(nouveau)*
- `GET/PUT /me/notification-preferences` — `[{ channel, enabled, quiet_hours?, max_per_day?, language }]`
- `POST /inbound/sms` *(système)* — réponse SMS de confirmation (code court) → confirme le rappel
- `POST /inbound/ussd` *(système)* — session USSD (menus courts : rappels du jour, confirmer, déclarer une mortalité)
- `POST /inbound/whatsapp` *(système)* — webhook WhatsApp Business (boutons « Fait » ou « Reporter »)
- `GET /admin/messages?status=&channel=&from=` *(administration RecallFarm)* — journal `outbound_messages`

## 18. Caméras *(addendum B, V2, ⭐)*
- `GET/POST /farms/:farmId/cameras` — `{ id, name, zone?, housing_unit_id?, connectivity, pairing_code }` → `{ ...camera, status: "en_association" }` ; `429 QUOTA_EXCEEDED` au-delà du quota de la formule
- `PATCH /cameras/:id` (nom, zone, qualité, détection, vision nocturne) · `DELETE /cameras/:id`
- `POST /cameras/:id/stream-session` → `{ webrtc_offer | hls_url, expires_in_s: 300 }` (jeton court, contrôle de `camera_access`)
- `GET /cameras/:id/events?since=` → mouvements et coupures, avec `clip_url` signé (durée de vie courte)
- `GET/POST/DELETE /cameras/:id/access` — gestion des personnes autorisées (propriétaire uniquement)

## 19. Contenus et formation
- `GET /contents?species=&type=&lang=` → fiches, audio, vidéo (`offline_available`, `size_kb`)

## 20. Synchronisation (cœur hors ligne) *(endpoint unique harmonisé)*
- `POST /sync/push` — `{ device_id, changes: [{ entity, op: "upsert"|"delete", id, client_rev, data }] }` → `{ applied: [{ id, sync_version }], conflicts: [{ id, server_data, merged_data }], rejected: [{ id, error }] }`
  - Lots de 200 changements au maximum, idempotents par (`id`, `client_rev`).
  - Ordre : entités parentes avant les enfants (le client trie selon le graphe de dépendances de `03` §11).
- `GET /sync/pull?since=<sync_version>&entities=batches,animals,…&limit=500` → `{ changes: [...], server_version, has_more }`
- Les référentiels (`ref_*`, `vaccination_protocols`, `checklist_templates`) se tirent par le même endpoint (`entities=ref`).
- Règle : les agrégats dérivés ne sont jamais acceptés en push ; le serveur les recalcule (RG-SYN-01).
- *L'ancienne forme `GET /sync?since=` (fichier `04` v2.0) est abandonnée.*

## 21. Webhooks sortants (intégrations Structure)
`service_request.created`, `reminder.due`, `reminder.missed`, `payment.confirmed`, `campaign.progress`, `disease_signal.sent`, `camera.motion` (propriétaire uniquement). Signature HMAC-SHA256 dans l'en-tête `X-RecallFarm-Signature`, avec rejeu protégé par horodatage.

## 22. Sécurité de l'API
- Rate limiting par compte et par IP (OTP : 3 demandes par 15 minutes et par numéro).
- Validation stricte des schémas (JSON Schema généré à partir des DTO).
- Autorisation par rôle **et** par portée : un agent n'accède qu'aux exploitations de son `farmer_scope` ; un prestataire ne voit que ses demandes ; l'accès aux caméras est contrôlé par `camera_access`.
- Aucune donnée individuelle dans les endpoints `/surveillance/*`.
- Le contrôle de formule se fait **au serveur** (`PLAN_REQUIRED`) en plus du gating local.


## 23. Paramétrage *(v2.2 — voir `12`)*
- `GET /params/manifest` → packs applicables à l'utilisateur : `[{ pack, version, hash, signature }]` (le mobile passe aussi par `/sync/pull?entities=params`)
- `GET /params/packs/:code/versions/:version` → contenu signé
- `GET /params/resolved?farm_id=&kind=&code=` → objet résolu + provenance par propriété (EF-PAR-11)
- **Studio** (rôles internes et administrateurs Structure) :
  - `GET/POST /studio/packs` · `GET/POST /studio/packs/:id/versions` (crée un brouillon) · `PATCH /studio/versions/:id` (contenu)
  - `POST /studio/versions/:id/validate` → erreurs de schéma, de type d'expression, de politique de surcharge
  - `POST /studio/versions/:id/test` → lance les tests (`param_test_runs`)
  - `POST /studio/versions/:id/submit` (→ `en_revue`) · `POST /studio/versions/:id/reviews` — `{ decision, comments }`
  - `POST /studio/versions/:id/publish` — `{ rollout? }` → refusé `422 BUSINESS_RULE RG-PAR-04` si l'auteur publie seul un pack global, filière ou pays
  - `POST /studio/packs/:id/rollback` — `{ to_version, reason }`
  - `POST /studio/sandbox/simulate` — `{ version_id, scenario, days: 90 }` → rappels, alertes et indicateurs simulés (V2)
- `GET/PUT /farms/:farmId/settings` — seuils, objectifs, indicateurs affichés (`farm_settings`) ; surcharges hors bornes → `422 BUSINESS_RULE RG-PAR-01`

## 24. Suivi à distance *(v2.2 — voir `13`)*
- **Passerelles** : `POST /farms/:farmId/gateways` — `{ id, name, pairing_code }` → `{ gateway, provisioning: { mqtt_host, client_cert_pem, ca_pem } }` (certificat délivré une seule fois) · `PATCH /gateways/:id` · `POST /gateways/:id/revoke`
- **Appareils** : `GET/POST /farms/:farmId/devices` — `{ id, type, gateway_id?, housing_unit_id?, sensor_profile_code, name, serial?, dev_eui? }` · `PATCH/DELETE /devices/:id`
- **Mesures** (lecture) : `GET /devices/:id/telemetry?metric=&from=&to=&resolution=raw|1h|1d` → séries (agrégats par défaut au-delà de 48 h) · `GET /farms/:farmId/live` → dernières valeurs par logement et statut des appareils
- **Alertes** : `GET /farms/:farmId/alert-rules` (règles résolues) · `GET /alerts?farm_id=&status=&severity=` · `POST /alerts/:id/ack` · `POST /alerts/:id/resolve` — `{ cause, action }` (obligatoire si critique, RG-IOT-02)
- **Astreinte** : `GET/PUT /farms/:farmId/oncall`
- **Commandes** : `POST /gateways/:id/commands` — `{ kind: 'config'|'rules'|'ota'|'reboot' }` (charge signée par le serveur)
- **Ingestion** : par **MQTT uniquement** (sujets de `13` §2.1), pas par REST. Repli HTTP réservé aux appareils qui ne parlent pas MQTT : `POST /ingest/telemetry` (authentification mTLS).
- Webhooks sortants ajoutés : `alert.opened`, `alert.escalated`, `alert.resolved`.

## 25. Exports et imports *(v2.2 — voir `14` §4)*
- `POST /exports` — `{ kind: 'icar_ade'|'dhis2'|'aris'|'garc'|'ema_i'|'epcis'|'registre_pdf'|'csv', scope, period }` → `{ job_id }` · `GET /exports/:id` → statut, `file_url` signé, empreinte
- `POST /exports/:id/send` — envoi vers la destination configurée dans le pack pays (DHIS2 : API web avec identifiants du pays ; autres : dépôt sécurisé ou courriel chiffré). Exige le consentement `surveillance_agregats` et une convention (EF-CMP-08).
- `POST /imports` (multipart CSV ou XLSX) — `{ kind, farm_id | organisation_id }` → `{ job_id }` · `GET /imports/:id` → lignes valides, erreurs par ligne · `POST /imports/:id/commit`
- **ICAR ADE** : `GET /icar/v1/animals?farm_id=` · `GET /icar/v1/events?farm_id=&since=` · `POST /icar/v1/events` (import), schémas ICAR ADE v1.5, sous l'API publique (§26)

## 26. API publique *(v2.2 — EF-INT-06)*
- Base : `https://api.recallfarm.app/public/v1`. Documentation interactive publiée (OpenAPI 3.1).
- **Authentification** : OAuth 2.0.
  - *Code d'autorisation + PKCE* pour les applications tierces agissant au nom d'un éleveur, qui consent par portée (`farms:read`, `health:read`, `health:write`, `telemetry:read`…).
  - *Identifiants client* pour les intégrations d'organisation (Structure, Institution).
- **Portées et quotas** : 60 req/min par défaut, paramétrables par contrat ; en-têtes `X-RateLimit-*`.
- **Ressources exposées** (V2 en lecture pour Institution, V3 en écriture) : exploitations, cheptel, actes sanitaires, rappels, indicateurs, agrégats de surveillance, ICAR ADE.
- **Versionnement** : rupture → `/public/v2` ; dépréciation annoncée 6 mois à l'avance (en-tête `Sunset`).

## 27. Mode vétérinaire de terrain *(v2.2 — EF-VTR)*
- `GET /vet/clients?q=` → éleveurs qui ont désigné le vétérinaire, ou qu'il a créés
- `POST /vet/farms` — `{ id, owner_phone, name, country, speculations[] }` → crée la fiche, envoie un SMS de consentement avec un code (`farm_claims`)
- `POST /vet/farms/:id/consent` — `{ code }` (saisi par le vétérinaire ou renvoyé par SMS)
- `GET /vet/rounds?date=` → rappels manqués de la clientèle, triés par distance
- `POST /farms/:id/claim` — par l'éleveur, depuis l'application, après OTP sur `owner_phone` → transfert de propriété tracé

## 28. Analytique produit *(v2.2 — EF-ANA)*
- `POST /analytics/events` — lot d'événements du catalogue de `17` §5 : `{ device_id_hash, events: [{ name, ts, props }] }`. Refusé si l'utilisateur a désactivé l'analytique. Aucun champ libre saisi par l'utilisateur.
- `GET /feature-flags` → indicateurs résolus pour l'utilisateur (aussi inclus dans `entitlements`)
- `POST /feedback` — `{ message, screenshot?, logs? }` (EF-ANA-03)

## Ajouts aux ressources existantes *(v2.2)*
- `POST /health-events` accepte `active_substance_code`, `quantity_value`, `quantity_unit` et `doses_count` (EF-AMU-01).
- `GET /reminders` et `GET /alerts` sont regroupés dans `GET /inbox?farm_id=` pour l'écran d'accueil : rappels, tâches et alertes, triés par priorité.
- `POST /inbound/ussd` : spécification du menu du pilote dans `02` E80 (EF-NOT-05).
