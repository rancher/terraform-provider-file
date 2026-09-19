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

# Run git diff
git diff "$BASE_BRANCH"
