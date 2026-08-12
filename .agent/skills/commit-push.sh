#!/usr/bin/env bash
#
# Skill: commit-push.sh
# Description: Programmatically commit and push local changes with GPG/SSH signature, sign-off, and fork synchronization.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

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

get_file_owner_uid() {
  local file="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    stat -f %u "$file" 2>/dev/null || echo ""
  else
    stat -c %u "$file" 2>/dev/null || echo ""
  fi
}

calculate_sha256() {
  if command_exists shasum; then
    shasum -a 256 | cut -d' ' -f1
  elif command_exists sha256sum; then
    sha256sum | cut -d' ' -f1
  else
    echo "Error: No SHA-256 utility (shasum or sha256sum) found on this system." >&2
    exit 1
  fi
}

verify_push_safety() {
  local remote_name="$1"
  local url
  url=$(git remote get-url "$remote_name" 2>/dev/null || true)
  if [[ -z "$url" ]]; then
    echo "Error: Remote '$remote_name' has no configured URL." >&2
    exit 1
  fi
  if [[ "$url" =~ [/:](rancher|rancherlabs)/ ]]; then
    echo "======================================================================" >&2
    echo "❌ CRITICAL SECURITY ERROR: UNSAFE PUSH PREVENTED!" >&2
    echo "   The remote '$remote_name' points to a Rancher-owned repository:" >&2
    echo "   $url" >&2
    echo "   Pushing directly to upstream Rancher repositories is strictly forbidden." >&2
    echo "======================================================================" >&2
    exit 1
  fi
}

# ==============================================================================
# OPERATION STAGES
# ==============================================================================

# Parse options and arguments
parse_args() {
  # Initialize variables with global defaults
  commit_msg=""
  run_sync=true
  auto_confirm=false
  force_push=false

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
}

# Check if the current branch has an already merged PR on GitHub (Branch Defunct Protection)
check_defunct_branch() {
  local branch="$1"
  if [[ "$branch" != "main" ]]; then
    local pr_status
    if pr_status=$(gh pr view "$branch" --json state,number --template '{{.state}} {{.number}}' 2>/dev/null); then
      local pr_state
      pr_state=$(echo "$pr_status" | cut -d' ' -f1)
      local pr_number
      pr_number=$(echo "$pr_status" | cut -d' ' -f2)
      
      if [[ "$pr_state" == "MERGED" ]]; then
        echo "Error: The current branch '$branch' already has a merged Pull Request (#$pr_number) on GitHub." >&2
        echo "       This branch is defunct. In accordance with 'development-process.md' Phase 5, Step 12, you MUST:" >&2
        echo "       1. Switch to 'main': git checkout main" >&2
        echo "       2. Synchronize with upstream default branch: bash .agent/skills/git-sync.sh" >&2
        echo "       3. Check out a clean, new branch off updated main: git checkout -b feature/workflows-new-branch" >&2
        exit 1
      fi
    fi
  fi
}

# Verify staging files and file-count limits
verify_staging_limits() {
  local max_allowed=5
  staged_count=$(git diff --cached --name-only | wc -l | tr -d ' ')

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
}

# Enforce secure proactive review validation
verify_proactive_review() {
  local approval_file="/tmp/review-approval.json"

  # Validate approval file presence and security constraints
  if [[ ! -f "$approval_file" ]]; then
    echo "Error: Proactive review approval not found!" >&2
    echo "       In accordance with Phase 4, Steps 9-10 (Proactive Review & Quality Gate) of 'development-process.md'," >&2
    echo "       you MUST delegate a proactive review of your changes to our specialized subagent BEFORE committing:" >&2
    echo "       -> In the chat, run: @review_agent Please review my current staged changes." >&2
    exit 1
  fi

  if [[ -L "$approval_file" ]]; then
    echo "Error: Proactive review approval file at '$approval_file' is a symbolic link." >&2
    echo "       Symlink-based approval files are prohibited for security." >&2
    exit 1
  fi

  local owner_uid
  owner_uid=$(get_file_owner_uid "$approval_file")
  if [[ "$owner_uid" != "$UID" ]]; then
    echo "Error: Proactive review approval file at '$approval_file' is not owned by the current user (UID: $UID, Owner: $owner_uid)." >&2
    echo "       This is a security violation. Please ensure the file is generated securely by your own agent session." >&2
    exit 1
  fi

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

  # Recalculate the active local diff hash securely using SHA-256 (staged + unstaged combined)
  local active_hash
  active_hash=$(git diff HEAD | calculate_sha256)

  if [[ "$approval_hash" != "$active_hash" ]]; then
    echo "Error: Local changes have been modified since your last proactive review approval!" >&2
    echo "       Approved SHA-256 hash: ${approval_hash}" >&2
    echo "       Current active SHA-256 hash: ${active_hash}" >&2
    echo "       In accordance with Phase 13 of 'GitHubWorkflows.md', you MUST re-run the review agent" >&2
    echo "       on your latest changes to obtain a fresh approval: @review_agent" >&2
    exit 1
  fi

  echo "✅ Proactive review approval verified! (SHA-256 Hash: $active_hash)"
}

