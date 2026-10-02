#!/usr/bin/env bash
# Switch api and web back to an earlier release tag.
# Usage: rollback.sh [tag]   (defaults to the release before the current one)
# Database migrations are forward-only and are not reverted; keep schema
# changes backwards compatible for one release (expand, then contract).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

TARGET="${1:-$(cat "${RELEASE_DIR}/previous" 2>/dev/null || true)}"
if [ -z "${TARGET}" ]; then
  log "Rollback aborted: no previous release recorded"
  exit 1
fi

log "Rolling back to ${TARGET}"
use_release "${TARGET}"
compose pull api web
compose up -d --no-deps --wait --wait-timeout 120 api web || true

if bash "${SCRIPT_DIR}/healthcheck.sh"; then
  echo "${TARGET}" > "${RELEASE_DIR}/current"
  log "Rollback to ${TARGET} is healthy"
else
  log "Rollback to ${TARGET} is NOT healthy; manual intervention required"
  exit 1
fi
