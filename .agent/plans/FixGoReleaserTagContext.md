# Plan: Fix GoReleaser Tag Context

**Executed Date:** 2026-07-30
**Purpose:** Update `.github/workflows/scripts/prepare-release-dir.sh` to ensure GoReleaser can correctly identify the current local tag (preventing `untagged` releases) and compare against previous tags (preventing full-history changelogs).

## Background & Motivation
The manual release workflow uses `actions/checkout` to clone the code into a subfolder (`tags/${TAG}`) for GoReleaser. However, `actions/checkout` in detached HEAD state does not automatically map the local git tag to the HEAD commit file reference. As a result, GoReleaser fails to determine the version context and defaults to creating a draft release named `untagged-*`. 

Additionally, the `prepare-release-dir.sh` script previously contained a destructive cleanup block that aggressively deleted all local tags except the target release tag. This stripped away all historical tags (e.g., `v2.4.15`), leaving GoReleaser with no baseline to compare against. Assuming it was the very first release, GoReleaser compiled an exhaustive changelog of every commit since the beginning of the repository.

## Proposed Solution
We will update `.github/workflows/scripts/prepare-release-dir.sh` to properly provision the local Git environment for GoReleaser. First, we will remove the destructive tag-deletion block. Second, we will fetch all remote tags from origin to guarantee GoReleaser has a healthy historical baseline for changelog calculation. Finally, we will explicitly run `git tag "${TAG}" HEAD -f` to locally bind the tag to the HEAD commit. This action is purely local and ephemeral to the runner, but completely satisfies GoReleaser's version detection logic.

## Implementation Steps

1. **Update `prepare-release-dir.sh`:**
   * Remove the `tags_to_delete` variable and its associated `xargs git tag -d` execution block.
   * Inject a command to fetch all tags from the origin repository.
   * Inject a command to forcefully tag `HEAD` with the `$TAG` environment variable.

## Verification & Testing
1. Run `shellcheck` on `.github/workflows/scripts/prepare-release-dir.sh` to verify syntax and style compliance.
