#!/usr/bin/env bash
set -euo pipefail

# Check commit messages
# This steps enforces https://www.conventionalcommits.org/en/v1.0.0/
# This format enables automatic generation of changelogs and versioning

# Match standard Conventional Commits regex:
# Type: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
# Scope: optional, e.g. (ci)
# Exclamation: optional, e.g. !
# Followed by ': '
CONVENTIONAL_RE='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?(!?): .+$'
# Merge commits are also allowed
MERGE_RE='^Merge '

validate_message_prefix() {
  local message="$1"
  local affects_product="$2"

  if [[ "${message}" =~ ${MERGE_RE} ]]; then
    echo "...Commit message is an allowed Merge commit."
    return 0
  fi

  if [[ ! "${message}" =~ ${CONVENTIONAL_RE} ]]; then
    cat <<EOF >&2
...Commit message does not follow the Conventional Commits format.
Format required: "type: description" or "type(scope): description"
Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
Your message: "$message"
EOF
    exit 1
  fi

  # Extract type and exclamation indicator from regex match
  local type="${BASH_REMATCH[1]}"
  local has_exclamation="${BASH_REMATCH[3]}"

  # Enforce strict product-boundary check for semver safety (non-product changes cannot use feat, refactor, or !)
  if [[ "${affects_product}" == "false" ]]; then
    if [[ "${type}" == "feat" || "${type}" == "refactor" || -n "${has_exclamation}" ]]; then
      cat <<EOF >&2
Error: PR contains only non-product changes (outside the 'internal/' folder).
Commit message: "$message"
For non-product changes, you MUST NOT use "feat" or "refactor" types, and you MUST NOT use the "!" breaking-change indicator (as they incorrectly trigger minor/major semver bumps).
Please use "chore", "ci", "docs", "style", "test", or "fix" instead.
EOF
      exit 1
    fi
  fi
  echo "...Commit message starts with the required conventional prefix."
}

empty_check() {
  local message="$1"
  if [[ -z "${message}" ]]; then
    echo "Error: Empty commit message." >&2
    exit 1
  else
    echo "...Commit message is not empty."
  fi
}

length_check() {
  local message="$1"
  local length
  length=$(wc -m <<<"${message}")
  # Strip whitespaces if any from wc output
  length=$(echo "${length}" | tr -d '[:space:]')
  if [[ "${length}" -gt 100 ]]; then
    echo "Error: Commit message subject line should be less than 100 characters, found ${length}." >&2
    exit 1
  else
    echo "...Commit message subject line is less than 100 characters."
  fi
}

spell_check() {
  local message="$1"
  if [[ "${message}" =~ ${MERGE_RE} ]]; then
    return 0
  fi
  local words
  words=$(cspell stdin --quiet --words-only <<<"${message}" || true)
  if [[ -n "${words}" ]]; then
    cat <<EOF >&2
...Commit message contains spelling errors on: ^${words}\$
...Also try updating the PR title.
...If this is a mistake, add your word to the custom_words.txt file.
EOF
    exit 1
  else
    echo "...Commit message does not contain spelling errors."
  fi
}

# Fetch the commit messages
if [[ -z "${PR_NUMBER:-}" ]]; then
  echo "Error: PR_NUMBER is not set." >&2
  exit 1
fi

COMMIT_MESSAGES=$(GITHUB_TOKEN= gh pr view "${PR_NUMBER}" --json commits | jq -r '.commits[].messageHeadline')
echo "Commit messages found: "
echo "${COMMIT_MESSAGES}"

# Evaluate if PR contains any product-bumping files (in 'internal/')
# We fetch main relative to origin/main, fallback to true if origin/main is missing
affects_product=true
if git rev-parse origin/main >/dev/null 2>&1; then
  # Use three-dot diff to check changed file names in this branch compared to main
  if ! git diff --name-only origin/main... | grep -q -E "^internal/"; then
    affects_product=false
  fi
fi
echo "PR affects product (files in 'internal/'): ${affects_product}"

while read -r message; do
  if [[ -z "${message}" ]]; then
    continue
  fi
  echo "checking message ^${message}\$"
  empty_check "${message}"
  validate_message_prefix "${message}" "${affects_product}"
  length_check "${message}"
  spell_check "${message}"
  echo "message ^${message}\$ passed all checks"
done <<< "${COMMIT_MESSAGES}"
