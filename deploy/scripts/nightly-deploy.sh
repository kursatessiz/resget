#!/usr/bin/env bash
# Pull-based alternative to the SSH deploy job: run from cron on the server.
# Deploys the image CI built for the latest commit on main, if it is newer
# than what is running. Nothing is built here. The image is pulled by tag:
# this path has no trusted digest source, so it relies on the release workflow
# publishing sha-<commit> from main only (docs/CICD_GUIDE.md, owner checklist).
#   0 3 * * * /opt/resget/scripts/nightly-deploy.sh >> /opt/resget/deploy.log 2>&1

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

: "${GIT_REMOTE:?GIT_REMOTE (https URL of the repository) must be set in .env}"
BRANCH="${DEPLOY_BRANCH:-main}"

SHA="$(git ls-remote "${GIT_REMOTE}" "refs/heads/${BRANCH}" | cut -f1)"
if [ -z "${SHA}" ]; then
  log "Could not resolve ${BRANCH} on ${GIT_REMOTE}"
  exit 1
fi

TAG="sha-${SHA}"
if [ "$(current_release)" = "${TAG}" ]; then
  log "Nightly: ${TAG} already live"
  exit 0
fi

# CI may still be building this commit; retry tomorrow rather than fail.
use_release "${TAG}"
if ! docker manifest inspect "${API_IMAGE}" >/dev/null 2>&1; then
  log "Nightly: image for ${TAG} not published yet"
  exit 0
fi

exec bash "${SCRIPT_DIR}/deploy.sh" "${TAG}"
