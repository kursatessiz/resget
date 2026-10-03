#!/usr/bin/env bash
# Post-deploy smoke test. Probes run inside the containers, so no ports need
# to be published on the host. The API endpoint returns 200 only when both
# PostgreSQL and Redis respond.
# Exit 0 when healthy within MAX_ATTEMPTS, 1 otherwise.
# Also safe to run by hand: bash /opt/resget/scripts/healthcheck.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
# compose needs IMAGE_REPO and the other .env values to parse the file.
load_env

MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
RETRY_DELAY="${RETRY_DELAY:-10}"

probe() {
  compose exec -T api wget -q -O - http://127.0.0.1:4000/health >/dev/null \
    && compose exec -T web wget -q --spider http://127.0.0.1:3000/
}

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  if probe; then
    log "Smoke test passed (attempt ${attempt}/${MAX_ATTEMPTS})"
    exit 0
  fi
  log "Smoke test failed (attempt ${attempt}/${MAX_ATTEMPTS})"
  [ "${attempt}" -lt "${MAX_ATTEMPTS}" ] && sleep "${RETRY_DELAY}"
done

compose exec -T api wget -q -O - http://127.0.0.1:4000/health 2>&1 | head -c 500 >&2 || true
exit 1
