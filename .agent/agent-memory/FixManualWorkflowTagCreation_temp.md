# Temporary Plan: Fix Manual Workflow Tag Creation

**Executed Date:** 2026-07-29
**Purpose:** Update `.github/workflows/scripts/create-push-tag.js` to correctly handle pre-existing tags (with SHA validation) and re-introduce optional tag creation for manual workflows using a `CREATE_REF` environment variable.

## Checklist

- [x] Modify `.github/workflows/scripts/create-push-tag.js`:
  - Enhance `tagExists` block: If tag exists, compare the remote tag's object SHA to the provided `sha`. Fail if they differ. If they match, skip creation and continue.
  - Re-add `github.rest.git.createRef` logic.
  - Wrap `createRef` in `if (process.env.CREATE_REF === 'true')`.
- [x] Modify `.github/workflows/manual-release.yml` to inject `CREATE_REF: 'true'` into the `Create and Push Tag via API` step.
- [x] Modify `.github/workflows/manual-rc-release.yml` to inject `CREATE_REF: 'true'` into the `Create and Push RC Tag via API` step.
- [x] Validate JavaScript changes visually for logic errors.
- [x] Run `actionlint` locally to verify YAML workflow changes.
