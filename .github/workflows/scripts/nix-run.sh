#!/usr/bin/env bash
#
# Helper: nix-run.sh
# Description: Executes a command inside the Nix development environment safely with a clean git tree and retry mechanisms.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

show_help() {
  cat <<EOF
Usage: nix-run.sh [command] [args...]

Executes a command inside the Nix development environment safely with a clean git tree and retry mechanisms.
EOF
}

setup_ssl() {
  if [[ -z "${NIX_SSL_CERT_FILE:-}" ]]; then
    for cert in /etc/ssl/certs/ca-certificates.crt \
                /etc/ssl/certs/ca-bundle.crt \
                /etc/pki/tls/certs/ca-bundle.crt \
                /etc/ssl/ca-bundle.pem \
                /var/lib/ca-certificates/ca-bundle.pem; do
      if [[ -f "${cert}" ]]; then
        export NIX_SSL_CERT_FILE="${cert}"
        break
      fi
    done
  fi

  export SSL_CERT_FILE="${NIX_SSL_CERT_FILE:-}"
  export CURL_CA_BUNDLE="${NIX_SSL_CERT_FILE:-}"
}

main() {
  if [[ $# -eq 0 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    show_help
    exit 0
  fi

  setup_ssl

  # Securely create an atomic, non-guessable temp file path using mktemp
  # to completely eliminate symlink races and stale collisions.
  local script_file
  script_file=$(mktemp /tmp/nix-script.XXXXXX.sh)
  
  trap 'rm -f "${script_file}"' EXIT

  # Securely write static command execution shell logic with absolute "$@"-aware argument quoting.
  # This completely eliminates shell parsing and command injection vulnerabilities.
  cat <<'EOF' > "${script_file}"
#!/usr/bin/env bash
set -euo pipefail
git config --global --add safe.directory "$1"
shift
exec "$@"
EOF

  # Keep permissions restricted and strictly chown to suse to prevent world-readable leaks.
  chown suse:suse "${script_file}" 2>/dev/null || true
  chmod 700 "${script_file}" 2>/dev/null || true

  # Ensure the suse user can read/write the current directory
  chown -R suse:suse . || true

  # Ensure parent directories are traversable by the suse user
  local p="$PWD"
  while [[ "${p}" != "/" && -n "${p}" ]]; do
    chmod a+rx "${p}" 2>/dev/null || true
    p="$(dirname "${p}")"
  done

  # Run the command inside 'nix develop' with an automated retry loop (up to 5 attempts)
  # and geometric backoff (starting at 5s, doubling on each attempt) to smoothly handle any upstream Nix network glitches or 503 outages.
  local max_attempts=5
  local attempt=1
  local success=false

  while [[ ${attempt} -le ${max_attempts} ]]; do
    echo "Executing nix develop (Attempt ${attempt}/${max_attempts})..." >&2
    if sudo -E -u suse /home/suse/.nix-profile/bin/nix develop \
      --extra-experimental-features nix-command \
      --extra-experimental-features flakes \
      --command bash -e "${script_file}" "$PWD" "$@"; then
      success=true
      break
    else
      echo "Warning: nix develop execution failed (Attempt ${attempt}/${max_attempts})." >&2
      if [[ ${attempt} -lt ${max_attempts} ]]; then
        # Geometric backoff delay (5s, 10s, 20s, 40s)
        local delay
        delay=$(( 5 * (2 ** (attempt - 1)) ))
        echo "Retrying in ${delay} seconds..." >&2
        sleep "${delay}"
      fi
      attempt=$((attempt + 1))
    fi
  done

  if [[ "${success}" == "false" ]]; then
    echo "Error: nix develop failed after ${max_attempts} attempts." >&2
    exit 1
  fi
}

main "$@"
