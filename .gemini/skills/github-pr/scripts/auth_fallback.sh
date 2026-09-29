#!/usr/bin/env bash

# Ensure script is sourced, not executed directly in a subshell
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Error: auth_fallback.sh must be sourced to modify the calling environment." >&2
  # shellcheck disable=SC2813,SC2317
  return 1 2>/dev/null || exit 1
  # return is valid because this file is sourced rather than executed as a script
fi

_github_auth_fallback() {
  local token_fingerprint="${GH_TOKEN:-}:${GITHUB_TOKEN:-}:${GITHUB_ENTERPRISE_TOKEN:-}"

  if [[ -z "${GH_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" && -z "${GITHUB_ENTERPRISE_TOKEN:-}" ]]; then
    return 0
  fi

  # Skip re-verification if these tokens were already validated in the current environment
  if [[ "${_GH_AUTH_VALIDATED_TOKEN:-}" == "${token_fingerprint}" ]]; then
    return 0
  fi

  # If tokens are set, verify they work. If not, unset them so gh falls back to stored credentials.
  if command -v gh >/dev/null 2>&1; then
    if ! gh auth status >/dev/null 2>&1; then
      unset -v GH_TOKEN GITHUB_TOKEN GITHUB_ENTERPRISE_TOKEN _GH_AUTH_VALIDATED_TOKEN
    else
      export _GH_AUTH_VALIDATED_TOKEN="${token_fingerprint}"
    fi
  fi
}

_github_auth_fallback
unset -f _github_auth_fallback
