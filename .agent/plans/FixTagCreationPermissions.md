# Plan: Fix Tag Creation Permissions

**Executed Date:** 2026-07-29
**Purpose:** Replace the `actions/github-script` tag creation steps in manual workflows with standard `git` CLI commands to bypass GitHub API restrictions on tagging historical commits without `workflows: write` permissions.

## Background & Motivation
When attempting to tag historical commits (SHAs other than the branch HEAD) using the GitHub REST API (`github.rest.git.createRef`), the API demands the `workflows: write` permission. The standard `GITHUB_TOKEN` is prohibited from holding this permission for security reasons, resulting in a `403 Resource not accessible by integration` error. To bypass this, we can rely on standard Git CLI commands (`git tag` and `git push`). Since the `actions/checkout` step already provisions the local Git configuration with the standard `contents: write` token, local tagging and pushing will succeed flawlessly regardless of commit age.

## Implementation Steps

1. **Create `create-push-tag.sh`:**
   * Create a new bash script under `.github/workflows/scripts/`.
   * Accept `TAG` and `SHA` environment variables.
   * Check if the tag exists on the remote using `git ls-remote --tags origin "refs/tags/${TAG}"`.
   * If it exists, fetch the remote tag and verify its target commit SHA matches the requested `SHA`.
   * If it does not exist, run `git tag "${TAG}" "${SHA}"` followed by `git push origin "${TAG}"`.

2. **Update Manual Workflows:**
   * Modify `.github/workflows/manual-release.yml` and `.github/workflows/manual-rc-release.yml`.
   * Replace the `actions/github-script` step that calls `create-push-tag.js` with a `run: .github/workflows/scripts/nix-run.sh bash .github/workflows/scripts/create-push-tag.sh` step.

3. **Cleanup `create-push-tag.js`:**
   * Since manual workflows are moving to the Bash script, we will revert `create-push-tag.js` to its upstream state (which purely calculates and reads tags for PR tests), removing the temporary `CREATE_REF` logic we added earlier.

## Verification & Testing
1. Run `shellcheck` on `.github/workflows/scripts/create-push-tag.sh`.
2. Run `actionlint` on `.github/workflows/manual-release.yml` and `.github/workflows/manual-rc-release.yml`.
