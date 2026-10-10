#!/usr/bin/env bash
# Shared helpers for the server-side scripts. Sourced, not executed.

APP_DIR="${APP_DIR:-/opt/resget}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.prod.yml}"
RELEASE_DIR="${APP_DIR}/releases"
LOGFILE="${LOGFILE:-${APP_DIR}/deploy.log}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOGFILE}" >&2
}

load_env() {
  if [ -f "${APP_DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "${APP_DIR}/.env"
    set +a
  fi
  : "${IMAGE_REPO:?IMAGE_REPO must be set in ${APP_DIR}/.env}"
}

compose() {
  docker compose --project-directory "${APP_DIR}" -f "${COMPOSE_FILE}" "$@"
}

is_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

# Set the image references for a release. With digests the pull is pinned to
# the exact images the release workflow published (<repo>/api:<tag>@sha256:...,
# the digest wins and the tag stays readable). Without them (nightly, manual
# runs, rollback to a release deployed before digests existed) the mutable tag
# is used. Digests recorded by a successful deploy are reused for that tag.
# Usage: use_release <tag> [<api-digest> <web-digest>]
use_release() {
  local tag="$1" api_digest="${2:-}" web_digest="${3:-}"
  if [ -z "${api_digest}${web_digest}" ] && [ -f "${RELEASE_DIR}/digests/${tag}" ]; then
    read -r api_digest web_digest < "${RELEASE_DIR}/digests/${tag}" || true
  fi
  if [ -n "${api_digest}${web_digest}" ] && ! { is_digest "${api_digest}" && is_digest "${web_digest}"; }; then
    log "Invalid image digests for ${tag}: both api and web must be sha256:<64 hex>"
    return 2
  fi
  export RELEASE_TAG="${tag}"
  export API_IMAGE="${IMAGE_REPO}/api:${tag}${api_digest:+@${api_digest}}"
  export WEB_IMAGE="${IMAGE_REPO}/web:${tag}${web_digest:+@${web_digest}}"
  export RELEASE_API_DIGEST="${api_digest}" RELEASE_WEB_DIGEST="${web_digest}"
}

current_release() {
  cat "${RELEASE_DIR}/current" 2>/dev/null || true
}
