#!/usr/bin/env bash
# Deploy a pre-built release tag. Never builds on the server.
# Usage: deploy.sh <tag>      e.g. deploy.sh sha-<commit>
#
# 1. back up the database
# 2. pull the new images (abort if missing, nothing has changed yet)
# 3. run migrations (abort on failure, old release keeps serving)
# 4. bootstrap platform defaults (idempotent: plans when missing; never
#    overwrites what the console changed; the first super admin is created
#    by hand, see docs/CICD_GUIDE.md)
# 5. start the new release and smoke test it (3 attempts)
# 6. on failure roll back to the release that was running before

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

TAG="${1:?usage: deploy.sh <tag>}"
if ! [[ "${TAG}" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  log "Invalid tag: ${TAG}"
  exit 2
fi

mkdir -p "${RELEASE_DIR}"
exec 9>"${RELEASE_DIR}/.lock"
if ! flock -n 9; then
  log "Another deployment is running; exiting"
  exit 1
fi

PREVIOUS="$(current_release)"
if [ "${PREVIOUS}" = "${TAG}" ]; then
  log "Release ${TAG} is already live"
  exit 0
fi

log "Deploying ${TAG} (previous: ${PREVIOUS:-none})"

if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  # The local dump is what a rollback needs; a storage outage must not block the release.
  BACKUP_OFFSITE_REQUIRED=0 bash "${SCRIPT_DIR}/backup.sh"
fi

use_release "${TAG}"
compose pull api web

# Wait for the healthchecks: on an empty volume Postgres needs a few seconds
# to initialise and the migration below would otherwise race it.
compose up -d --wait --wait-timeout 120 postgres redis
compose run --rm --no-deps api \
  sh -c 'cd node_modules/@resget/database && ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'
# Defaults only: BOOTSTRAP_CURRENCY (and optionally BOOTSTRAP_PRO_PRICE_MINOR) come from /opt/resget/.env.
compose run --rm --no-deps \
  -e "BOOTSTRAP_CURRENCY=${BOOTSTRAP_CURRENCY:-}" \
  -e "BOOTSTRAP_PRO_PRICE_MINOR=${BOOTSTRAP_PRO_PRICE_MINOR:-0}" \
  api node dist/cli/bootstrap.js --defaults-only

# Wait for container healthchecks; the smoke test below makes the decision.
compose up -d --remove-orphans --wait --wait-timeout 120 || true

if bash "${SCRIPT_DIR}/healthcheck.sh"; then
  [ -n "${PREVIOUS}" ] && echo "${PREVIOUS}" > "${RELEASE_DIR}/previous"
  echo "${TAG}" > "${RELEASE_DIR}/current"
  echo "$(date -u +%FT%TZ) ${TAG}" >> "${RELEASE_DIR}/history"
  docker image prune -f --filter "until=168h" >/dev/null || true
  log "Release ${TAG} is live"
  exit 0
fi

log "Smoke test failed for ${TAG}"
if [ -n "${PREVIOUS}" ]; then
  echo "${PREVIOUS}" > "${RELEASE_DIR}/previous"
  bash "${SCRIPT_DIR}/rollback.sh" "${PREVIOUS}" || true
else
  log "No previous release to roll back to"
fi
exit 1
