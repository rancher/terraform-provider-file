#!/usr/bin/env bash
#
# Skill: commit-push.sh
# Description: Programmatically commit and push local changes with GPG/SSH signature, sign-off, and fork synchronization.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

# Helper to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Display script help usage instructions
show_help() {
  cat <<EOF
Usage: commit-push.sh [options] -m "COMMIT_MESSAGE"

Programmatically commit and push local changes with GPG/SSH signature, sign-off, and fork synchronization.

Options:
  -h, --help            Show this message and exit.
  -m MESSAGE            The conventional commit message (Required).
  -y, --yes             Skip interactive developer approval prompt (Auto-confirm).
  -f, --force           Bypass remote ancestry check and perform safe force-push with lease.
  --no-sync             Skip running git-sync.sh default branch synchronization.

Examples:
  .agent/skills/commit-push.sh -m "ci(workflows): add new automated checks"
  .agent/skills/commit-push.sh -y -m "ci(hooks): automated skill commit"
  .agent/skills/commit-push.sh -f -m "refactor(hooks): force push after rebase"
  .agent/skills/commit-push.sh --no-sync -m "fix(hooks): correct branch check"
EOF
}

verify_environment() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Error: Must be run inside a Git repository." >&2
    exit 1
  fi
}

main() {
  local commit_msg=""
  local run_sync=true
  local auto_confirm=false
  local force_push=false

  # Parse Help / Arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        exit 0
        ;;
      -y|--yes)
        auto_confirm=true
        shift
        ;;
      -f|--force)
        force_push=true
        shift
        ;;
      -m)
        if [[ -z "${2:-}" ]]; then
          echo "Error: -m option requires a non-empty commit message argument." >&2
          exit 1
        fi
        commit_msg="$2"
        shift 2
        ;;
      --no-sync)
        run_sync=false
        shift
        ;;
      *)
        echo "Error: Unknown argument '$1'" >&2
        show_help >&2
        exit 1
        ;;
    esac
  done

  if [[ -z "$commit_msg" ]]; then
    echo "Error: Commit message is required. Specify using -m \"message\"." >&2
    show_help >&2
    exit 1
  fi

  verify_environment

  local current_branch
  current_branch=$(git branch --show-current)
  if [[ -z "$current_branch" ]]; then
    echo "Error: Could not determine current branch name." >&2
    exit 1
  fi

  # Check if the current branch has an already merged PR on GitHub (Branch Defunct Protection)
  # Uses gh templates to eliminate jq dependency for environment resilience
  if [[ "$current_branch" != "main" ]]; then
    local pr_status
    if pr_status=$(gh pr view "$current_branch" --json state,number --template '{{.state}} {{.number}}' 2>/dev/null); then
      local pr_state
      pr_state=$(echo "$pr_status" | cut -d' ' -f1)
      local pr_number
      pr_number=$(echo "$pr_status" | cut -d' ' -f2)
      
      if [[ "$pr_state" == "MERGED" ]]; then
        echo "Error: The current branch '$current_branch' already has a merged Pull Request (#$pr_number) on GitHub." >&2
        echo "       This branch is defunct. In accordance with 'development-process.md' Phase 5, Step 12, you MUST:" >&2
        echo "       1. Switch to 'main': git checkout main" >&2
        echo "       2. Synchronize with upstream default branch: bash .agent/skills/git-sync.sh" >&2
        echo "       3. Check out a clean, new branch off updated main: git checkout -b feature/workflows-new-branch" >&2
        exit 1
      fi
    fi
  fi

  # 1. Staging Verification & File Staging Limits (Phase 5, Step 11)
  local staged_count
  staged_count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  local max_allowed=5

  if [[ "$staged_count" -eq 0 ]]; then
    echo "Error: No changes are currently staged for commit." >&2
    echo "       Please stage your changes first using 'git add <files>...'." >&2
    exit 1
  fi

  if [[ "$staged_count" -gt "$max_allowed" ]]; then
    echo "Error: Committing too much code at once is prohibited ($staged_count files staged; max allowed is $max_allowed)." >&2
    echo "       In accordance with Phase 5, Step 11 of 'development-process.md', please split your commit into smaller, surgical layers." >&2
    exit 1
  fi

  # 2. Secure Proactive Review Verification (Phase 4, Steps 9-10 & Phase 13)
  local approval_file="/tmp/review-approval.json"
  if [[ ! -f "$approval_file" ]]; then
    echo "Error: Proactive review approval not found!" >&2
    echo "       In accordance with Phase 4, Steps 9-10 (Proactive Review & Quality Gate) of 'development-process.md'," >&2
    echo "       you MUST delegate a proactive review of your changes to our specialized subagent BEFORE committing:" >&2
    echo "       -> In the chat, run: @review_agent Please review my current staged changes." >&2
    exit 1
  fi

  # Extract values from the approval file
  if ! command_exists jq; then
    echo "Error: 'jq' utility is required to parse review approval file. Please install jq." >&2
    exit 1
  fi

  local approval_status
  approval_status=$(jq -r '.status' "$approval_file" 2>/dev/null || true)
  local approval_hash
  approval_hash=$(jq -r '.diff_hash' "$approval_file" 2>/dev/null || true)

  if [[ "$approval_status" != "approved" ]]; then
    echo "Error: The proactive review approval file exists but status is '$approval_status' (not approved)." >&2
    echo "       Please resolve all reported review findings and run the review agent again to obtain approval." >&2
    exit 1
  fi

  # Recalculate the active local diff hash (staged + unstaged combined)
  local active_hash
  if command_exists shasum; then
    active_hash=$(git diff HEAD | shasum | cut -d' ' -f1)
  elif command_exists md5sum; then
    active_hash=$(git diff HEAD | md5sum | cut -d' ' -f1)
  else
    active_hash=$(git diff HEAD | md5 | cut -d' ' -f1)
  fi

  if [[ "$approval_hash" != "$active_hash" ]]; then
    echo "Error: Local changes have been modified since your last proactive review approval!" >&2
    echo "       Approved diff hash: ${approval_hash}" >&2
    echo "       Current active hash: ${active_hash}" >&2
    echo "       In accordance with Phase 13 of 'GitHubWorkflows.md', you MUST re-run the review agent" >&2
    echo "       on your latest changes to obtain a fresh approval: @review_agent" >&2
    exit 1
  fi

  echo "✅ Proactive review approval verified! (Diff hash: $active_hash)"

  # 3. Sync Default Branch with Upstream (Phase 5, Step 12)
  if [[ "$run_sync" == "true" ]]; then
    if [[ "$current_branch" != "main" ]]; then
      echo "Synchronizing local 'main' branch and tags with upstream parent repository..."
      # Temporarily stash unstaged/untracked files to allow git-sync.sh clean checks
      local stash_created=false
      if git status --porcelain | grep -v '^[A-Z]' >/dev/null; then
        echo "  -> Temporarily stashing unstaged/untracked files..."
        git stash push -u -m "temp-commit-push-stash" >/dev/null
        stash_created=true
      fi

      # Run sync skill
      if ! bash .agent/skills/git-sync.sh; then
        echo "Error: Upstream synchronization failed." >&2
        if [[ "$stash_created" == "true" ]]; then
          git stash pop >/dev/null
        fi
        exit 1
      fi

      # Switch back to the active feature branch because git-sync.sh leaves the checkout on main
      echo "Switching back to branch '$current_branch'..."
      if ! git checkout "$current_branch" >/dev/null 2>&1; then
        echo "Error: Failed to switch back to branch '$current_branch' after sync." >&2
        if [[ "$stash_created" == "true" ]]; then
          git stash pop >/dev/null
        fi
        exit 1
      fi

      # Restore stashed changes
      if [[ "$stash_created" == "true" ]]; then
        echo "  -> Restoring stashed unstaged/untracked files..."
        git stash pop >/dev/null
      fi
    fi
  fi

  # 4. Fetch and check ancestry to verify local is not behind remote
  if [[ "$force_push" == "true" ]]; then
    echo "Force-push option specified. Skipping ancestry check."
  else
    echo "Checking remote branch status on origin..."
    # Fetch latest remote ref without mutating working tree
    if git fetch origin "$current_branch" >/dev/null 2>&1; then
      # Remote branch exists, check if we are behind
      local behind_count
      behind_count=$(git rev-list --count "HEAD..origin/$current_branch" 2>/dev/null || echo "0")
      if [[ "$behind_count" -gt 0 ]]; then
        echo "Error: Your local branch is behind 'origin/$current_branch' by $behind_count commit(s)." >&2
        echo "       Please pull and integrate the remote changes before pushing." >&2
        exit 1
      fi
      echo "  -> Local branch is up to date with remote."
    else
      echo "  -> Remote branch 'origin/$current_branch' does not exist yet. Safe to proceed."
    fi
  fi

  # 5. Developer Approval Gate via Interactive TTY
  echo "============================================================"
  echo "🚨 COMMIT & PUSH GATEWAY APPROVAL REQUIRED"
  echo "============================================================"
  echo "Staged Files to be Committed & Signed:"
  git diff --cached --name-only | sed 's/^/  - /'
  echo "------------------------------------------------------------"
  echo "Commit Message: \"$commit_msg\""
  echo "============================================================"
  
  local response=""
  if [[ "$auto_confirm" == "true" ]]; then
    echo "Auto-confirm flag (-y/--yes) specified. Skipping interactive prompt."
    response="y"
  elif [[ -t 0 ]]; then
    read -rp "Do you approve GPG-signing, committing, and pushing these changes? [y/N]: " response
  else
    read -rp "Do you approve GPG-signing, committing, and pushing these changes? [y/N]: " response < /dev/tty || response="N"
  fi
  
  if [[ "$response" != "y" && "$response" != "yes" && "$response" != "Y" && "$response" != "YES" ]]; then
    echo "❌ Commit and push aborted by developer." >&2
    exit 1
  fi
  echo "Developer approval confirmed. Proceeding with signed commit..."

  # 6. GPG/SSH Signed and Signed-off Commit
  echo "Committing $staged_count staged file(s) with signature (-S) and sign-off (-s)..."
  if ! git commit -s -S -m "$commit_msg"; then
    echo "Error: Git commit failed. Ensure GPG/SSH signing is configured." >&2
    exit 1
  fi

  # 7. Secure Push to Fork Remote
  if [[ "$force_push" == "true" ]]; then
    echo "Pushing signed commit with FORCE securely to fork remote 'origin/$current_branch'..."
    if ! git push origin "$current_branch" --force-with-lease; then
      echo "Error: Git push failed." >&2
      exit 1
    fi
  else
    echo "Pushing signed commit securely to fork remote 'origin/$current_branch'..."
    if ! git push origin "$current_branch"; then
      echo "Error: Git push failed." >&2
      exit 1
    fi
  fi

  echo "✅ Changes programmatically committed and pushed successfully!"
}

main "$@"