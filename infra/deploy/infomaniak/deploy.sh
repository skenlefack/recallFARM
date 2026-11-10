#!/usr/bin/env bash
# Deploiement de RecallFarm sur le serveur partage avec RecallVet (Infomaniak).
# Les images sont construites sur le poste (le serveur n'a qu'un processeur) puis transferees par SSH.
#
#   SSH_KEY=/c/dev/recallvet/key/recallVETServerKey infra/deploy/infomaniak/deploy.sh
#
# Variables : SERVER (ubuntu@179.237.97.57), SSH_KEY (obligatoire), REMOTE_DIR (/home/ubuntu/recallfarm),
#             DOMAIN (recallfarm.com), TAG (sha git court).
set -euo pipefail

SERVER="${SERVER:-ubuntu@179.237.97.57}"
SSH_KEY="${SSH_KEY:?SSH_KEY : chemin de la cle privee du serveur}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/recallfarm}"
DOMAIN="${DOMAIN:-recallfarm.com}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
ROOT="$(git rev-parse --show-toplevel)"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 "$SERVER")
COMPOSE="docker compose -f docker-compose.yml -f infra/deploy/infomaniak/docker-compose.infomaniak.yml"

cd "$ROOT"
if [ -n "$(git status --porcelain)" ]; then
  echo "Le depot contient des modifications non enregistrees : commit avant de deployer." >&2
  exit 1
fi

echo "==> 1/6 Construction des images (tag $TAG)"
TAG="$TAG" docker compose build api web

echo "==> 2/6 Transfert des images vers $SERVER"
docker save "recallfarm/api:$TAG" "recallfarm/web:$TAG" | gzip -1 | "${SSH[@]}" 'gunzip | docker load'

echo "==> 3/6 Envoi des fichiers de deploiement"
tar czf - --exclude='infra/providers/providers.json' docker-compose.yml .env.example infra \
  | "${SSH[@]}" "mkdir -p '$REMOTE_DIR' && tar xzf - -C '$REMOTE_DIR'"

echo "==> 4/6 Fichier .env du serveur (cree une seule fois, secrets aleatoires)"
"${SSH[@]}" "DOMAIN='$DOMAIN' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET INBOUND_SECRET; do
    sed -i "s|^$k=.*|$k=$(openssl rand -hex 24)|" .env
  done
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN|" .env
  sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://$DOMAIN|" .env
  sed -i "s|^PUBLIC_APP_URL=.*|PUBLIC_APP_URL=https://$DOMAIN|" .env
  printf 'PUBLIC_VERIFY_URL=https://%s/verifier\nBACKUP_DIR=/home/ubuntu/backups/recallfarm\n' "$DOMAIN" >> .env
  chmod 600 .env
  echo ".env cree"
else
  echo ".env existant conserve"
fi
mkdir -p /home/ubuntu/backups/recallfarm
REMOTE

echo "==> 5/6 Demarrage"
"${SSH[@]}" "cd '$REMOTE_DIR' && TAG='$TAG' $COMPOSE --profile backup up -d --no-build --remove-orphans"

echo "==> 6/6 Controle de sante"
for i in $(seq 1 36); do
  if "${SSH[@]}" "curl -fsS http://127.0.0.1:8090/v1/health" >/dev/null 2>&1; then
    "${SSH[@]}" "curl -fsS http://127.0.0.1:8090/v1/health; echo; cd '$REMOTE_DIR' && $COMPOSE ps --format '{{.Name}} {{.Status}}'"
    echo "RecallFarm $TAG deploye."
    exit 0
  fi
  sleep 5
done
echo "L'API ne repond pas apres 3 minutes. Journaux : ssh $SERVER 'cd $REMOTE_DIR && $COMPOSE logs --tail=80 api'" >&2
exit 1
