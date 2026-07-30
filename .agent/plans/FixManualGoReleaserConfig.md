# Plan: Fix Manual GoReleaser Config

**Executed Date:** 2026-07-30
**Purpose:** Create a dedicated GoReleaser configuration for the `manual-release.yml` workflow to prevent failures caused by missing release note files.

## Background & Motivation
The `manual-release.yml` workflow has been failing during the `Run GoReleaser` step. The standard `.goreleaser.yml` configuration includes `release_notes_file: /tmp/release-notes.md`. In automated release runs, the `release-please` action generates this file before GoReleaser is invoked. However, in a manual run, `release-please` is skipped, the file does not exist, and GoReleaser aborts the build.

## Proposed Solution
We will create a specific `.goreleaser_manual.yml` configuration file specifically for the manual release workflow. This file will be identical to `.goreleaser.yml` but will omit the `release_notes_file` and `use_existing_draft` directives. This will allow GoReleaser to successfully build, sign, and draft the release using its default, automatic git-log changelog generation.

## Implementation Steps

1. **Create `.goreleaser_manual.yml`:**
   * Duplicate `.goreleaser.yml`.
   * Under the `release:` block, remove `use_existing_draft: true` and `release_notes_file: /tmp/release-notes.md`.
2. **Update `manual-release.yml`:**
   * Modify the `Run GoReleaser` step's environment variables.
   * Change `GORELEASER_CONFIG: ../../.goreleaser.yml` to `GORELEASER_CONFIG: ../../.goreleaser_manual.yml`.

## Verification & Testing
1. Run `actionlint` on `.github/workflows/manual-release.yml` to ensure YAML correctness.
