# Temporary Plan: Fix GoReleaser Tag Context

**Executed Date:** 2026-07-30
**Purpose:** Update `.github/workflows/scripts/prepare-release-dir.sh` to ensure GoReleaser can correctly identify the current local tag (preventing `untagged` releases) and compare against previous tags (preventing full-history changelogs).

## Checklist

- [x] Modify `.github/workflows/scripts/prepare-release-dir.sh`:
  - Remove the block of code that deletes local tags (`git tag | grep -v ... | xargs git tag -d`).
  - Add `git fetch --tags origin || true` to guarantee all historical tags are present locally for GoReleaser's changelog boundaries.
  - Add `git tag "${TAG}" HEAD -f` to explicitly materialize the local tag reference so GoReleaser knows exactly what version it is building.
- [x] Ensure the script remains compliant with `shellcheck` standards.
