#!/usr/bin/env bash

# create-push-tag.sh - Create and push a git tag to remote repository.
# Conforms to shell-scripts.instructions.md guidelines.

set -euo pipefail

if [[ -z "${TAG:-}" ]]; then
  echo "Error: TAG environment variable is required." >&2
  exit 1
fi

if [[ -z "${SHA:-}" ]]; then
  echo "Error: SHA environment variable is required." >&2
  exit 1
fi

# Configure git identity for Actions bot
git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.github.com"

echo "Checking if tag ${TAG} exists..."
# Check if the tag exists locally or on the remote origin
if git rev-parse "refs/tags/${TAG}" >/dev/null 2>&1 || (git ls-remote --tags origin 2>/dev/null | grep -q "refs/tags/${TAG}"); then
  echo "Tag ${TAG} already exists (locally or on remote). Verifying commit SHA..."
  
  # Quietly fetch the tag ref from remote if we don't have it locally or to ensure it's up to date
  git fetch origin "refs/tags/${TAG}:refs/tags/${TAG}" --depth=1 --no-tags --quiet || true
  
  existing_sha=$(git rev-list -n 1 "${TAG}")
  target_sha=$(git rev-list -n 1 "${SHA}")
  
  if [[ "${existing_sha}" != "${target_sha}" ]]; then
    echo "Error: Tag ${TAG} exists pointing to commit ${existing_sha}, but requested SHA is ${target_sha}. Mismatch!" >&2
    exit 1
  else
    echo "Success: Existing tag SHA matches requested SHA (${target_sha}). Proceeding gracefully."
  fi
else
  echo "Tag ${TAG} does not exist. Creating tag locally pointing to ${SHA}..."
  git tag "${TAG}" "${SHA}"
  
  echo "Pushing tag ${TAG} to origin..."
  git push origin "${TAG}"
  echo "Successfully created and pushed tag ${TAG}."
fi
