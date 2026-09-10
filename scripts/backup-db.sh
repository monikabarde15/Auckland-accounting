#!/usr/bin/env bash
# ==============================================================================
# ACULA (Auckland Accounting Services Ltd) — Automated Database Backup Script
# Authoritative Spec: Acula-new.pdf (§44)
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/acula}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/acula_db_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting ACULA PostgreSQL database backup..."

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[ERROR] DATABASE_URL environment variable is not set."
    exit 1
fi

# Run pg_dump and compress with gzip
pg_dump "${DATABASE_URL}" --no-owner --no-privileges --clean --if-exists | gzip > "${BACKUP_FILE}"

# Verify backup file size is greater than 0
if [ -s "${BACKUP_FILE}" ]; then
    FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo "[$(date)] Backup completed successfully: ${BACKUP_FILE} (${FILE_SIZE})"
else
    echo "[ERROR] Backup failed or generated empty archive."
    rm -f "${BACKUP_FILE}"
    exit 1
fi

# Retention policy: Prune archives older than RETENTION_DAYS
echo "[$(date)] Pruning backup archives older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "acula_db_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] ACULA backup cycle finished successfully."
