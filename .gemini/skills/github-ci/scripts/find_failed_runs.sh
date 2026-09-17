#!/usr/bin/env bash
set -euo pipefail

# This script lists recent failed GitHub Actions runs.
# Usage: ./find_failed_runs.sh [branch_name_or_empty] [limit]

BRANCH="${1:-}"
LIMIT="${2:-10}"

ARGS=("--status" "failure")
if [ -n "$BRANCH" ]; then
  ARGS+=("-b" "$BRANCH")
else
  # Default to current branch
  CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || true)
  if [ -n "$CURRENT_BRANCH" ]; then
    ARGS+=("-b" "$CURRENT_BRANCH")
  fi
fi

gh run list -L "$LIMIT" "${ARGS[@]}"
