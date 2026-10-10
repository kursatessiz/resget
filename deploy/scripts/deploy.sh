#!/usr/bin/env bash
# Deploy a pre-built release tag. Never builds on the server.
# Usage: deploy.sh <tag> [<api-digest> <web-digest>]
#   e.g. deploy.sh sha-<commit> sha256:<64 hex> sha256:<64 hex>
# With digests (the release workflow always passes them) the images are pulled
# by digest, so a moved tag cannot change what runs. Without them (nightly,
# manual runs) the tag is pulled; the digests of a successful deploy are
# recorded under releases/digests/<tag> and reused by a later rollback.
#
# 1. validate the Caddyfile (abort if invalid, nothing has changed yet)
# 2. back up the database
# 3. pull the new images (abort if missing, nothing has changed yet)
# 4. run migrations (abort on failure, old release keeps serving)
# 5. bootstrap platform defaults (idempotent: plans when missing; never
#    overwrites what the console changed; the first super admin is created
#    by hand, see docs/CICD_GUIDE.md)
# 6. start the new release and smoke test it (3 attempts), then reload Caddy
# 7. on failure roll back to the release that was running before

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

TAG="${1:?usage: deploy.sh <tag> [<api-digest> <web-digest>]}"
if ! [[ "${TAG}" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  log "Invalid tag: ${TAG}"
  exit 2
fi
if [ "$#" -ne 1 ] && [ "$#" -ne 3 ]; then
  log "Digests are given as a pair: <api-digest> <web-digest>"
  exit 2
fi
API_DIGEST="${2:-}"
WEB_DIGEST="${3:-}"

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

# The Caddyfile is bind-mounted, so `up` never applies a changed one by itself: it is validated here, before
# anything changes, and reloaded once the release is live. A running Caddy keeps its config if reload fails.
compose run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  # The local dump is what a rollback needs; a storage outage must not block the release.
  BACKUP_OFFSITE_REQUIRED=0 bash "${SCRIPT_DIR}/backup.sh"
fi

use_release "${TAG}" "${API_DIGEST}" "${WEB_DIGEST}"
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
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ||
    log "Caddy reload failed; the previous proxy config keeps serving"
  [ -n "${PREVIOUS}" ] && echo "${PREVIOUS}" > "${RELEASE_DIR}/previous"
  echo "${TAG}" > "${RELEASE_DIR}/current"
  if [ -n "${API_DIGEST}" ]; then
    mkdir -p "${RELEASE_DIR}/digests"
    echo "${API_DIGEST} ${WEB_DIGEST}" > "${RELEASE_DIR}/digests/${TAG}"
  fi
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
