#!/usr/bin/env bash
# ==============================================================================
# ACULA (Auckland Accounting Services Ltd) — Database Restore Utility
# Authoritative Spec: Acula-new.pdf (§44)
# ==============================================================================

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-backup-file.sql.gz>"
    echo "Example: $0 /var/backups/acula/acula_db_backup_20260909_120000.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "[ERROR] Backup archive '${BACKUP_FILE}' does not exist."
    exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[ERROR] DATABASE_URL environment variable is not set."
    exit 1
fi

echo "=============================================================================="
echo "WARNING: You are about to restore the ACULA database from:"
echo "Archive: ${BACKUP_FILE}"
echo "Target DB: ${DATABASE_URL}"
echo "=============================================================================="

read -p "Type 'RESTORE' to confirm and proceed: " CONFIRMATION

if [ "${CONFIRMATION}" != "RESTORE" ]; then
    echo "[ABORTED] Restore cancelled by operator."
    exit 0
fi

echo "[$(date)] Decompressing and restoring database..."
gunzip -c "${BACKUP_FILE}" | psql "${DATABASE_URL}"

echo "[$(date)] ACULA Database restore completed successfully."
