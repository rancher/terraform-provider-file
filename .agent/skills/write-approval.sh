#!/usr/bin/env bash
#
# Skill: write-approval.sh
# Description: Securely writes and verifies the programmatic proactive review approval JSON file.
# Conforms to shell-scripts.instructions.md guidelines.
# Usage: 
#   Write Mode:  .agent/skills/write-approval.sh -t TOKEN -d DIFF_HASH -m "MESSAGE"
#   Verify Mode: .agent/skills/write-approval.sh --verify

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
Usage: write-approval.sh [options] -t TOKEN -d DIFF_HASH -m "MESSAGE"
   or  write-approval.sh --verify

Securely writes and verifies the programmatic proactive review approval JSON file.

Options:
  -h, --help           Show this message and exit.
  --verify             Verify the active proactive review approval file.
  -t TOKEN             The secure One-Time Pad (OTP) token (Required for write).
  -d DIFF_HASH         The cryptographic SHA-256 diff hash of active changes (Required for write).
  -m MESSAGE           The review approval message (Required for write).

Examples:
  .agent/skills/write-approval.sh -t "token" -d "sha256" -m "PR Review status: 🟢 PERFECT - 0 findings."
  .agent/skills/write-approval.sh --verify
EOF
}

get_file_owner_uid() {
  local file="$1"
  stat -c %u "$file" 2>/dev/null || stat -f %u "$file" 2>/dev/null || echo ""
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

# ==============================================================================
# MAIN OPERATIONS
# ==============================================================================

main() {
  local token=""
  local diff_hash=""
  local message=""
  local verify_only=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        exit 0
        ;;
      --verify)
        verify_only=true
        shift
        ;;
      -t)
        token="$2"
        shift 2
        ;;
      -d)
        diff_hash="$2"
        shift 2
        ;;
      -m)
        message="$2"
        shift 2
        ;;
      *)
        echo "Error: Unknown argument '$1'" >&2
        show_help >&2
        exit 1
        ;;
    esac
  done

  local target_dir="$HOME/.gemini/tmp/terraform-provider-file"
  local approval_file="${target_dir}/review-approval.json"
  local token_file="${target_dir}/active-otp.token"

  # ----------------------------------------------------------------------------
  # VERIFY MODE
  # ----------------------------------------------------------------------------
  if [[ "$verify_only" == "true" ]]; then
    echo "Verifying proactive review approval status..." >&2

    if [[ ! -f "$approval_file" ]]; then
      echo "Error: Proactive review approval not found!" >&2
      echo "       In accordance with 'development-process.md', you MUST delegate" >&2
      echo "       a proactive review of your changes to our specialized subagent" >&2
      echo "       before committing: @review_agent" >&2
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
      echo "       This is a security violation. Please ensure the file is generated securely." >&2
      exit 1
    fi

    if ! command_exists jq; then
      echo "Error: 'jq' utility is required to parse review approval file. Please install jq." >&2
      exit 1
    fi

    local status
    status=$(jq -r '.status' "$approval_file" 2>/dev/null || true)
    local approval_hash
    approval_hash=$(jq -r '.diff_hash' "$approval_file" 2>/dev/null || true)

    if [[ "$status" != "approved" ]]; then
      echo "Error: The proactive review approval status is '$status' (not approved)." >&2
      exit 1
    fi

    # Recalculate the active local diff hash securely using SHA-256 (staged + unstaged combined)
    local active_hash
    active_hash=$(git diff HEAD | calculate_sha256)

    if [[ "$approval_hash" != "$active_hash" ]]; then
      echo "Error: Local changes have been modified since your last proactive review approval!" >&2
      echo "       Approved SHA-256 hash: ${approval_hash}" >&2
      echo "       Current active SHA-256 hash: ${active_hash}" >&2
      echo "       Please re-run the review agent on your latest changes: @review_agent" >&2
      exit 1
    fi

    echo "✅ Proactive review approval verified! (SHA-256 Hash: $active_hash)"
    exit 0
  fi

  # ----------------------------------------------------------------------------
  # WRITE MODE
  # ----------------------------------------------------------------------------
  if [[ -z "$token" || -z "$diff_hash" || -z "$message" ]]; then
    echo "Error: Missing required arguments for write mode." >&2
    show_help >&2
    exit 1
  fi

  # Verify the active OTP token
  if [[ ! -f "$token_file" ]]; then
    echo "Error: No active verification token found on disk. Proactive review is unauthorized." >&2
    exit 1
  fi

  local active_token
  active_token=$(cat "$token_file" | tr -d ' \n')
  if [[ "$token" != "$active_token" || ${#active_token} -lt 16 ]]; then
    echo "Error: Invalid verification token. Proactive review signature rejected." >&2
    exit 1
  fi

  # Success! Construct the approval JSON securely with umask 077 (0600 permissions)
  mkdir -p "$target_dir"
  (
    umask 077
    cat <<EOF > "$approval_file"
{
  "status": "approved",
  "message": "${message}",
  "commit_sha": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "diff_hash": "${diff_hash}"
}
EOF
  )

  # Single-use token: Immediately destroy the active token to prevent replay
  rm -f "$token_file"

  echo "✅ Proactive review approval file successfully generated at: $approval_file"
}

main "$@"
