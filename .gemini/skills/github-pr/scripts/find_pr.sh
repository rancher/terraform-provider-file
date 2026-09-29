#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/auth_fallback.sh"

# This script finds and views a pull request on GitHub.
# It can take an optional PR number or branch name. If omitted, it views the current branch's PR.

PR_TARGET="${1:-}"

if [[ -n "$PR_TARGET" ]]; then
  gh pr view "$PR_TARGET"
else
  gh pr view
fi
