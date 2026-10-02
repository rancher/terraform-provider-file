#!/usr/bin/env bash
set -euo pipefail

# This script runs git diff between the current branch and main/master.
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

# Resolve the merge base between the base branch and current HEAD
MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null || true)
if [[ -z "${MERGE_BASE:-}" ]]; then
  MERGE_BASE="$BASE_BRANCH"
fi

# Run git diff
git diff --no-ext-diff --no-color "$MERGE_BASE" --
