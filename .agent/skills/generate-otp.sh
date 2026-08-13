#!/usr/bin/env bash
#
# Skill: generate-otp.sh
# Description: Generates a secure, cryptographically random One-Time Pad (OTP) token.
#              Writes the token safely to disk with strict 0600 permissions and outputs the token.
# Conforms to shell-scripts.instructions.md guidelines.
# Usage:
#   OTP_TOKEN=$(bash .agent/skills/generate-otp.sh)

set -euo pipefail

# Helper to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Display script help usage instructions
show_help() {
  cat <<EOF
Usage: generate-otp.sh [options]

Generates a secure, cryptographically random 16-byte (32-character) One-Time Pad (OTP) token.
The token is securely saved to ~/.gemini/tmp/terraform-provider-file/active-otp.token with 0600 permissions.
The generated token hex string is printed directly to standard output.

Options:
  -h, --help           Show this message and exit.

Examples:
  OTP_TOKEN=\$(bash .agent/skills/generate-otp.sh)
EOF
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        echo "Error: Unknown argument '$1'" >&2
        show_help >&2
        exit 1
        ;;
    esac
  done

  if ! command_exists openssl; then
    echo "Error: 'openssl' utility is required for secure random generation. Please install openssl." >&2
    exit 1
  fi

  local target_dir="$HOME/.gemini/tmp/terraform-provider-file"
  local token_file="${target_dir}/active-otp.token"

  # Generate 16 bytes of cryptographically secure randomness
  local otp_token
  otp_token=$(openssl rand -hex 16)

  # Create directories safely
  mkdir -p "$target_dir"

  # Securely delete any existing file or symbolic link to prevent symlink traversal/overwrites
  rm -f "$token_file"

  # Write the OTP file securely with highly restrictive umask 077 (0600 permissions)
  (
    umask 077
    echo "$otp_token" > "$token_file"
  )

  # Output the token string natively to stdout so calling scripts can bind it to a variable
  echo "$otp_token"
}

main "$@"
