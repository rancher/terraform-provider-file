# Temporary Plan: Fix Tag Creation Permissions

**Executed Date:** 2026-07-29
**Purpose:** Replace the `actions/github-script` tag creation steps in manual workflows with standard `git` CLI commands to bypass GitHub API restrictions on tagging historical commits without `workflows: write` permissions.

## Checklist

- [x] Write a new Bash script `.github/workflows/scripts/create-push-tag.sh` that uses `git ls-remote` and `git push origin <tag>` to create/verify tags.
- [x] Ensure the script enforces the same pre-existing tag SHA validation rules as the Javascript version.
- [x] Replace the `Create and Push Tag via API` step in `.github/workflows/manual-release.yml` with a step executing the new bash script.
- [x] Replace the `Create and Push RC Tag via API` step in `.github/workflows/manual-rc-release.yml` with a step executing the new bash script.
- [x] Revert `create-push-tag.js` back to its original state (as it was after PR #354) since manual workflows will no longer use it for tag creation.
- [x] Run `shellcheck` on the new bash script.
- [x] Run `actionlint` on the updated YAML workflows.
