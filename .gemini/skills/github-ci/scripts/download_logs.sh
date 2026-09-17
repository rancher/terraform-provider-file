#!/usr/bin/env bash
set -euo pipefail

# This script downloads the logs of a specific GitHub Actions workflow run.
# Usage: ./download_logs.sh <run_id> [output_directory]

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <run_id> [output_directory]" >&2
  exit 1
fi

RUN_ID="$1"
OUT_DIR="${2:-/tmp/ci-logs-$RUN_ID}"

echo "Downloading logs for run $RUN_ID to $OUT_DIR..."
mkdir -p "$OUT_DIR"
gh run download "$RUN_ID" -D "$OUT_DIR"

echo "Logs successfully downloaded and extracted to: $OUT_DIR"
echo "You can use search_logs.sh to find failures or look at individual log files in that directory."
