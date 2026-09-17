#!/usr/bin/env bash
set -euo pipefail

# This script reads and formats comments from a GitHub PR (conversation & review comments).
# It can take an optional PR number or branch name. If omitted, it views the current branch's PR.

PR_TARGET="${1:-}"

# If PR_TARGET is empty or current, find the current PR number
if [ -z "$PR_TARGET" ] || [ "$PR_TARGET" = "current" ]; then
  # Check if there is an active PR
  if ! PR_TARGET=$(gh pr view --json number -q .number 2>/dev/null); then
    echo "Error: No active pull request found for the current branch." >&2
    exit 1
  fi
fi

# Fetch owner and repo name
REPO_INFO=$(gh repo view --json owner,name)
OWNER=$(echo "$REPO_INFO" | jq -r .owner.login)
REPO=$(echo "$REPO_INFO" | jq -r .name)

echo "=== PR Conversation Comments (PR #$PR_TARGET) ==="
# Get conversation comments
gh pr view "$PR_TARGET" --json comments -q '.comments[] | "Author: @\(.author.login)\nDate: \(.createdAt)\nBody:\n\(.body)\n----------------------------------------"' || echo "No conversation comments found."

echo ""
echo "=== PR Inline Review Comment Threads (PR #$PR_TARGET) ==="
# shellcheck disable=SC2016
# Query GraphQL review threads
gh api graphql -F owner="$OWNER" -F name="$REPO" -F number="$PR_TARGET" -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 100) {
            nodes {
              id
              body
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  }
}' | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | "Thread ID: \(.id)\nPath: \(.path)\nLine: \(.line)\nIs Resolved: \(.isResolved)\nComments:\n" + ([.comments.nodes[] | "  - @\(.author?.login // "ghost") (\(.createdAt)): \(.body)"] | join("\n")) + "\n----------------------------------------"' || echo "No inline review threads found."


