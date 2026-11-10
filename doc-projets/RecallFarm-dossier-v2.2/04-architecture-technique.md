# 04 — Architecture technique (v2.2)

> Version 2.2 — 27/10/2026. Ajouts v2.2 : moteurs de paramétrage (§14), suivi à distance (§15), analytique et exports (§16), hébergement par pays (§17). L'infrastructure, la CI/CD et l'exploitation sont détaillées dans `15`, les méthodes dans `16`. Cette version réconcilie l'API unique décrite dans la v2.0, l'orientation microservices des dossiers filières et le `camera-service` de l'addendum.

## 1. Principes directeurs
- **Hors ligne d'abord** : l'application mobile est pleinement fonctionnelle sans réseau ; la synchronisation est un mécanisme d'arrière-plan, pas un prérequis.
- **Léger** : APK de petite taille, faible consommation de données, fonctionnement en 2G/EDGE et sur des appareils d'entrée de gamme.
- **Multicanal** : au-delà de l'app, atteindre l'utilisateur par SMS/USSD, WhatsApp et vocal.
- **Multi-tenant** : individuel ↔ organisation (Structure), avec rôles et portée par agent.
- **Démarrer simple, découper ensuite** : un **monolithe modulaire** au MVP et en V1, dont les modules correspondent un à un aux futurs services. Le découpage en services n'a lieu que lorsqu'une contrainte le justifie (charge, cycle de déploiement, technologie spécifique).

## 2. Pile retenue

| Couche | Choix recommandé | Alternative acceptable |
|---|---|---|
| Mobile | **Flutter** (Dart), Android d'abord, iOS ensuite ; **Drift (SQLite) + SQLCipher** ; stockage local des photos | React Native + WatermelonDB |
| Backend | **NestJS** (TypeScript), modules par domaine | Django REST (Python) |
| Base | **PostgreSQL 15+** + **PostGIS** ; schémas `app` (données individuelles) et `surveillance` (agrégats) | — |
| Cache, files | **Redis** (sessions, throttling, files BullMQ) | RabbitMQ (si découpage en services) |
| Web organisations | **PWA React** (tableaux de bord, carte, membres, facturation), installable | — |
| Médias | Object storage compatible S3 ; images redimensionnées à l'envoi | — |
| Push | Firebase Cloud Messaging | — |
| Vidéo (V2) | Serveur média **WebRTC/RTSP** (ex. MediaMTX ou équivalent) + transcodage basse résolution | Service cloud vidéo managé |
| Observabilité | Logs centralisés, Sentry, métriques d'usage anonymisées | — |

## 3. Découpage par domaine

Chaque module NestJS possède ses tables et expose ses cas d'usage. Les traitements transverses passent par des **événements de domaine** (bus interne au MVP, puis bus de messages en cas de découpage).

