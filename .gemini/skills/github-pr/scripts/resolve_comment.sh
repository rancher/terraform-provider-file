#!/usr/bin/env bash
set -euo pipefail

# This script resolves a specific PR inline review comment thread.
# Usage: ./resolve_comment.sh <thread_id>

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <thread_id>" >&2
  exit 1
fi

THREAD_ID="$1"

echo "Resolving review thread $THREAD_ID..."

# shellcheck disable=SC2016
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}' -F threadId="$THREAD_ID"
