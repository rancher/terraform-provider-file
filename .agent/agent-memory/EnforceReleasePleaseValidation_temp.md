# Temporary Plan: Enforce Release Please Output Validation

**Executed Date:** 2026-07-29
**Purpose:** Prevent silent failures by enforcing that the `release-please` job in `.github/workflows/release.yml` fails if it does not create a release or a pull request.

## Checklist

- [x] Add `Verify Release Please Action` step immediately after the `Release Please` step in `.github/workflows/release.yml`.
- [x] Implement `bash` script in the step to check `RELEASE_CREATED` and `PR` environment variables (using appropriate manifest path fallbacks), and exit with `1` if both are empty/false.
- [x] Run `actionlint` to ensure valid YAML structure.
