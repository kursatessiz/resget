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

use_release() {
  export RELEASE_TAG="$1"
  export API_IMAGE="${IMAGE_REPO}/api:${RELEASE_TAG}"
  export WEB_IMAGE="${IMAGE_REPO}/web:${RELEASE_TAG}"
}

current_release() {
  cat "${RELEASE_DIR}/current" 2>/dev/null || true
}
