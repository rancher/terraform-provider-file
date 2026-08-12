#!/usr/bin/env bash
#
# Helper: nix-run.sh
# Description: Executes a command inside the Nix development environment safely with a clean git tree and retry mechanisms.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

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

# Write the temporary script execution file to the system /tmp/ directory
# instead of the repository root, ensuring the Git working tree remains 100% clean under all conditions.
# Using the process ID ($$) prevents parallel execution collisions.
SCRIPT_FILE="/tmp/.nix-script-$$.sh"

{
  echo "git config --global --add safe.directory \"$PWD\""
  printf "%s\n" "$*"
} > "${SCRIPT_FILE}"

trap 'rm -f "${SCRIPT_FILE}"' EXIT

# Ensure the suse user has access to read the temporary script
chmod a+r "${SCRIPT_FILE}" 2>/dev/null || true

# Ensure the suse user can read/write the current directory
chown -R suse:suse . || true

# Ensure parent directories are traversable by the suse user
p="$PWD"
while [[ "${p}" != "/" && -n "${p}" ]]; do
  chmod a+rx "${p}" 2>/dev/null || true
  p="$(dirname "${p}")"
done

# Run the command inside 'nix develop' with an automated retry loop (up to 3 attempts)
# and exponential backoff to smoothly handle any upstream Nix network glitches or 503 outages.
max_attempts=3
attempt=1
success=false

while [[ ${attempt} -le ${max_attempts} ]]; do
  echo "Executing nix develop (Attempt ${attempt}/${max_attempts})..."
  if sudo -E -u suse /home/suse/.nix-profile/bin/nix develop \
    --extra-experimental-features nix-command \
    --extra-experimental-features flakes \
    --command bash -e "${SCRIPT_FILE}"; then
    success=true
    break
  else
    echo "Warning: nix develop execution failed (Attempt ${attempt}/${max_attempts})." >&2
    if [[ ${attempt} -lt ${max_attempts} ]]; then
      # Exponential backoff delay (2s, 4s)
      delay=$((2 ** attempt))
      echo "Retrying in ${delay} seconds..." >&2
      sleep ${delay}
    fi
    attempt=$((attempt + 1))
  fi
done

if [[ "${success}" == "false" ]]; then
  echo "Error: nix develop failed after ${max_attempts} attempts." >&2
  exit 1
fi
