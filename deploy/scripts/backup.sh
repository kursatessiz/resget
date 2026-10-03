#!/usr/bin/env bash
# PostgreSQL dump with 14-day local rotation and an encrypted off-site copy.
#
# Off-site copy (enabled when BACKUP_S3_BUCKET is set in /opt/resget/.env):
#   the gzip dump is encrypted on this host (AES-256 with PBKDF2; the key
#   never leaves the server) and uploaded to any S3-compatible object storage
#   (AWS S3, Cloudflare R2, Backblaze B2, Wasabi, ...) with curl's built-in
#   SigV4 signing, so nothing extra is installed. Retention on the storage
#   side is a bucket lifecycle rule.
#
# A failed upload keeps the local file and exits non-zero, unless
# BACKUP_OFFSITE_REQUIRED=0 (deploy.sh sets it: the pre-deploy local dump is
# what a rollback needs, and a storage outage must not block a release).
#
# Runs daily from /etc/cron.d/resget-backup (installed by server-init.sh) and
# before every deploy. Restore steps: docs/CICD_GUIDE.md "Yedekler".

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

BACKUP_DIR="${APP_DIR}/backups"
STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
FILENAME="${BACKUP_DIR}/db_${STAMP}.sql.gz"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
umask 077

log "Starting database backup"
# shellcheck disable=SC2016 # expanded inside the container
if compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "${FILENAME}"; then
  chmod 600 "${FILENAME}"
  log "Backup written: ${FILENAME} ($(du -h "${FILENAME}" | cut -f1))"
else
  rm -f "${FILENAME}"
  log "Backup FAILED"
  exit 1
fi

find "${BACKUP_DIR}" -name 'db_*.sql.gz' -type f -mtime +14 -delete

if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  log "WARNING: BACKUP_S3_BUCKET is not set; the backup exists only on this server"
  exit 0
fi

: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY must be set when BACKUP_S3_BUCKET is set}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID must be set when BACKUP_S3_BUCKET is set}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY must be set when BACKUP_S3_BUCKET is set}"
REGION="${BACKUP_S3_REGION:-us-east-1}"
ENDPOINT="${BACKUP_S3_ENDPOINT:-https://s3.${REGION}.amazonaws.com}"
ENDPOINT="${ENDPOINT%/}"
PREFIX="${BACKUP_S3_PREFIX:-db}"
REQUIRED="${BACKUP_OFFSITE_REQUIRED:-1}"

ENCRYPTED="${FILENAME}.enc"
cleanup() { rm -f "${ENCRYPTED}" "${ENCRYPTED}.sha256"; }
trap cleanup EXIT

# The passphrase is read from the environment, never from the command line.
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "${FILENAME}" -out "${ENCRYPTED}"
sha256sum "${ENCRYPTED}" | cut -d' ' -f1 > "${ENCRYPTED}.sha256"

upload() {
  local file="$1" key="$2"
  # Credentials go through a config on stdin so they never appear in `ps`.
  printf 'user = "%s:%s"\n' "${BACKUP_S3_ACCESS_KEY_ID}" "${BACKUP_S3_SECRET_ACCESS_KEY}" |
    curl --config - --fail --silent --show-error --retry 3 --retry-delay 5 \
      --aws-sigv4 "aws:amz:${REGION}:s3" \
      -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
      --upload-file "${file}" \
      "${ENDPOINT}/${BACKUP_S3_BUCKET}/${key}"
}

REMOTE_KEY="${PREFIX}/db_${STAMP}.sql.gz.enc"
if upload "${ENCRYPTED}" "${REMOTE_KEY}" && upload "${ENCRYPTED}.sha256" "${REMOTE_KEY}.sha256"; then
  log "Off-site copy uploaded: ${BACKUP_S3_BUCKET}/${REMOTE_KEY}"
elif [ "${REQUIRED}" = "0" ]; then
  log "WARNING: off-site upload failed; the local backup ${FILENAME} is kept"
else
  log "Off-site upload FAILED; the local backup ${FILENAME} is kept"
  exit 1
fi
