#!/usr/bin/env bash
#
# Skill: sync-boilerplate.sh
# Description: Lightweight, manifest-driven utility to compare and synchronize configuration files
#              and boilerplate files with a centralized master template Git repository.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

# Global workspace directories
MANIFEST_FILE=".boilerplate-sync.json"
TMP_WORKSPACE=""
MODE="help"
TEMPLATE_REPO=""

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
Usage: sync-boilerplate.sh [options]

Lightweight utility to compare and synchronize repository configuration and boilerplate files.

Options:
  -h, --help            Show this help message and exit.
  -d, --diff            Compare local files to remote templates and print visual differences.
  -p, --pull            Pull remote template files to overwrite/update local configurations.
  -u, --push            Push local file changes back to the centralized template repository.
  -s, --status          Summarize the synchronization status of all manifest-tracked files.
  -r, --repo <url>      Explicitly provide the central template repository URL.

Examples:
  .gemini/skills/sync-boilerplate.sh --repo git@github.com:your-organization/your-boilerplate-repo.git --diff
  .gemini/skills/sync-boilerplate.sh --repo git@github.com:your-organization/your-boilerplate-repo.git --pull
  .gemini/skills/sync-boilerplate.sh --repo git@github.com:your-organization/your-boilerplate-repo.git --push
  .gemini/skills/sync-boilerplate.sh --repo git@github.com:your-organization/your-boilerplate-repo.git --status
EOF
}

# Cleanup trap mathematically guaranteeing zero temporary file residue on exit
cleanup() {
  if [[ -n "${TMP_WORKSPACE:-}" && -d "${TMP_WORKSPACE}" ]]; then
    echo "Cleaning up temporary clone workspace..." >&2
    rm -rf "${TMP_WORKSPACE}"
  fi
}

