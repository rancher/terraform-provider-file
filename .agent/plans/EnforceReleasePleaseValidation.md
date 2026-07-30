# Plan: Enforce Release Please Output Validation

**Executed Date:** 2026-07-29
**Purpose:** Prevent silent failures by enforcing that the `release-please` job in `.github/workflows/release.yml` fails if it does not create a release or a pull request.

## Background & Motivation
Currently, `release-please-action` can encounter states where it safely aborts without taking any action (e.g., "There are untagged, merged release PRs outstanding - aborting"). Because it exits with a successful `0` status code, the GitHub Actions pipeline displays a green checkmark, hiding the fact that releases and changelogs are completely stalled. Given the strict Conventional Commits enforcement in this repository, any push to `main` must result in either a new release (if the release PR was merged) or an updated release PR (if any other PR was merged).

## Implementation Steps

1. **Add Validation Step:**
   * Append a new step named `Verify Release Please Action` directly after the `Release Please` step in the `release-please` job in `.github/workflows/release.yml`.
   * Capture the `release_created` and `pr` outputs into environment variables, utilizing the `||` operator to accommodate manifest-mode outputs (`.--release_created` and `.--pr`).
   * Write a short inline bash script that verifies at least one of these variables is populated. If both evaluate to false or empty, echo an explanatory error message and `exit 1`.

## Verification & Testing
1. Run `actionlint` locally to guarantee the step syntax and workflow YAML remain valid.
