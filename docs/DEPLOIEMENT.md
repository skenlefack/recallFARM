# Déploiement conteneurisé de RecallFarm

Référence : dossier v2.2, `15-exploitation-dimensionnement.md` (environnements, hébergement par pays, sauvegardes, procédures RB-01 à RB-09).
Ce guide couvre le **MVP et le pilote de Yaoundé** : une seule machine virtuelle, Docker Compose, données hébergées dans le pays (décision D-01).

## 1. Architecture d'exécution

```
                Internet (HTTPS 443)
                       │
             ┌─────────▼─────────┐   terminateur TLS (Caddy ou nginx + certbot, §4)
             │   gateway (nginx)  │   :8080 → /v1 → api:3000, / → web:8080
             └───────┬─────┬─────┘
          frontend   │     │
             ┌───────▼┐  ┌─▼────────┐
             │  web   │  │   api    │  NestJS : REST /v1, ordonnanceur des rappels,
             │ nginx  │  │ (Node 22)│  adaptateurs SMS / WhatsApp / mobile money
             └────────┘  └─┬──────┬─┘
                 backend   │      │   (réseau interne, non exposé)
                    ┌──────▼─┐  ┌─▼─────┐
                    │postgres│  │ redis │
                    │PostGIS │  │  AOF  │
                    └────────┘  └───────┘
```

| Service | Image | Rôle | Données persistantes |
|---|---|---|---|
| `gateway` | nginx:1.27-alpine | point d'entrée unique, limitation de débit, en-têtes de sécurité | — |
| `web` | `recallfarm/web` | site public, administration, studio (SPA + PWA) | — |
| `api` | `recallfarm/api` | API, migrations au démarrage, ordonnanceur | volume `apikeys` (clés Ed25519), `exports` |
| `postgres` | postgis/postgis:16-3.4 | base principale | volume `pgdata` |
| `redis` | redis:7-alpine | verrous de l'ordonnanceur, débit | volume `redisdata` |
| `iot-simulator` *(profil demo)* | `recallfarm/api` | mesures de capteurs simulées | — |
| `backup` *(profil backup)* | postgis/postgis:16-3.4 | `pg_dump` quotidien, rétention | dossier `BACKUP_DIR` |

## 2. Dimensionnement du pilote
300 utilisateurs, ~50 000 rappels par an : **2 vCPU, 4 Go de RAM, 40 Go SSD** suffisent largement (pic mesuré < 5 % CPU).
Prévoir 8 Go de RAM au-delà de 5 000 utilisateurs, puis séparer la base (dossier `15` §2).

## 3. Première installation
```bash
# Ubuntu 24.04, Docker Engine ≥ 24 et le plugin compose
git clone <dépôt> recallfarm && cd recallfarm
make env          # crée .env avec des secrets aléatoires
nano .env         # CORS_ORIGINS, SEED_ON_START=false et OTP_DEV_ECHO=false en production, fournisseurs SMS/paiement
make up           # construit et démarre ; l'API applique les migrations puis démarre
make ps           # tous les services doivent être "healthy"
curl -s http://localhost:8080/v1/health
```
Démonstration : laisser `SEED_ON_START=true`, puis se connecter sur `http://<hôte>:8080/admin` avec `+237690000002`
(le code s'affiche, `OTP_DEV_ECHO=true`). `make demo` lance en plus le simulateur de capteurs.

## 4. HTTPS
Le plus simple : **Caddy** devant la passerelle (certificats Let's Encrypt automatiques).
```
# /etc/caddy/Caddyfile
pilote.recallfarm.app {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
```
Puis `HTTP_PORT=8080` lié à 127.0.0.1 uniquement (pare-feu : 22, 80, 443 ouverts ; rien d'autre).

## 5. Mise à jour (RB-03 du dossier)
```bash
git pull && docker compose build && docker compose up -d   # migrations appliquées au démarrage de l'API
docker compose logs -f api                                  # vérifier "migrations applied" puis "listening"
```
Retour arrière : `TAG=<version précédente> docker compose up -d` (les migrations sont additives au MVP ;
une migration destructive impose une sauvegarde préalable, §6).
Avec la CI : les images sont publiées sur `ghcr.io/<organisation>/recallfarm-{api,web}:<sha>` ; définir
`REGISTRY=ghcr.io/<organisation>` et `TAG=<sha>` puis `docker compose pull && docker compose up -d`.

## 6. Sauvegardes et restauration (RB-05)
- `make backup` démarre le service `backup` : un `pg_dump -Fc` par jour dans `BACKUP_DIR`, empreinte SHA-256, rétention 14 jours.
- Copier `BACKUP_DIR` hors de la machine (rclone vers un stockage dans le pays) : objectif RPO 24 h au pilote, 1 h en V1 (WAL, dossier `15`).
- Sauvegarder aussi le volume `apikeys` (clés de signature) **une fois**, au coffre : sans elles, les certificats QR émis ne sont plus vérifiables.
- Restauration : `make restore FILE=backups/recallfarm-AAAAMMJJ....dump`. Tester la restauration chaque mois (RB-06).

## 7. Supervision minimale
- `docker compose ps` et la sonde `GET /v1/ready` (base + Redis) dans un moniteur externe (Uptime Kuma, healthchecks.io).
- Journaux JSON de l'API : `docker compose logs api` ; rotation par le pilote `json-file` de Docker (`max-size: 50m`, à régler dans `/etc/docker/daemon.json`).
- Indicateurs métier : journal des envois (`/admin/messages`), tableau de bord de l'organisation.

## 8. Brancher les vrais fournisseurs
| Variable | Valeur | Effet |
|---|---|---|
| `SMS_PROVIDER=http` + `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, `SMS_SENDER_ID` | agrégateur SMS (D-07) | envois réels des OTP et rappels |
| `PAYMENT_PROVIDER` | `simulator` aujourd'hui ; adaptateurs Orange Money / MTN MoMo prêts à compléter dans `apps/api/src/billing/providers` | paiement réel |
| `PAYMENT_WEBHOOK_SECRET` | secret HMAC fourni par l'agrégateur | vérification des webhooks |
Désactiver `OTP_DEV_ECHO` et `SEED_ON_START` avant toute ouverture au public.

## 9. Application mobile
L'APK est produit par la CI (job `mobile`, artefact `recallfarm-apk`) avec `API_BASE_URL` = URL publique `/v1`.
Distribution du pilote : lien direct ou Firebase App Distribution ; Google Play en V1.
