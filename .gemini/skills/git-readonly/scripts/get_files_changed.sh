#!/usr/bin/env bash
set -euo pipefail

# This script lists the files changed in the current branch compared to the base branch,
# as well as the current uncommitted changes (git status).
# It is designed to be read-only and LLM-friendly.

# Check if main branch exists, if not try master
BASE_BRANCH="main"
if ! git rev-parse --verify "$BASE_BRANCH" &>/dev/null; then
  if git rev-parse --verify "master" &>/dev/null; then
    BASE_BRANCH="master"
  else
    echo "Error: Neither main nor master branch exists." >&2
    exit 1
  fi
fi

echo "=== Current Working Tree Status ==="
git status --short

echo ""
echo "=== Files Changed in Current Branch vs $BASE_BRANCH ==="
git diff --name-status "$BASE_BRANCH"