| Module (futur service) | Responsabilité | Tables principales (`03`) | Événements émis |
|---|---|---|---|
| api-gateway | routage, authentification, rate limiting | — | — |
| auth | comptes, OTP, rôles, portée, PIN | users, memberships | user.verified |
| privacy | consentements, export, suppression | consents, account_requests | consent.changed, account.deletion_scheduled |
| farm | exploitations, organisations, logements | farms, organisations, housing_units | — |
| livestock | lots, animaux, chiens, mouvements, pesées, journal | batches, animals, dogs, animal_movements, weighings, daily_logs | mortality.abnormal, movement.recorded |
| health | actes, protocoles, rappels, tâches, check-lists, signalements | health_events, vaccination_protocols, reminders, tasks, checklist_runs, disease_signals | reminder.due, reminder.missed, disease_signal.sent |
| breeding | reproduction, portées, généalogie, consanguinité | reproduction_events, litters, mating_checks | litter.born, mating.risky |
| stock | intrants, seuils, péremption | stock_movements, stock_thresholds | stock.low, stock.expiring |
| sales-finance | ventes, dépenses, trésorerie, KPIs | products_sales, expenses | sale.created |
| projection | moteur de projection (bibliothèque partagée mobile/serveur) | projection_scenarios, ref_projection_defaults | — |
| dressage-billing | clients, programmes, séances, pension, factures, paiements | clients, training_*, boarding_stays, invoices, invoice_lines, payments | invoice.issued |
| k9 | unités, affectations | k9_units, k9_assignments | — |
| marketplace | annuaire, demandes de service | providers, service_requests, provider_reviews | service_request.created |
| subscription | formules, droits, paiement mobile money | subscriptions, ref_plan_* | payment.confirmed, subscription.expired |
| notification | abstraction push/SMS/WhatsApp/vocal, préférences, plafonnement, journal | notification_preferences, outbound_messages | message.delivered |
| surveillance | agrégats anonymisés, campagnes, export | campaigns, schéma `surveillance` | campaign.progress |
| content | fiches, audio | media_contents | — |
| sync-gateway | push/pull, conflits, curseurs | (toutes, via les modules) | — |
| **camera-service** (V2) | association, statut, sessions de flux, détection de mouvement, clips | cameras, camera_events, camera_access | camera.motion, camera.offline |
| params *(v2.2)* | packs, versions, revue, tests, publication, résolution, studio | param_* , farm_settings | params.published, params.rolled_back |
| alerts *(v2.2)* | moteur d'alertes, astreinte, escalade (journal, capteurs, caméras, stocks) | alert_rules, alert_events, alert_notifications, oncall_schedules | alert.opened, alert.escalated, alert.resolved |
| **iot-ingest** *(v2.2, V3, service séparé)* | courtier MQTT, validation, dédoublonnage, écriture des séries, provisionnement des passerelles, commandes | gateways, devices, telemetry, device_commands | telemetry.received, device.offline |
| interop *(v2.2)* | exports (ICAR ADE, DHIS2, ARIS, GARC, EMA-i+, EPCIS, registres), imports en masse, API publique OAuth 2.0 | export_jobs, import_jobs | export.ready |
| analytics *(v2.2)* | collecte des événements d'usage, alimentation de l'entrepôt, tableaux de pilotage, feature flags | feature_flags (+ entrepôt) | — |

**Premier service séparé** : le `camera-service`. Il est déployé à part dès la V2, car son profil de charge (flux vidéo) et ses dépendances (serveur média) sont différents. Ses alertes passent par le module `notification`.

## 4. Synchronisation hors ligne

Modèle **delta sync par entité**, avec un endpoint unique (`05` §20) :
1. Chaque entité porte `sync_version` (serveur) et `client_rev` (local). Le client garde un curseur `last_sync_version` par groupe d'entités.
2. **Push** : le client envoie ses écritures en attente (upserts et suppressions logiques) par lots idempotents (clé `id` + `client_rev`), triés parents d'abord.
3. **Pull** : `GET /sync/pull?since=` renvoie les entités modifiées au-delà du curseur, référentiels compris.
4. **Conflits** : fusion **au niveau du champ** (la dernière écriture gagne pour chaque champ, selon `updated_at` client), journalisée dans `audit_log` (`conflict_merge`). Cas particuliers :
   - `daily_logs` : unicité (sujet, date) → fusion champ par champ dans l'enregistrement existant ;
   - `invoices.number` : attribué uniquement au serveur ;
   - `reminders.status` : un `confirme` l'emporte toujours sur un `manque` ou un `envoye`.
5. **Agrégats dérivés** (`current_count`, stocks, taux, montants dérivés, coefficient de consanguinité, résultats de projection) : jamais acceptés en push, toujours recalculés à partir des événements.
6. **Files locales** : réessais avec délai croissant, aucune perte de saisie, indicateur « en attente ».
7. **Rappels** : planifiés **localement** (notifications) dès l'enregistrement, indépendamment du réseau. Les envois **SMS/WhatsApp** partent du serveur : une tâche planifiée examine les `reminders` dus (J-7, J-1, J, J+3) et applique RG-NOT-01/02. Hors ligne, le téléphone reste la source des notifications locales ; le serveur n'envoie un SMS que pour les rappels synchronisés.
8. **Droits (feature gating)** : `entitlements` signés par le serveur (JWS), mis en cache avec `expires_at` et `grace_until`, et vérifiés localement. Une horloge locale manipulée est détectée par comparaison avec la dernière heure serveur connue.

