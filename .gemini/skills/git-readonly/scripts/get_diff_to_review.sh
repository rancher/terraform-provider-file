#!/usr/bin/env bash
set -euo pipefail

# This script runs git diff for unstaged and staged changes in the workspace.
# It is designed to be read-only and LLM-friendly.

echo "=== Staged Changes (to be committed) ==="
git diff --no-ext-diff --staged

echo ""
echo "=== Unstaged Changes (working tree) ==="
git diff --no-ext-diff
