#!/usr/bin/env bash
set -euo pipefail

# This script searches through downloaded CI log files for errors or failures.
# Usage: ./search_logs.sh <logs_directory> [search_pattern]

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <logs_directory> [search_pattern]" >&2
  exit 1
fi

LOGS_DIR="$1"
# Default pattern matches: Error, Failed, Failure, exception, exit status, fatal, panic (case-insensitive)
PATTERN="${2:-\b(error|fail|failure|exception|exit status|fatal|panic)\b}"

if [ ! -d "$LOGS_DIR" ]; then
  echo "Error: Directory '$LOGS_DIR' does not exist." >&2
  exit 1
fi

echo "Searching for pattern '$PATTERN' in $LOGS_DIR..."
echo "----------------------------------------"

# Use grep -rniE to find matches with line numbers and file names
grep -rniE "$PATTERN" "$LOGS_DIR" || echo "No matches found for pattern: $PATTERN"