## 5. Calculs embarqués (bibliothèques partagées)
- **Moteur de projection** : bibliothèque Dart pure (fonctions sans effet de bord) qui reproduit les classeurs `*-modele-projection.xlsx`, portée ou générée en TypeScript pour le serveur et la PWA. Les tests dorés communs (`11` T-30) garantissent l'égalité des résultats.
- **Consanguinité** : calcul du coefficient de parenté par la méthode tabulaire ou par les chemins de Wright, avec mémoïsation sur le pedigree local. Profondeur de 5 générations par défaut ; complexité bornée (≤ 2⁵ ancêtres par côté). Exécuté sur le mobile (hors ligne) et recalculé au serveur.
- **Protocoles et rappels** : calcul de `next_due` et des occurrences sur le mobile, revalidé au serveur.

## 6. Canaux légers (feature phones et bas débit)
- **SMS / USSD** : intégration d'un agrégateur régional pour les rappels sortants, les réponses SMS de confirmation (code court) et des menus USSD courts (rappels du jour, confirmer, déclarer une mortalité).
- **WhatsApp** : WhatsApp Business API, avec modèles de messages approuvés par langue, boutons « Fait » et « Reporter », et envoi des certificats en PDF.
- **Vocal (IVR) — V2** : serveur vocal en langues locales ; la touche 1 confirme un rappel.
- **Module `notification`** : unifie les canaux ; le choix dépend de la formule, du consentement, des préférences et de la disponibilité ; chaque envoi est journalisé (`outbound_messages`).

## 7. Paiement mobile money
- Un **agrégateur** couvre Orange Money, MTN MoMo, Moov, Wave, Free Money, Airtel Money, M-Pesa et MVola selon les pays. Au MVP : un seul agrégateur pour le pays pilote ; en V1 : multi-pays.
- Flux : initiation (push USSD au payeur) → webhook de confirmation signé → activation ou renouvellement de l'abonnement, ou facture marquée payée. Le mobile interroge le statut tant que le webhook n'est pas reçu.
- Le même flux sert aux **abonnements** et à l'**encaissement des factures** des dresseurs et pensions (`payments.purpose`).
- Frais paramétrables (`payments.fees_minor`) ; rapprochement quotidien avec les relevés de l'agrégateur.

## 8. Caméras (V2)
- Caméras IP standard (Wi-Fi ou 4G) avec RTSP ou ONVIF. Association par code QR : la caméra établit une connexion **sortante** vers le serveur média, ce qui évite d'ouvrir des ports sur le réseau de la ferme.
- Le serveur média relaie le flux en **WebRTC** (ou HLS en repli) vers le mobile, après transcodage en **basse résolution par défaut**. Les sessions de flux sont accordées par des jetons courts (5 min), émis après contrôle de `camera_access`.
- La détection de mouvement se fait dans la caméra si elle le permet (événement ONVIF), sinon par analyse légère côté serveur. Chaque détection produit un clip de 20 s stocké en object storage, purgé selon RG-CAM-02, et une notification push.
- Aucune vidéo n'est stockée sur le téléphone ni synchronisée ; aucun flux n'est partagé avec des tiers.

## 9. Sécurité (détail dans `08`)
- Authentification par OTP, **JWT** court (15 min) et refresh (30 jours, rotation) ; jeton stocké dans Keystore/Keychain.
- TLS 1.2+ ; base locale chiffrée (SQLCipher, clé dérivée et stockée dans Keystore) ; sauvegardes chiffrées.
- Autorisation par rôle et par portée ; contrôle de formule au serveur ; audit des écritures.
- Cloison physique entre `app` et `surveillance` ; seules des vues agrégées filtrées par consentement alimentent `surveillance`.

## 10. Internationalisation
Libellés externalisés (ARB/i18n) ; référentiels traduisibles ; formats de date, nombre et **monnaie** localisés selon `ref_currencies` ; ajout de langues locales (au moins pour le vocal et les SMS).

## 11. Environnements et livraison
- Environnements `dev`, `staging`, `prod` ; migrations de schéma versionnées et réversibles.
- CI/CD : APK/AAB signé, tests automatisés (unitaires, intégration, hors ligne, tests dorés de projection), déploiement backend conteneurisé.
- **Seed** : référentiels (`ref_*`, protocoles par pays, check-lists, calendriers de tâches, paramètres de projection, fonctions des formules) chargés au provisioning et versionnés.
- **Sauvegardes** : base et object storage ; restauration testée chaque trimestre.

