#!/bin/sh
# Migrations → optional seed (SEED_ON_START=true) → start.
set -e
echo "[entrypoint] running migrations"
node dist/scripts/migrate.js
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data"
  node dist/scripts/seed.js
fi
exec "$@"