# Sync with Upstream parent repository
sync_default_branch() {
  local branch="$1"
  if [[ "$run_sync" == "true" ]]; then
    if [[ "$branch" != "main" ]]; then
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
          if ! git stash pop >/dev/null 2>&1; then
            echo "Warning: Stash pop failed during emergency exit. Your stashed changes remain preserved in Git stash." >&2
          fi
        fi
        exit 1
      fi

      # Switch back to the active feature branch because git-sync.sh leaves the checkout on main
      echo "Switching back to branch '$branch'..."
      if ! git checkout "$branch" >/dev/null 2>&1; then
        echo "Error: Failed to switch back to branch '$branch' after sync." >&2
        if [[ "$stash_created" == "true" ]]; then
          if ! git stash pop >/dev/null 2>&1; then
            echo "Warning: Stash pop failed during emergency exit. Your stashed changes remain preserved in Git stash." >&2
          fi
        fi
        exit 1
      fi

      # Restore stashed changes gracefully with conflict checking
      if [[ "$stash_created" == "true" ]]; then
        echo "  -> Restoring stashed unstaged/untracked files..."
        if ! git stash pop >/dev/null 2>&1; then
          echo "Warning: Re-applying stashed changes resulted in merge conflicts." >&2
          echo "         Your stashed changes have been PRESERVED in the Git stash list." >&2
          echo "         Please resolve conflicts manually (e.g. using 'git stash pop' or 'git diff' to inspect)." >&2
        fi
      fi
    fi
  fi
}

# Verify ancestry check to fail fast if we are behind remote
verify_remote_ancestry() {
  local branch="$1"
  if [[ "$force_push" == "true" ]]; then
    echo "Force-push option specified. Skipping ancestry check."
  else
    echo "Checking remote branch status on origin..."
    # Fetch latest remote ref without mutating working tree
    if git fetch origin "$branch" >/dev/null 2>&1; then
      # Remote branch exists, check if we are behind
      local behind_count
      behind_count=$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo "0")
      if [[ "$behind_count" -gt 0 ]]; then
        echo "Error: Your local branch is behind 'origin/$branch' by $behind_count commit(s)." >&2
        echo "       Please pull and integrate the remote changes before pushing." >&2
        exit 1
      fi
      echo "  -> Local branch is up to date with remote."
    else
      echo "  -> Remote branch 'origin/$branch' does not exist yet. Safe to proceed."
    fi
  fi
}

# Prompt developer interactive TTY confirmation
prompt_developer_approval() {
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
}

# Execute signed and signed-off git commit
execute_signed_commit() {
  echo "Committing $staged_count staged file(s) with signature (-S) and sign-off (-s)..."
  if ! git commit -s -S -m "$commit_msg"; then
    echo "Error: Git commit failed. Ensure GPG/SSH signing is configured." >&2
    exit 1
  fi
}

# Perform secure push to fork remote
secure_push() {
  local branch="$1"
  if [[ "$force_push" == "true" ]]; then
    echo "Pushing signed commit with FORCE securely to fork remote 'origin/$branch'..."
    if ! git push origin "$branch" --force-with-lease; then
      echo "Error: Git push failed." >&2
      exit 1
    fi
  else
    echo "Pushing signed commit securely to fork remote 'origin/$branch'..."
    if ! git push origin "$branch"; then
      echo "Error: Git push failed." >&2
      exit 1
    fi
  fi
}

# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================
main() {
  # Global state variables
  staged_count=0

  parse_args "$@"
  verify_environment
  verify_push_safety origin

  local current_branch
  current_branch=$(git branch --show-current)
  if [[ -z "$current_branch" ]]; then
    echo "Error: Could not determine current branch name." >&2
    exit 1
  fi

  check_defunct_branch "$current_branch"
  verify_staging_limits
  verify_proactive_review
  sync_default_branch "$current_branch"
  verify_remote_ancestry "$current_branch"
  prompt_developer_approval
  execute_signed_commit
  secure_push "$current_branch"

  echo "✅ Changes programmatically committed and pushed successfully!"
}

main "$@"