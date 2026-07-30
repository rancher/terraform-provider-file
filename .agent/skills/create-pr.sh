#!/usr/bin/env bash
#
# Skill: create-pr.sh
# Description: Safely creates a pull request from your local fork branch to the upstream main branch,
#              bypassing ambient GITHUB_TOKEN environment overrides to use the gh CLI's authenticated credential.
# Usage: .agent/skills/create-pr.sh --title "<Title>" --body "<Body>" [--base "<Base>"] [--draft]

set -euo pipefail

TITLE=""
BODY=""
BASE="main"
DRAFT_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --title)
      TITLE="$2"
      shift 2
      ;;
    --body)
      BODY="$2"
      shift 2
      ;;
    --base)
      BASE="$2"
      shift 2
      ;;
    --draft)
      DRAFT_FLAG="--draft"
      shift
      ;;
    *)
      echo "Unknown parameter: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TITLE" || -z "$BODY" ]]; then
  echo "Error: Both --title and --body parameters are required." >&2
  exit 1
fi

# 1. Verify inside Git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: This command must be run inside a Git repository." >&2
  exit 1
fi

# 2. Detect branch
BRANCH="$(git branch --show-current)"

# 3. Retrieve origin URL and parse fork owner
origin_url=$(git remote get-url origin 2>/dev/null || true)
if [[ -z "$origin_url" ]]; then
  echo "Error: Could not retrieve configured origin remote URL." >&2
  exit 1
fi

if [[ "$origin_url" =~ github\.com[:/]([^/]+)/ ]]; then
  FORK_OWNER="${BASH_REMATCH[1]}"
else
  echo "Error: Could not parse fork owner from origin URL $origin_url" >&2
  exit 1
fi

echo "Creating Pull Request for branch '$BRANCH' on fork '$FORK_OWNER'..."

# 4. Set the default repository to ensure gh targets upstream
GITHUB_TOKEN= gh repo set-default rancher/terraform-provider-file

# 5. Create the PR non-interactively, bypassing GITHUB_TOKEN override
# shellcheck disable=SC2086
GITHUB_TOKEN= gh pr create \
  --repo "rancher/terraform-provider-file" \
  --base "$BASE" \
  --head "${FORK_OWNER}:${BRANCH}" \
  --title "$TITLE" \
  --body "$BODY" \
  $DRAFT_FLAG