# Validate that the system has required binaries and the local manifest exists
validate_environment() {
  if [[ ! -f "${MANIFEST_FILE}" ]]; then
    echo "Error: Boilerplate sync manifest file '${MANIFEST_FILE}' not found in root directory." >&2
    echo "       Please create '.boilerplate-sync.json' defining 'files' mapping array." >&2
    exit 1
  fi

  if ! command_exists jq; then
    echo "Error: 'jq' JSON parser utility is required but not found in current PATH." >&2
    exit 1
  fi

  if ! command_exists git; then
    echo "Error: 'git' is required but not found in current PATH." >&2
    exit 1
  fi

  if [[ "${MODE}" == "push" ]]; then
    if ! command_exists gh; then
      echo "Error: 'gh' (GitHub CLI) is required for push operations but not found in current PATH." >&2
      exit 1
    fi
  fi

  # Basic JSON validation
  if ! jq empty "${MANIFEST_FILE}" 2>/dev/null; then
    echo "Error: Manifest file '${MANIFEST_FILE}' is not valid JSON." >&2
    exit 1
  fi

  # Validate template repository source (must be set dynamically at runtime)
  if [[ -z "${TEMPLATE_REPO:-}" ]]; then
    if [[ -n "${CENTRAL_FILE_REPO:-}" ]]; then
      TEMPLATE_REPO="${CENTRAL_FILE_REPO}"
    else
      echo "Error: Central template repository URL must be explicitly provided." >&2
      echo "       Use '-r <url>', '--repo <url>', or set the CENTRAL_FILE_REPO environment variable." >&2
      exit 1
    fi
  fi

  local files_type files_count
  files_type=$(jq -r '.files | type' "${MANIFEST_FILE}" 2>/dev/null || true)
  if [[ "$files_type" != "array" ]]; then
    echo "Error: Manifest must define a '.files' array of mappings." >&2
    exit 1
  fi

  # Security Validation: Enforce strict relative paths and prevent path traversal
  files_count=$(jq '.files | length' "${MANIFEST_FILE}")
  for ((i = 0; i < files_count; i++)); do
    local local_path remote_path
    local_path=$(jq -r ".files[$i].local" "${MANIFEST_FILE}")
    remote_path=$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")

    for p in "${local_path}" "${remote_path}"; do
      if [[ -z "$p" || "$p" == "null" ]]; then
        echo "Error: Manifest path entries cannot be empty or null." >&2
        exit 1
      fi
      if [[ "$p" == /* ]]; then
        echo "Error: Security Violation. Absolute paths are strictly forbidden in manifest: '$p'" >&2
        exit 1
      fi
      if [[ "$p" == *".."* ]]; then
        echo "Error: Security Violation. Path traversal sequences ('..') are strictly forbidden: '$p'" >&2
        exit 1
      fi
      if [[ "$p" == "." || "$p" == "./"* ]]; then
        echo "Error: Security Violation. Current directory segments ('.') are not permitted: '$p'" >&2
        exit 1
      fi
    done
  done
}

# Create sandbox workspace and cleanly clone template repo
clone_template_repo() {
  echo "Preparing secure sandbox workspace..." >&2
  TMP_WORKSPACE=$(mktemp -d -t boilerplate-sync-XXXXXX)
  trap cleanup EXIT

  if [[ "${MODE}" == "push" ]]; then
    echo "Cloning remote template repository (depth 1, full checkout for push)..." >&2
    if ! git clone --depth 1 "${TEMPLATE_REPO}" "${TMP_WORKSPACE}" >/dev/null 2>&1; then
      echo "Error: Failed to clone template repository at '${TEMPLATE_REPO}'." >&2
      echo "       Verify the repository URL and SSH/agent access." >&2
      exit 1
    fi
  else
    echo "Cloning remote template repository with no checkout (depth 1)..." >&2
    # Fetch without checking out files immediately to keep local checkout sparse/lightweight
    if ! git clone --depth 1 --no-checkout "${TEMPLATE_REPO}" "${TMP_WORKSPACE}" >/dev/null 2>&1; then
      echo "Error: Failed to clone template repository at '${TEMPLATE_REPO}'." >&2
      echo "       Verify the repository URL and SSH/agent access." >&2
      exit 1
    fi

    # Identify files we need to checkout
    local files_count i remote_path
    files_count=$(jq '.files | length' "${MANIFEST_FILE}")

    # Pre-resolve remote paths while we are still in the local root directory
    local remote_paths=()
    for ((i = 0; i < files_count; i++)); do
      remote_paths+=("$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")")
    done

    echo "Checking out tracked files sparsely..." >&2
    cd "${TMP_WORKSPACE}"
    for remote_path in "${remote_paths[@]}"; do
      # Force Git to sparse checkout the specific target remote file path
      git checkout HEAD -- "${remote_path}" >/dev/null 2>&1 || true
    done
    cd - >/dev/null
  fi
}

# ==============================================================================
# OPERATIONAL COMMANDS
# ==============================================================================

# Compare local file/directory to remote template and output differences
run_diff() {
  local files_count i local_path remote_path full_remote_path
  files_count=$(jq '.files | length' "${MANIFEST_FILE}")

  echo "=============================================================="
  echo "🔍 COMPARATIVE BLUEPRINT DIFF (Local vs Remote Template)"
  echo "=============================================================="

  local exit_code=0
  for ((i = 0; i < files_count; i++)); do
    local_path=$(jq -r ".files[$i].local" "${MANIFEST_FILE}")
    remote_path=$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")
    full_remote_path="${TMP_WORKSPACE}/${remote_path}"

    if [[ ! -e "${full_remote_path}" ]]; then
      echo "⚠️  [NOT FOUND IN REMOTE] Remote source '${remote_path}' missing in template repo for '${local_path}'."
      exit_code=1
      continue
    fi

    if [[ ! -e "${local_path}" ]]; then
      echo "❌ [MISSING LOCALLY] Local target '${local_path}' does not exist."
      echo "   ---> To retrieve: Run sync-boilerplate.sh --repo <url> --pull"
      exit_code=1
      continue
    fi

    if [[ -d "${local_path}" || -d "${full_remote_path}" ]]; then
      if diff -ru "${local_path}" "${full_remote_path}" >/dev/null; then
        echo "✅ [IN SYNC] '${local_path}' directory is identical to remote boilerplate."
      else
        echo "⚠️  [OUT OF SYNC] '${local_path}' directory has drifted from template:"
        diff -ru "${local_path}" "${full_remote_path}" || true
        exit_code=1
      fi
    else
      if diff -u "${local_path}" "${full_remote_path}" >/dev/null; then
        echo "✅ [IN SYNC] '${local_path}' is identical to remote boilerplate."
      else
        echo "⚠️  [OUT OF SYNC] '${local_path}' has drifted from template:"
        diff -u "${local_path}" "${full_remote_path}" || true
        exit_code=1
      fi
    fi
    echo "--------------------------------------------------------------"
  done

  if [[ "${exit_code}" -eq 0 ]]; then
    echo "🟢 SUCCESS: All configuration and boilerplate files are fully in-sync!"
  else
    echo "🔴 DRIFT DETECTED: Review differences above and run with '--repo <url> --pull' to synchronize."
  fi

  return $exit_code
}

# Pull remote templates to overwrite local workspace files
run_pull() {
  local files_count i local_path remote_path full_remote_path local_dir
  files_count=$(jq '.files | length' "${MANIFEST_FILE}")

  echo "=============================================================="
  echo "📥 PULLING REMOTES (Synchronizing Boilerplate Configuration)"
  echo "=============================================================="

  for ((i = 0; i < files_count; i++)); do
    local_path=$(jq -r ".files[$i].local" "${MANIFEST_FILE}")
    remote_path=$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")
    full_remote_path="${TMP_WORKSPACE}/${remote_path}"

    if [[ ! -e "${full_remote_path}" ]]; then
      echo "⚠️  [SKIPPED] Remote template source '${remote_path}' not found in cloned source."
      continue
    fi

    local_dir=$(dirname "${local_path}")
    if [[ ! -d "${local_dir}" ]]; then
      mkdir -p "${local_dir}"
    fi

    if [[ -d "${full_remote_path}" ]]; then
      # Directory pull logic
      if [[ -e "${local_path}" && ! -d "${local_path}" ]]; then
        echo "🔄 [OVERWRITING] Replacing file '${local_path}' with remote template directory..."
        rm -rf "${local_path}"
      fi

      if [[ -d "${local_path}" ]]; then
        if diff -ru "${local_path}" "${full_remote_path}" >/dev/null; then
          echo "✅ [UP TO DATE] '${local_path}' directory already matches template."
          continue
        fi
        echo "🔄 [OVERWRITING] '${local_path}' directory with remote template..."
        rm -rf "${local_path}"
      else
        echo "➕ [CREATING] '${local_path}' directory from remote template..."
      fi
      mkdir -p "${local_path}"
      cp -r "${full_remote_path}/." "${local_path}/"
    else
      # File pull logic
      if [[ -d "${local_path}" ]]; then
        echo "🔄 [OVERWRITING] Replacing local directory '${local_path}' with file..."
        rm -rf "${local_path}"
      fi

      if [[ -e "${local_path}" ]]; then
        if diff -u "${local_path}" "${full_remote_path}" >/dev/null; then
          echo "✅ [UP TO DATE] '${local_path}' already matches template."
          continue
        fi
        echo "🔄 [OVERWRITING] '${local_path}' with remote template..."
      else
        echo "➕ [CREATING] '${local_path}' from remote template..."
      fi
      cp "${full_remote_path}" "${local_path}"
    fi
  done

  echo "🟢 SUCCESS: Workspace boilerplate sync pull operation completed successfully!"
}

# Push local changes back to update the centralized template repo
run_push() {
  local files_count i local_path remote_path full_remote_path remote_dir
  files_count=$(jq '.files | length' "${MANIFEST_FILE}")

  # Resolve the current local repo name up front while we are still in our local repository
  local local_repo_name
  local_repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" | tr -cd '[:alnum:]_-')

  echo "=============================================================="
  echo "📤 PUSHING LOCAL CHANGES (Updating Central Template Repo)"
  echo "=============================================================="

  local copied_count=0
  for ((i = 0; i < files_count; i++)); do
    local_path=$(jq -r ".files[$i].local" "${MANIFEST_FILE}")
    remote_path=$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")
    full_remote_path="${TMP_WORKSPACE}/${remote_path}"

    if [[ ! -e "${local_path}" ]]; then
      echo "⚠️  [SKIPPED] Local source '${local_path}' does not exist."
      continue
    fi

    # Create directory inside the clone if it doesn't exist
    remote_dir=$(dirname "${full_remote_path}")
    if [[ ! -d "${remote_dir}" ]]; then
      mkdir -p "${remote_dir}"
    fi

    if [[ -d "${local_path}" ]]; then
      # Directory push logic
      if [[ -e "${full_remote_path}" && ! -d "${full_remote_path}" ]]; then
        echo "🔄 [COPYING] Replacing remote file '${full_remote_path}' with directory..."
        rm -rf "${full_remote_path}"
      fi

      if [[ -d "${full_remote_path}" ]] && diff -ru "${local_path}" "${full_remote_path}" >/dev/null; then
        echo "✅ [UP TO DATE] '${local_path}' directory is identical to remote boilerplate."
        continue
      fi

      echo "🔄 [COPYING] '${local_path}' directory into template remote at '${remote_path}'..."
      if [[ -e "${full_remote_path}" ]]; then
        rm -rf "${full_remote_path}"
      fi
      mkdir -p "${full_remote_path}"
      cp -r "${local_path}/." "${full_remote_path}/"
      copied_count=$((copied_count + 1))
    else
      # File push logic
      if [[ -d "${full_remote_path}" ]]; then
        echo "🔄 [COPYING] Replacing remote directory '${full_remote_path}' with file..."
        rm -rf "${full_remote_path}"
      fi

      if [[ -f "${full_remote_path}" ]] && diff -u "${local_path}" "${full_remote_path}" >/dev/null; then
        echo "✅ [UP TO DATE] '${local_path}' is identical to remote boilerplate."
        continue
      fi

      echo "🔄 [COPYING] '${local_path}' into template remote at '${remote_path}'..."
      cp "${local_path}" "${full_remote_path}"
      copied_count=$((copied_count + 1))
    fi
  done

  if [[ "${copied_count}" -eq 0 ]]; then
    echo "🟢 All files are already up-to-date in the central repository. Nothing to push."
    return 0
  fi

  # Committing and pushing changes inside the sandbox workspace
  echo "Committing and pushing changes back to central repository..." >&2
  cd "${TMP_WORKSPACE}"

  local timestamp
  timestamp=$(date +%s)
  local branch_name="sync-update-${local_repo_name}-${timestamp}"

  echo "Creating feature branch '${branch_name}'..." >&2
  git checkout -b "${branch_name}"

  git add -A

  if git diff --cached --quiet; then
    echo "🟢 No diff staged. Nothing to push."
    cd - >/dev/null
    return 0
  fi

  git commit -m "sync: update boilerplate from ${local_repo_name}" -s

  echo "Pushing branch '${branch_name}' securely using your Git credentials..." >&2
  if ! git push origin "${branch_name}"; then
    echo "❌ ERROR: Git push failed. Verify write permissions to the central repository."
    cd - >/dev/null
    exit 1
  fi

  echo "Creating Pull Request on GitHub..." >&2
  local default_branch
  if ! default_branch=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null); then
    echo "⚠️  Warning: Failed to dynamically retrieve default branch. Falling back to 'main'." >&2
    default_branch="main"
  fi

  if gh pr create --title "sync: update boilerplate from ${local_repo_name}" \
                  --body "Automated boilerplate synchronization from repository \`${local_repo_name}\`." \
                  --head "${branch_name}" \
                  --base "${default_branch}"; then
    echo "🟢 SUCCESS: Successfully created Pull Request for boilerplate updates!"
  else
    echo "❌ ERROR: GitHub PR creation failed. Please check your GitHub permissions/token."
    cd - >/dev/null
    exit 1
  fi

  cd - >/dev/null
}

# Display compact status of files tracked
run_status() {
  local files_count i local_path remote_path full_remote_path
  files_count=$(jq '.files | length' "${MANIFEST_FILE}")

  printf "%-40s %-40s %s\n" "LOCAL WORKSPACE FILE" "REMOTE TEMPLATE FILE" "SYNC STATUS"
  printf "%-40s %-40s %s\n" "--------------------" "--------------------" "-----------"

  for ((i = 0; i < files_count; i++)); do
    local_path=$(jq -r ".files[$i].local" "${MANIFEST_FILE}")
    remote_path=$(jq -r ".files[$i].remote" "${MANIFEST_FILE}")
    full_remote_path="${TMP_WORKSPACE}/${remote_path}"

    local status="UNKNOWN"
    if [[ ! -e "${full_remote_path}" ]]; then
      status="MISSING IN REMOTE"
    elif [[ ! -e "${local_path}" ]]; then
      status="MISSING LOCALLY"
    else
      local has_diff=0
      if [[ -d "${local_path}" || -d "${full_remote_path}" ]]; then
        if ! diff -ru "${local_path}" "${full_remote_path}" >/dev/null; then
          has_diff=1
        fi
      else
        if ! diff -u "${local_path}" "${full_remote_path}" >/dev/null; then
          has_diff=1
        fi
      fi

      if [[ "${has_diff}" -eq 0 ]]; then
        status="IN SYNC"
      else
        status="OUT OF SYNC"
      fi
    fi

    printf "%-40s %-40s %s\n" "${local_path}" "${remote_path}" "${status}"
  done
}

# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        MODE="help"
        shift
        ;;
      -d|--diff)
        MODE="diff"
        shift
        ;;
      -p|--pull)
        MODE="pull"
        shift
        ;;
      -u|--push)
        MODE="push"
        shift
        ;;
      -s|--status)
        MODE="status"
        shift
        ;;
      -r|--repo)
        if [[ $# -lt 2 || -z "$2" ]]; then
          echo "Error: Option '$1' requires a non-empty repository URL argument." >&2
          exit 1
        fi
        TEMPLATE_REPO="$2"
        shift 2
        ;;
      *)
        echo "Error: Unknown option '$1'" >&2
        show_help >&2
        exit 1
        ;;
    esac
  done

  if [[ "${MODE}" == "help" ]]; then
    show_help
    exit 0
  fi

  # Execute operation
  validate_environment
  clone_template_repo

  case "${MODE}" in
    diff)
      run_diff
      ;;
    pull)
      run_pull
      ;;
    push)
      run_push
      ;;
    status)
      run_status
      ;;
  esac
}

main "$@"
