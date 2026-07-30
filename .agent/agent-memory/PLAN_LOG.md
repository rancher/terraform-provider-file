# Plan Log

## WorkflowStandards
- **Date:** 2026-07-20
- **Purpose:** Update all workflows to have a standard step structure, extract all scripts so they can be linted, use commit hashes for action versioning, and implement least privilege security principle.

## ScaffoldAgenticEnvironment
- **Date:** 2026-07-14
- **Purpose:** Provide a reproducible blueprint for scaffolding a unified, cross-platform AI agentic environment in any new or existing repository.

## ReleaseFromMain
- **Date:** 2026-07-16
- **Purpose:** Update the release workflows and scripts so that the repository releases directly from the `main` branch instead of relying on `release/v*` branches. This simplifies the release strategy and aligns with a trunk-based development approach.

## FixTagCreationPermissions
- **Date:** 2026-07-29
- **Purpose:** Replace the `actions/github-script` tag creation steps in manual workflows with standard `git` CLI commands to bypass GitHub API restrictions on tagging historical commits without `workflows: write` permissions.

## FixSkippedFullRelease
- **Date:** 2026-07-29
- **Purpose:** Ensure the Full Release job triggers properly when a release pull request is merged by correctly capturing the `release_created` output from the `release-please` action in manifest mode.

## FixManualWorkflowTagCreation
- **Date:** 2026-07-29
- **Purpose:** Update `.github/workflows/scripts/create-push-tag.js` to correctly handle pre-existing tags (with SHA validation) and re-introduce optional tag creation for manual workflows using a `CREATE_REF` environment variable.

## FixManualReleaseWorkflows
- **Date:** 2026-07-29
- **Purpose:** Resolve the `ERR_MODULE_NOT_FOUND` error in `manual-release.yml` and `manual-rc-release.yml` by ensuring the repository is checked out before any script execution steps are run.

## FixManualGoReleaserConfig
- **Date:** 2026-07-30
- **Purpose:** Create a dedicated GoReleaser configuration for the `manual-release.yml` workflow to prevent failures caused by missing release note files.

## FixGoReleaserGPGMismatch
- **Date:** 2026-07-29
- **Purpose:** Resolve the release workflow failure (`gpg: error reading key: No secret key`) caused by GPG_KEY_ID pointing to an encryption-only subkey or being mismatched with the imported primary secret signing key.

## FixGoReleaserAndGPG
- **Date:** 2026-07-28
- **Purpose:** Fix the GoReleaser release workflow failure caused by an invalid `GPG_KEY_ID` lookup and remove broken references to deleted `.sh` files in the GitHub Actions workflows.

## EnforceReleasePleaseValidation
- **Date:** 2026-07-29
- **Purpose:** Prevent silent failures by enforcing that the `release-please` job in `.github/workflows/release.yml` fails if it does not create a release or a pull request.

## ContextLimitEnforcementHook
- **Date:** 2026-07-14
- **Purpose:** Implement a generic CLI hook in `.agent/hooks/` to automatically monitor and enforce context limits (e.g., 200,000 tokens) for agents like Gemini and Claude, preventing them from exceeding maximum token sizes and degrading performance.

## ConsolidateWorkflowScripts
- **Date:** 2026-07-22
- **Purpose:** Consolidate redundant workflow scripts (such as tag creation and commenting), fix a critical unit-testing script naming bug in the PR workflow, and normalize all bash and javascript files to comply with repository standard styles (using double brackets `[[ ]]`, `set -euo pipefail`, explicit error redirection to stderr, `try/catch` wrapping, and paginate).

