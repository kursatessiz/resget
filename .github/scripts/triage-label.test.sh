#!/usr/bin/env bash
# Self-test for triage-label.sh with a stub gh. Run: bash .github/scripts/triage-label.test.sh

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir "${WORK}/bin"
cat > "${WORK}/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [ "$1 $2" = "label list" ]; then
  printf '%s\n' bug enhancement duplicate "area:api" "priority:high" security
  exit 0
fi
printf '%s\n' "$*" >> "${GH_CALLS}"
STUB
chmod +x "${WORK}/bin/gh"

export PATH="${WORK}/bin:${PATH}"
export GH_CALLS="${WORK}/calls"
export GITHUB_REPOSITORY=owner/repo
export TRIAGE_ISSUE_NUMBER=42
export TRIAGE_LABELS_FILE="${HERE}/../triage-labels.txt"

fail=0
check() {
  local name="$1" expected="$2" actual
  actual="$(cat "${GH_CALLS}" 2>/dev/null || true)"
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL ${name}: expected [${expected}] got [${actual}]" >&2
    fail=1
  fi
  : > "${GH_CALLS}"
}
: > "${GH_CALLS}"

bash "${HERE}/triage-label.sh" bug "area:api" > /dev/null
check "adds allowed existing labels" "issue edit 42 --repo owner/repo --add-label bug --add-label area:api"

bash "${HERE}/triage-label.sh" duplicate nonexistent --title x > /dev/null 2>&1
check "skips disallowed, unknown and option-like names" ""

bash "${HERE}/triage-label.sh" bug bug enhancement security "priority:high" > /dev/null 2>&1
check "dedupes and caps at three" "issue edit 42 --repo owner/repo --add-label bug --add-label enhancement --add-label security"

if TRIAGE_ISSUE_NUMBER="7 --body-file /etc/passwd" bash "${HERE}/triage-label.sh" bug > /dev/null 2>&1; then
  echo "FAIL issue number from environment is validated" >&2
  fail=1
fi
check "no call on invalid issue number" ""

if bash "${HERE}/triage-label.sh" > /dev/null 2>&1; then
  echo "FAIL no arguments must fail" >&2
  fail=1
fi

[ "${fail}" -eq 0 ] && echo "triage-label self-test passed"
exit "${fail}"