## 12. Cartographie et surveillance (V2)
PostGIS et tuiles cartographiques ; agrégation par zone administrative ; **carte de couverture** (dont antirabique) avec masquage des cellules de moins de 5 exploitations ; export au format attendu par les réseaux nationaux (schéma à définir avec le référent).

## 13. Contraintes de performance
Cibles mesurables dans `08` §2 : démarrage à froid < 3 s, interactions locales < 100 ms, consommation de données < 5 Mo par mois hors médias et vidéo, synchronisation en arrière-plan, images en basse résolution par défaut, pagination des listes.


## 14. Moteurs de paramétrage *(v2.2 — voir `12`)*
- **Bibliothèques jumelles** `engines-ts` et `engines-dart` : résolution des packs, évaluateur d'expressions (CEL, décision D-02), moteur de formulaires (validation), moteur de rappels, moteur d'indicateurs et de projection, calcul de consanguinité.
- **Vérité commune** : `packages/test-vectors`, des milliers de cas d'entrée et de sortie attendue exécutés dans les deux langages à chaque demande de fusion. Toute divergence bloque la fusion.
- **Côté serveur** : le module `params` publie les packs ; les autres modules lisent l'objet résolu en mémoire (cache Redis, invalidé à la publication). Il n'y a jamais d'interprétation de pack dans une requête SQL.
- **Côté mobile** : les packs sont stockés dans la base locale. L'objet résolu est mis en cache par exploitation et recalculé à chaque nouvelle version de pack reçue. Le budget est de 10 ms par évaluation d'expression.
- **Validation serveur** des `attributes` par JSON Schema (bibliothèque Ajv), avec le schéma généré à partir du formulaire résolu de la version `param_version` envoyée par le client.

## 15. Suivi à distance *(v2.2 — voir `13`)*
- `iot-ingest` est un **service séparé dès sa création**, en raison de son volume et de son profil temps réel. Il comprend :
  - un courtier MQTT en grappe, avec authentification mTLS par passerelle ;
  - des consommateurs qui écrivent dans **TimescaleDB** (base distincte de la base métier) ;
  - un flux d'événements (Redis Streams, puis NATS ou Kafka au-delà de 5 millions de mesures par jour) vers le module `alerts`.
- Le module `alerts` évalue les règles serveur à fenêtre glissante (avec état en Redis), gère l'escalade par minuterie, et notifie par le module `notification`.
- Les règles `edge` sont compilées et signées par le serveur, puis envoyées aux passerelles (`device_commands`). La passerelle embarque un évaluateur d'expressions léger et une file locale.
- Le `camera-service` publie ses événements dans le même flux : les alertes vidéo suivent le même cycle.

## 16. Analytique, exports et API publique *(v2.2)*
- **Entrepôt analytique** : capture des changements de la base métier (Debezium ou réplication logique) et des événements d'usage, vers un entrepôt colonnes (ClickHouse ou équivalent). Les tableaux de pilotage (`17` §6) et les agrégats de surveillance lisent l'entrepôt, jamais la base transactionnelle.
- **Exports** : tâches asynchrones (BullMQ). Chaque exporteur applique une correspondance `export_mapping` versionnée ; fichiers signés (empreinte sha256) en stockage objet ; envoi par connecteur (API web DHIS2, dépôt sécurisé).
- **API publique** : servie par la même passerelle d'API, avec un serveur d'autorisation OAuth 2.0 / OIDC (Keycloak ou service géré), des portées par ressource, des quotas par client et une documentation OpenAPI publiée.

## 17. Hébergement par pays *(v2.2 — voir `15` §4)*
- Chaque région de production (`prod-<pays ou région>`) contient l'ensemble des services et **ses** données personnelles. Le déploiement est identique partout, grâce à l'infrastructure décrite en code.
- Un **plan de contrôle central** (hors données personnelles) distribue :
  - les packs de paramètres ;
  - les versions de l'application ;
  - les feature flags ;
  - les agrégats anonymisés autorisés pour les tableaux multi-pays.
- Un utilisateur appartient à une région, déterminée par le pays de sa première exploitation. Une exploitation dans un autre pays relève de la région de ce pays, après consentement explicite de transfert si la loi l'exige.
