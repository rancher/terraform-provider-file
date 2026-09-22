#!/usr/bin/env bash
set -euo pipefail

# Uses git status --porcelain to output a clean list of changed/untracked file paths.
# Each path is printed on a new line.

git status --porcelain | while IFS= read -r line; do
  # The path starts at character index 3 in porcelain format.
  path="${line:3}"
  # Remove surrounding quotes if git quoted the path (e.g. for paths with spaces)
  path="${path%\"}"
  path="${path#\"}"
  
  # If it's a rename (e.g. old_file -> new_file), extract just the new file path
  path="${path##* -> }"
  
  echo "$path"
done
