#!/usr/bin/env bash
set -euo pipefail

# This script responds to a PR comment (either general or inline review comment thread).
# Usage: ./respond_comment.sh <pr_number_or_current> <comment_id_or_empty> "<body>"
# If comment_id is empty, "general", or "0", it adds a general PR comment.

PR_TARGET="${1:-}"
COMMENT_ID="${2:-}"
BODY="${3:-}"

if [ -z "$BODY" ] && [ -n "$COMMENT_ID" ] && [ -z "${4:-}" ]; then
  # If only two arguments are passed, assume they are PR_TARGET and BODY (general comment)
  BODY="$COMMENT_ID"
  COMMENT_ID="general"
fi

# If PR_TARGET is empty or current, find the current PR number
if [ -z "$PR_TARGET" ] || [ "$PR_TARGET" = "current" ]; then
  PR_TARGET=$(gh pr view --json number -q .number)
fi

# If COMMENT_ID is empty or "general" or "0", do general PR comment
if [ -z "$COMMENT_ID" ] || [ "$COMMENT_ID" = "general" ] || [ "$COMMENT_ID" = "0" ]; then
  echo "Adding a general comment to PR #$PR_TARGET..."
  gh pr comment "$PR_TARGET" --body "$BODY"
else
  echo "Replying to inline review comment #$COMMENT_ID on PR #$PR_TARGET..."
  
  # Fetch owner and repo name
  REPO_INFO=$(gh repo view --json owner,name)
  OWNER=$(echo "$REPO_INFO" | jq -r .owner.login)
  REPO=$(echo "$REPO_INFO" | jq -r .name)
  
  gh api "repos/$OWNER/$REPO/pulls/$PR_TARGET/comments/$COMMENT_ID/replies" \
    -X POST \
    -f body="$BODY"
fi
