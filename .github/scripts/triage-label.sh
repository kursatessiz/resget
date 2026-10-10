#!/usr/bin/env bash
# Add labels to the issue that triggered the workflow. The only write path of
# the issue triage agent (claude-triage.yml).
# Usage: triage-label.sh <label> [<label> ...]
#
# The agent controls only the label names. The target repository and issue
# come from the workflow environment (GITHUB_REPOSITORY, TRIAGE_ISSUE_NUMBER),
# never from arguments. Each label must exist in the repository and match
# .github/triage-labels.txt; others are skipped. At most three are added.

set -euo pipefail

MAX_LABELS=3
ALLOWLIST="${TRIAGE_LABELS_FILE:-$(dirname "${BASH_SOURCE[0]}")/../triage-labels.txt}"

ISSUE="${TRIAGE_ISSUE_NUMBER:-}"
REPO="${GITHUB_REPOSITORY:-}"
if ! [[ "${ISSUE}" =~ ^[1-9][0-9]{0,9}$ ]]; then
  echo "TRIAGE_ISSUE_NUMBER must be a positive integer" >&2
  exit 1
fi
if ! [[ "${REPO}" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "GITHUB_REPOSITORY must be owner/name" >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  echo "usage: triage-label.sh <label> [<label> ...]" >&2
  exit 1
fi

# Existing labels in the repository (one name per line).
existing="$(gh label list --repo "${REPO}" --limit 500 --json name --jq '.[].name')"

is_allowed() {
  local label="$1" pattern
  while IFS= read -r pattern || [ -n "${pattern}" ]; do
    case "${pattern}" in '' | '#'*) continue ;; esac
    # shellcheck disable=SC2254 # the allowlist entries are intentional glob patterns
    case "${label}" in ${pattern}) return 0 ;; esac
  done < "${ALLOWLIST}"
  return 1
}

selected=()
for label in "$@"; do
  # A name starting with a dash could be read as a gh option; a multi-line
  # name would be treated as several patterns by grep.
  case "${label}" in -* | *$'\n'*) echo "Skipped (invalid name)" >&2; continue ;; esac
  if ! grep -qxF -- "${label}" <<< "${existing}"; then
    echo "Skipped (not an existing label): ${label}" >&2
    continue
  fi
  if ! is_allowed "${label}"; then
    echo "Skipped (not allowed): ${label}" >&2
    continue
  fi
  already=0
  for chosen in "${selected[@]+"${selected[@]}"}"; do
    [ "${chosen}" = "${label}" ] && already=1
  done
  [ "${already}" -eq 1 ] && continue
  if [ "${#selected[@]}" -ge "${MAX_LABELS}" ]; then
    echo "Skipped (limit of ${MAX_LABELS} labels): ${label}" >&2
    continue
  fi
  selected+=("${label}")
done

if [ "${#selected[@]}" -eq 0 ]; then
  echo "No label added"
  exit 0
fi

args=(issue edit "${ISSUE}" --repo "${REPO}")
for label in "${selected[@]}"; do
  args+=(--add-label "${label}")
done
gh "${args[@]}"
echo "Added: ${selected[*]}"
