#!/usr/bin/env bash
set -euo pipefail

# This script safely retrieves the contents of a deleted (or modified) file from Git history.
# It is designed to be read-only and LLM-friendly.

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <file_path>" >&2
  exit 1
fi

FILE_PATH="$1"

# Find the last commit where the file existed/was modified
LAST_COMMIT=$(git log -n 1 --pretty=format:%H -- "$FILE_PATH" || true)

if [ -z "$LAST_COMMIT" ]; then
  echo "Error: File '$FILE_PATH' was never found in git history." >&2
  exit 1
fi

# Show the file content. If it doesn't exist at the last commit (meaning it was deleted there),
# retrieve it from the parent of that commit.
if ! git show "$LAST_COMMIT:$FILE_PATH" &>/dev/null; then
  if git show "$LAST_COMMIT~1:$FILE_PATH" &>/dev/null; then
    git show "$LAST_COMMIT~1:$FILE_PATH"
  else
    echo "Error: Could not retrieve contents for '$FILE_PATH' from history." >&2
    exit 1
  fi
else
  git show "$LAST_COMMIT:$FILE_PATH"
fi
