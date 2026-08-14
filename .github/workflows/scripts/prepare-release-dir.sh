#!/usr/bin/env bash
set -euo pipefail

# Cache starting directory
START_DIR="$(pwd)"

cd "${WORKSPACE}/tags/${TAG}"

# Fetch all tags from the remote origin so GoReleaser can find the previous tag for changelogs
echo "Fetching all tags from remote origin..."
git fetch origin --tags --quiet || true

# Force tag HEAD with the current release tag locally so GoReleaser knows exactly what version it is building
echo "Locally tagging HEAD with ${TAG}..."
git tag "${TAG}" HEAD -f

# Ensure manifest exists for the registry
if [[ ! -f "terraform-registry-manifest.json" ]]; then
  echo "terraform-registry-manifest.json not found, creating a default one."
  cat <<EOF >terraform-registry-manifest.json
{
    "version": 1,
    "metadata": {
        "protocol_versions": ["4.0", "5.0", "6.0"]
    }
}
EOF
fi

cd "${START_DIR}"
