#!/usr/bin/env bash
#
# Skill: resolve-pr-reviews.sh
# Description: Programmatically list and resolve review comment threads on a GitHub Pull Request using GraphQL and the GitHub CLI.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

# Helper to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# 1. Verification
if ! command_exists gh; then
  echo "Error: GitHub CLI (gh) is required but not installed." >&2
  exit 1
fi

if ! command_exists jq; then
  echo "Error: jq (JSON processor) is required but not installed." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Must be run inside a Git repository." >&2
  exit 1
fi

# 2. Extract Owner/Repo and PR Number
PR_ID=""
if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
  PR_ID="$1"
  shift
else
  # Autodetect from current branch
  CURRENT_BRANCH=$(git branch --show-current)
  if [[ -n "$CURRENT_BRANCH" ]]; then
    echo "Autodetecting open PR for branch '$CURRENT_BRANCH' on origin/upstream..."
    PR_ID=$(gh pr list --head "$CURRENT_BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)
  fi
fi

if [[ -z "$PR_ID" ]]; then
  echo "Error: No Pull Request number provided and could not autodetect an open PR for the current branch." >&2
  echo "Usage: $0 [PR_ID] [options/file_pattern]" >&2
  echo "Options:" >&2
  echo "  --all                 Resolve ALL unresolved comment threads." >&2
  echo "  <pattern>            Resolve threads where file path matches the given pattern (e.g., 'publish-release.test.js')." >&2
  exit 1
fi

# Query the PR URL to parse the exact target upstream Owner and Repo
PR_URL=$(gh pr view "$PR_ID" --json url --jq '.url' 2>/dev/null || true)
if [[ -n "$PR_URL" && "$PR_URL" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  PR_ID="${BASH_REMATCH[3]}"
else
  # Local fallback if gh pr view fails
  ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ -n "$ORIGIN_URL" && "$ORIGIN_URL" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO="${BASH_REMATCH[2]}"
  else
    echo "Error: Could not determine target Owner and Repo." >&2
    exit 1
  fi
fi

echo "Connected to PR #$PR_ID on $OWNER/$REPO"

# 4. Fetch Unresolved Threads via GraphQL
echo "Fetching unresolved review comment threads..."
QUERY='
query($owner: String!, $repo: String!, $pullNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pullNumber) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              body
              path
              author {
                login
              }
            }
          }
        }
      }
    }
  }
}
'

THREADS_JSON=$(gh api graphql -F owner="$OWNER" -F repo="$REPO" -F pullNumber="$PR_ID" -f query="$QUERY" 2>/dev/null || true)

if [[ -z "$THREADS_JSON" ]]; then
  echo "Error: Failed to query GitHub GraphQL API. Ensure you have network access and your GITHUB_TOKEN has read permissions." >&2
  exit 1
fi

UNRESOLVED_THREADS=$(echo "$THREADS_JSON" | jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved == false))')
THREAD_COUNT=$(echo "$UNRESOLVED_THREADS" | jq '. | length')

if [[ "$THREAD_COUNT" -eq 0 ]]; then
  echo "🎉 No unresolved comment threads found on PR #$PR_ID!"
  exit 0
fi

echo "Found $THREAD_COUNT unresolved comment thread(s) on PR #$PR_ID:"

# 5. Process and resolve threads
MODE="list"
FILTER=""

if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--all" ]]; then
    MODE="all"
  else
    MODE="filter"
    FILTER="$1"
    echo "Filtering threads matching file pattern: '$FILTER'"
  fi
fi

# Function to resolve a thread
resolve_thread() {
  local thread_id="$1"
  local path="$2"
  local author="$3"
  
  echo "Resolving thread $thread_id on '$path' by @$author..."
  MUTATION='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread {
        id
        isResolved
      }
    }
  }
  '
  gh api graphql -F threadId="$thread_id" -f query="$MUTATION" >/dev/null
  echo "✅ Thread successfully resolved!"
}

# Loop and display/resolve
for i in $(seq 0 $((THREAD_COUNT - 1))); do
  THREAD=$(echo "$UNRESOLVED_THREADS" | jq ".[$i]")
  THREAD_ID=$(echo "$THREAD" | jq -r '.id')
  FILE_PATH=$(echo "$THREAD" | jq -r '.comments.nodes[0].path')
  AUTHOR=$(echo "$THREAD" | jq -r '.comments.nodes[0].author.login')
  BODY=$(echo "$THREAD" | jq -r '.comments.nodes[0].body' | tr '\r\n' ' ' | cut -c1-80)

  echo "------------------------------------------------------------"
  echo "Thread ID : $THREAD_ID"
  echo "File Path : $FILE_PATH"
  echo "Author    : @$AUTHOR"
  echo "Comment   : $BODY..."

  if [[ "$MODE" == "all" ]]; then
    resolve_thread "$THREAD_ID" "$FILE_PATH" "$AUTHOR"
  elif [[ "$MODE" == "filter" ]]; then
    if [[ "$FILE_PATH" =~ $FILTER ]]; then
      resolve_thread "$THREAD_ID" "$FILE_PATH" "$AUTHOR"
    else
      echo "  -> Skipping (does not match filter)"
    fi
  else
    echo "  -> Running in list mode. Run with '$0 $PR_ID --all' or '$0 $PR_ID $FILE_PATH' to resolve."
  fi
done
echo "------------------------------------------------------------"
