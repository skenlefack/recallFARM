#!/bin/sh
# Sauvegarde quotidienne de la base (profil docker compose "backup").
# Format custom (pg_restore), rétention BACKUP_RETENTION_DAYS jours. Procédure de restauration : docs/DEPLOIEMENT.md §6.
set -eu
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
while true; do
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  FILE="/backups/recallfarm-${STAMP}.dump"
  echo "[backup] ${STAMP} -> ${FILE}"
  if pg_dump -Fc -Z 6 -f "${FILE}.part"; then
    mv "${FILE}.part" "${FILE}"
    sha256sum "${FILE}" > "${FILE}.sha256"
    find /backups -name 'recallfarm-*.dump*' -mtime "+${RETENTION}" -delete
  else
    echo "[backup] ÉCHEC" >&2
    rm -f "${FILE}.part"
  fi
  sleep 86400
done
