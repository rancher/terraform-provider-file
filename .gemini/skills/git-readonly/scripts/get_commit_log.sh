#!/usr/bin/env bash
set -euo pipefail

# This script displays a concise log of recent commits on the current branch.
# It is designed to be read-only and LLM-friendly.

LIMIT=${1:-5}

echo "=== Last $LIMIT Commits ==="
git log -n "$LIMIT" --oneline --decorate --color=never
