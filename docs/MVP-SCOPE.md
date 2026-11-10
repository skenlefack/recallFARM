# RecallFarm — périmètre et contrat du MVP (monorepo)

Sources qui font foi, dans l'ordre : ce document (pour le MVP) → dossier v2.2 (`/home/claude/RecallFarm-dossier-v2.2/`,
en particulier `01`, `02`, `03`, `05`, `12`) → maquettes (`docs/design/*.dc.html`).
Langue de l'interface : français (clés i18n prêtes pour l'anglais).

## 1. Architecture du dépôt

```
apps/api        NestJS 10 (TypeScript), TypeORM + PostgreSQL 16 (PostGIS facultatif), port 3000, préfixe /v1
apps/web        React 18 + Vite + TypeScript : site public (/), espace d'administration (/admin), studio (/admin/studio)
apps/mobile     Flutter 3.24+ (Dart 3.5) : application éleveur hors ligne d'abord (Android d'abord)
packages/params packs JSON (source), spécification des expressions et des moteurs, vecteurs de test communs
infra           docker-compose, nginx (passerelle), scripts
```

Déploiement (dev et pilote) : `docker compose up -d` → `gateway` (nginx :8080) sert le web et proxifie `/v1` vers `api`.
Services : `postgres` (postgis/postgis:16-3.4), `redis` (7), `api`, `web`, `gateway`. Pas de dépendance cloud.

## 2. Comptes de démonstration (seed `npm run seed`, idempotent)

| Téléphone | Nom | Rôle | Formule |
|---|---|---|---|
| +237690000001 | Marthe Ngo Bayiha | éleveuse, propriétaire « Ferme de Mfou » (volaille + chiens) | Pro |
| +237690000002 | Aïcha Nana | administratrice de « Coop. avicole du Centre » (Structure, 312 éleveurs simulés) | Structure |
| +237690000003 | Jean-Marc | rôle plateforme `param_author` (studio) | — |
| +237690000004 | Dr Mbarga | rôle plateforme `param_reviewer` + `param_publisher` | — |
| +237690000009 | Super admin | `platform_admin` | — |

En dev (`OTP_DEV_ECHO=true`), `POST /auth/otp/request` renvoie `dev_code` ; sinon le code part par l'adaptateur SMS.
Le simulateur SMS stocke les messages : `GET /v1/dev/outbox` (dev uniquement).
Données de démo : celles des maquettes (bande B01 pondeuses 1 980 sujets, bande B02 chair 197, chien « Rex »
berger allemand puce 120093000418271, rage faite le 2025-10-30, etc.). Toutes fictives.

## 3. Conventions d'API (reprises de `05`)
- JSON, `Authorization: Bearer <JWT>` (accès 15 min, rafraîchissement 30 j), UUID v4 fournis par le client, upsert idempotent.
- Listes : `{ "data": [...], "next_cursor": "..."|null }`. Erreurs : `{ "error": { "code", "message", "fields"?, "details"? } }` (codes de `05`).
- Montants : `{ "amount_minor": 2500, "currency": "XAF" }`. Dates métier `YYYY-MM-DD`, horodatages ISO UTC.
- Toute entité saisie par formulaire accepte `attributes` (validé par le formulaire résolu) et renvoie `param_version`.
- Entités synchronisées : `id, created_at, updated_at, deleted_at, created_by, sync_version, client_rev`.
- OpenAPI 3.1 généré par `@nestjs/swagger`, servi sur `/v1/docs` et exporté dans `apps/api/openapi.json`.

## 4. Endpoints du MVP (tous sous `/v1`)

### Auth et compte
- `POST /auth/otp/request {phone}` → `{sent, retry_after_s, dev_code?}` (3 demandes / 15 min / numéro)
- `POST /auth/otp/verify {phone, code}` → `{access_token, refresh_token, user}`
- `POST /auth/refresh {refresh_token}` → `{access_token}`
- `GET /me` → `{id, phone, name, language, platform_roles[], memberships:[{organisation_id, organisation_name, role}], farms:[{id,name}], entitlements}`
- `PATCH /me {name?, language?}` · `GET/POST /me/consents` · `POST /me/export` · `DELETE /me`
- `entitlements` = `{plan, features[], quotas{}, expires_at, grace_until, token}` où `token` est un JWS Ed25519 (vérifiable hors ligne avec la clé publique `GET /params/public-key`).

### Organisations (Structure)
- `GET /organisations/:id` · `GET/POST /organisations/:id/members` · `PATCH/DELETE /members/:id`
- `GET /organisations/:id/dashboard?week=2026-W44&speculation=` → données du tableau de bord de la maquette Admin :
  `{ kpis:{confirmed_rate, confirmed_rate_delta_pts, target_rate, active_farmers_7d, total_farmers, farmers_without_smartphone, overdue_reminders, overdue_j3, avg_mortality_pct, batches_over_threshold},
     weekly:[{week, due, confirmed}] (12 semaines), coverage:{disease, cells:[{zone, rate|null, masked}]},
     todo:[{id, severity, farm_name, reason, since, action}], params:[{pack, version, status}], pending_change?, sms:{used, quota} }`
