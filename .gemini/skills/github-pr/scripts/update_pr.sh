#!/usr/bin/env bash
set -euo pipefail

# This script updates a pull request's title and/or description.
# Usage: ./update_pr.sh <pr_number_or_empty> <title_or_empty> <body_or_empty>

PR_TARGET="${1:-}"
TITLE="${2:-}"
BODY="${3:-}"

ARGS=()
if [ -n "$TITLE" ]; then
  ARGS+=("--title" "$TITLE")
fi
if [ -n "$BODY" ]; then
  ARGS+=("--body" "$BODY")
fi

if [ "${#ARGS[@]}" -eq 0 ]; then
  echo "Error: Nothing to update. Provide title and/or body." >&2
  exit 1
fi

if [ -n "$PR_TARGET" ]; then
  gh pr edit "$PR_TARGET" "${ARGS[@]}"
else
  gh pr edit "${ARGS[@]}"
fi
