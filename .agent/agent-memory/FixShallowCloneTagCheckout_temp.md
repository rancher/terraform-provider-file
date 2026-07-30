# Temporary Plan: Fix Shallow Clone in Tag Checkout

**Executed Date:** 2026-07-30
**Purpose:** Prevent GoReleaser from creating `untagged` releases by ensuring the `Checkout New Tag` step clones the repository with its complete git tag history.

## Checklist

- [x] Modify `.github/workflows/manual-release.yml`: Add `fetch-depth: 0` to the `Checkout New Tag` step.
- [x] Modify `.github/workflows/manual-rc-release.yml`: Add `fetch-depth: 0` to the `Checkout New Tag` step.
- [x] Run `actionlint` locally to verify the updated workflow YAML syntax.