- `GET /organisations/:id/farms?q=` (exploitations suivies) · `GET /organisations/:id/reminders?status=`

### Exploitations, cheptel, journal
- `GET/POST /farms` · `GET/PATCH/DELETE /farms/:id` — `{id, name, speculations[], country, region?, currency, gps_lat?, gps_lng?, organisation_id?}`
- `GET/POST /farms/:farmId/batches` · `GET/PATCH/DELETE /batches/:id` — `{id, name, species, production_type, start_date, initial_count, current_count (dérivé), attributes, param_version}`
- `GET/POST /farms/:farmId/dogs` · `GET/PATCH/DELETE /dogs/:id` — `{id, name, breed, sex, birth_date, chip_number, attributes, rabies_status (dérivé: a_jour|expire|inconnu), rabies_valid_until (dérivé)}`
- `GET/POST /farms/:farmId/daily-logs` · `PATCH /daily-logs/:id` — colonnes standard de `05` §6 + `attributes`. Unicité (sujet, date) → 409 avec `details.existing_id`. Chaque enregistrement évalue les `alert_rule` résolues (source `daily_logs`) et peut ouvrir une alerte.

### Santé, rappels, tâches, certificat
- `POST /health-events` (forme de `05` §7) → `{...event, reminders:[...]}` ; le moteur (ENGINES.md §2) recalcule les rappels du sujet. `consume_stock` crée une sortie de stock.
- `GET /health-events?subject_type=&subject_id=`
- `GET /protocols?species=&country=` (protocoles résolus pour l'exploitation : `?farm_id=`)
- `GET /reminders?farm_id=&status=&due_before=` · `POST /reminders/:id/confirm {health_event?}` · `POST /reminders/:id/snooze {until}` · `POST /reminders/:id/cancel {reason}`
- `GET /inbox?farm_id=` → `{ today:[...], upcoming:[...], alerts:[...], tasks:[...], week_kpis:[{code,label,value,unit,trend[]}], pending_sync? }` (écran Accueil)
- `GET /farms/:farmId/tasks` · `POST /farms/:farmId/tasks` · `POST /tasks/:id/done`
- `GET /health-events/:id/certificate` → PDF (⭐ Pro) ; `GET /health-events/:id/certificate.json` → `{qr_payload, valid_until}`
- `GET /certificates/verify?payload=` *(public)* → `{valid, animal_name, species, disease, event_date, valid_until}` ; payload = `base64url(json) + "." + signature Ed25519`.

### Stocks, ventes, dépenses, indicateurs
- `GET /stock-items` · `GET/POST /farms/:farmId/stock-movements` · `GET /farms/:farmId/stock-summary`
- `GET/POST /farms/:farmId/sales` (RG-VEN-02 : 422 `BUSINESS_RULE` si sujet sous délai d'attente) · `GET/POST /farms/:farmId/expenses`
- `GET /farms/:farmId/kpis?period=7d|30d` → indicateurs des packs (`kpi`) calculés côté serveur + marge du mois.

### Alertes et suivi à distance (démonstration MVP, V3 au dossier)
- `GET /alerts?farm_id=&status=&severity=` · `POST /alerts/:id/ack` · `POST /alerts/:id/resolve {cause, action}`
- `GET /farms/:farmId/live` → `{gateway:{online, last_seen}, tiles:[{device_id, name, metric, value, unit, status, series[]}]}`
- `POST /ingest/telemetry {device_id, metric, value, ts}` (clé d'appareil `X-Device-Key`) ; un simulateur (`npm run simulate:iot`) publie des mesures. Règles `sensor_profile.default_alert` avec `for` et escalade simplifiée (propriétaire → astreinte au bout de 15 min, statut visible sur l'alerte : `escalation:[{level, target, at, done}]`).

### Généalogie (démonstration, V1 au dossier)
- `POST /mating-checks {species, sire_id, dam_id, generations?}` → `{expected_coef, verdict: ok|attention|a_eviter, common_ancestors[], threshold: 0.0625}` (coefficient de Wright sur les pedigrees `dogs.sire_id/dam_id`, `animals.sire_id/dam_id`).

### Abonnement et paiement
- `GET /plans?country=CM` → formules, prix (packs), fonctions, quotas
- `POST /subscriptions/checkout {account_type: user|organisation, account_id, plan, period: monthly|yearly, method: orange_money|mtn_momo, phone}` → `{payment_id, status:"initie", ussd_push:true}`
- `GET /payments/:id` · `POST /payments/webhook` (HMAC `X-Signature` vérifiée) · `GET /subscriptions/current`
- Simulateur mobile money (dev) : confirme automatiquement après 5 s, ou `POST /dev/payments/:id/{confirm|fail}`.
- Contrôle de formule au serveur : 403 `PLAN_REQUIRED` avec `details.required_plan`.

### Notifications
- Ordonnanceur (toutes les minutes, `@nestjs/schedule`, verrou Redis) : applique le plan d'envoi (J-7, J-1, J, J+3), heures calmes, plafond SMS/jour, quota de formule ; journal `outbound_messages`.
- Adaptateurs : `SmsProvider` (simulateur | agrégateur HTTP générique), `WhatsAppProvider` (simulateur), `PaymentProvider` (simulateur | Orange | MTN : interfaces prêtes, non branchées).
- `POST /inbound/sms {from, text}` : « OK <code> » confirme le rappel · `POST /inbound/ussd {session_id, phone, text}` → `{response:"CON …"|"END …"}` (menu du pack `ussd_menu`).
- `GET /admin/messages` (journal des envois, admin plateforme et organisation pour ses membres).

### Paramétrage et studio
- `GET /params/manifest?farm_id=` → `[{pack, version, hash, signature}]` · `GET /params/packs/:code/versions/:version` · `GET /params/resolved?farm_id=&kind=&code=` (avec provenance) · `GET /params/public-key`
- Studio : `GET /studio/packs` · `GET /studio/packs/:code/versions` · `POST /studio/packs/:code/versions` (brouillon depuis la dernière version) · `PATCH /studio/versions/:id {content}` · `POST /studio/versions/:id/validate` → `{errors:[{path, message}]}` · `POST /studio/versions/:id/test` (vecteurs + simulation de frise) · `POST /studio/versions/:id/submit` · `POST /studio/versions/:id/reviews {decision: approuve|refuse, comments}` · `POST /studio/versions/:id/publish {rollout_pct?}` (RG-PAR-04 quatre yeux) · `POST /studio/packs/:code/rollback {to_version, reason}` · `GET /studio/versions/:id/diff` → changements depuis la version publiée · `POST /studio/simulate-protocol {version_id, protocol_code, birth_or_start_date}` → frise.

### Synchronisation
- `POST /sync/push` et `GET /sync/pull` exactement comme `05` §20. Entités MVP : `farms, batches, dogs, daily_logs, health_events, reminders (pull seulement), tasks, stock_movements, sales, expenses, alerts (pull), params (pull : manifeste + packs)`.
- Conflits : dernier écrit gagne par champ pour les entités simples ; `daily_logs` fusionnés (somme des mortalités, valeurs max pour les comptages) ; agrégats dérivés ignorés en push (RG-SYN-01).

### Import, export, analytique, divers
- `POST /imports` (CSV : `kind=farmers` colonnes `phone,name,farm_name,region,speculations`) → `{job_id, valid_rows, errors:[{row, field, message}]}` · `POST /imports/:id/commit`
- `POST /exports {kind:'csv', scope:'reminders'|'farms'|'health_events', period}` → fichier CSV
- `POST /analytics/events` · `GET /feature-flags` · `POST /leads {phone, name?, source}` (formulaire « Être rappelé » du site public)
- `GET /health` (vivacité) et `GET /ready` (base + Redis).

## 5. Écrans à livrer

**Web — site public** (`docs/design/Main.dc.html`) : reproduction fidèle (navigation, hero bleu, filières, 3 promesses, bento, suivi à distance, pour qui, tarifs avec bascule mensuel/annuel branchée sur `/plans`, normes, CTA « Être rappelé » branché sur `/leads`, pied de page) + page publique `/verifier` (vérification de certificat QR).
**Web — admin** (`Admin.dc.html`) : connexion OTP ; barre de titre en dégradé, barre latérale en tuiles ; Tableau de bord (données `/organisations/:id/dashboard`) ; Exploitations (liste + fiche) ; Rappels ; Alertes ; Campagnes et Surveillance (écrans « V2 » avec données de couverture) ; Studio ; Abonnements ; Exports et imports ; Utilisateurs.
**Web — studio** (`Studio.dc.html`) : catalogue des packs, éditeur de protocole (frise simulée, tableau des étapes), diff, circuit de validation quatre yeux, aperçu du formulaire, vecteurs de test.
**Mobile** (`Mobile*.dc.html` + `02` E01–E04, E10–E14, E20–E23, E25–E27, E30, E44, E50, E65, E70, E72, E16) : onboarding, Accueil, Cheptel, formulaires adaptatifs (moteur de formulaires), Journal du jour, Santé et rappels, Fiche chien + QR, Ventes/dépenses/stocks, Ferme en direct, Alerte critique, Généalogie, Abonnement (mobile money), Mes données, état de synchronisation.

## 6. Qualité attendue
- Tests : vecteurs communs (`packages/params/vectors`) passés côté API **et** côté mobile ; tests e2e API (Jest + Supertest) sur le parcours pilote : OTP → ferme → lot → acte → rappels → confirmation SMS → abonnement → synchronisation.
- Sécurité : validation stricte (class-validator), Helmet, CORS limité, limitation de débit, secrets par variables d'environnement, aucun secret dans le dépôt.
- Accessibilité web : contrastes AA, focus visibles, libellés, `prefers-reduced-motion`.
