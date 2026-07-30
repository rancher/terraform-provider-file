# Temporary Plan: Fix Manual GoReleaser Config

**Executed Date:** 2026-07-30
**Purpose:** Create a dedicated GoReleaser configuration for the `manual-release.yml` workflow to prevent failures caused by missing release note files.

## Checklist

- [x] Copy `.goreleaser.yml` to `.goreleaser_manual.yml`.
- [x] In `.goreleaser_manual.yml`, remove `use_existing_draft: true` and `release_notes_file: /tmp/release-notes.md` from the `release` block.
- [x] Update `.github/workflows/manual-release.yml` to set `GORELEASER_CONFIG: ../../.goreleaser_manual.yml` in the `Run GoReleaser` step.
- [x] Run `actionlint` locally to verify the updated workflow YAML syntax.
