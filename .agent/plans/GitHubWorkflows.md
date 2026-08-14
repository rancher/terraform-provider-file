# Plan: GitHub Workflows Standardization & Architectural Blueprint

**Executed Date:** pending
**Purpose:** Establish a single, unified architectural blueprint for GitHub Workflows and automated scripts in this repository. This plan consolidates redundant scripts (merging tag creation into Node.js API), introduces ESLint verification for workflow scripts, establishes native Node.js unit tests for JavaScript workflow scripts, cleans up outdated plan sprawl, and prepares the repository for robust, secure, and easily maintainable automations.

---

# Architectural Blueprint & Specification

## 1. Workflow Architecture & Best Practices

To ensure high maintainability, security, and velocity, all GitHub Workflows in this repository MUST comply with the following architectural rules:

### A. Orchestrate, Don't Execute
Workflows should act as orchestrators, not execution scripts. 
* All non-trivial logic (e.g., git tagging, GPG lookup, maintainer checks, PR verification) must live in external scripts inside the `.github/workflows/scripts/` directory.
* Workflows must call these external scripts using the Nix environment (`.github/workflows/scripts/nix-run.sh`) or native `actions/github-script` runners.

### B. Security & Least Privilege
* **Top-Level Scopes:** Every workflow MUST have `permissions: {}` defined at the top-level.
* **Job-Level Permissions:** Each job MUST define explicit, minimal `permissions` required for its operation (e.g., `contents: read`, `pull-requests: write`).
* **Pin Actions by SHA:** All GitHub Actions must be pinned to a full 40-character commit SHA (not a tag). Include a release URL comment on the line before `uses:` (e.g., `# https://github.com/actions/checkout/releases`).
* **Safe Input Handling:** Never inline untrusted inputs (like PR titles or branches) directly into run commands. Always assign them to environment variables first.

### C. Validation & Linters
* All scripts and workflows must be statically validated in the PR verification workflow (`pull_request.yaml`).
* Linter suite includes:
  * `actionlint` for GitHub Workflow YAML files.
  * `shellcheck` for all shell scripts.
  * `eslint` for all JavaScript and ESM scripts (`.js`, `.mjs`).
  * `gitleaks` for scanning secrets.

### D. Decoupled PR Executor Architecture
To avoid monolithic script sprawl and properly split verification and write-actions, our auto-merge pipeline (`pr-executor.yml`) is completely decoupled:
* **`get-open-prs` (Read-only GHA Job)**: Queries GitHub API for open, active PRs targeting main, outputting them as a JSON array.
* **`verify-and-merge` (Parallel GHA Matrix Job)**: Dynamically scales in parallel for each open PR.
  * **`verify-pr-requirements.mjs` (Read-only Step)**: Checks if the PR is ready (CI checks, verified commits, approvals, threads). This step uses the restricted `secrets.GITHUB_TOKEN`.
  * **`merge-pr.js` (Elevated Write-only Step)**: Executes only if verification succeeded. Uses the elevated `MERGE_TOKEN` from HashiCorp Vault. It automatically generates the conventional commit squash title/body via Copilot, validating it, and running a self-correcting loop with feedback up to 3 times on validation failure before falling back to the default PR title and description. Finally, it executes the squash merge.
  * **`handle-verification-failure.js` (Write-only step)**: Runs on verification failure to post status warnings/manage labels.
  * **`handle-merge-failure.js` (Write-only step)**: Runs on merge failure to apply gracefully fork-protection fallbacks (labels/maintainer comments).

---

## 2. Consolidation & Refactoring Specs

### A. Tag Creation Script Consolidation
* **Current State:** We have a shell script `create-push-tag.sh` and a JavaScript script `create-push-tag.js`.
* **Consolidation Target:** Merge all tag creation logic entirely into `create-push-tag.js` utilizing the Octokit REST API.
* **Logic Requirements:**
  * Support RC tag calculation mode (`CALCULATE_NEXT_RC=true`).
  * Support direct tag creation mode (`CREATE_REF=true` with a specified `TAG` and `SHA`).
  * Fail gracefully if the tag already exists and matches the requested SHA; error if it points to a different SHA.
* **Deletion:** Safely delete `create-push-tag.sh` once all references are removed.

### B. Outdated Plan Cleanup
To prevent plan sprawl and keep the `.agent/plans/` folder clean and high-value, the following redundant/obsolete plan files will be removed:
* `ConsolidateWorkflowScripts.md`
* `FixManualReleaseWorkflows.md`
* `FixManualWorkflowTagCreation.md`
* `FixTagCreationPermissions.md`
* `WorkflowStandards.md`
* `FixGoReleaserTagContext.md`
* `FixManualGoReleaserConfig.md`
* `FixShallowCloneTagCheckout.md`
* `FixSkippedFullRelease.md`
* `AdaptReviewProxyWorkflow.md`
* `EnforceReleasePleaseValidation.md`
* `CIBasedPRVerification.md`

### C. Workflow Script Testing
* Modern Node.js (v20+) contains a stable, fast, built-in test runner (`node:test`) and assertion library (`node:assert`).
* We will establish zero-dependency native unit tests for all JS workflow scripts under `.github/workflows/scripts/tests/`.
* Mocking the standard Octokit context parameters (`github`, `context`, `core`, `process`) allows complete offline local testing of the script logic before pushing.

---

## Implementation Checklist

### Phase 1: Plan Approval & Old Plan Cleanup
- [x] Present this plan to the developer for explicit approval.
- [x] Delete the redundant plan files from `.agent/plans/`:
  - [x] `.agent/plans/ConsolidateWorkflowScripts.md`
  - [x] `.agent/plans/FixManualReleaseWorkflows.md`
  - [x] `.agent/plans/FixManualWorkflowTagCreation.md`
  - [x] `.agent/plans/FixTagCreationPermissions.md`
  - [x] `.agent/plans/WorkflowStandards.md`
  - [x] `.agent/plans/FixGoReleaserTagContext.md`
  - [x] `.agent/plans/FixManualGoReleaserConfig.md`
  - [x] `.agent/plans/FixShallowCloneTagCheckout.md`
  - [x] `.agent/plans/FixSkippedFullRelease.md`
  - [x] `.agent/plans/AdaptReviewProxyWorkflow.md`
  - [x] `.agent/plans/EnforceReleasePleaseValidation.md`
  - [x] `.agent/plans/CIBasedPRVerification.md`

### Phase 2: ESLint Integration & Pre-requisite Setup
- [x] Update `.github/workflows/scripts/lint.sh` to include `eslint` checks on `.github/workflows/scripts/` and `.agent/hooks/`.
- [x] Run `lint.sh` locally and verify that ESLint runs and passes.

### Phase 3: Consolidate Tag Creation Script & Update Workflows
- [x] Enhance `create-push-tag.js` to ensure it fully supports direct tag creation (`CREATE_REF=true` with `TAG` and `SHA`) via the GitHub Octokit API.
- [x] Update `manual-release.yml` to call `create-push-tag.js` via `actions/github-script` instead of `create-push-tag.sh`.
- [x] Update `manual-rc-release.yml` to call `create-push-tag.js` via `actions/github-script` instead of `create-push-tag.sh`.
- [x] Verify that all references to `create-push-tag.sh` have been replaced, then delete `.github/workflows/scripts/create-push-tag.sh`.

### Phase 4: Build Native Unit Tests for Workflow Scripts
- [x] Create `.github/workflows/scripts/tests/create-push-tag.test.js` using `node:test` to test RC calculation, existing tag match/mismatch, and ref creation logic.
- [x] Create `.github/workflows/scripts/tests/check-maintainer.test.js` to verify maintainer validation.
- [x] Create `.github/workflows/scripts/tests/publish-release.test.js` to verify release publishing logic.
- [x] Create `.github/workflows/scripts/tests/validate-commit-message.test.js` to verify conventional commit checks.
- [x] Update `.github/workflows/scripts/test.sh` to include a `scripts` mode that runs all JS unit tests:
  ```bash
  node --test .github/workflows/scripts/tests/**/*.test.js
  ```
- [x] Run `./.github/workflows/scripts/test.sh scripts` locally and confirm all unit tests pass perfectly.

### Phase 5: Integrate Script Testing & Validation in CI
- [x] Update `pull_request.yaml` to include running script linting and script unit tests.
- [x] Run the complete `lint.sh` suite locally to verify there are 0 warnings/errors.

### Phase 6: Quality Gates & IDE Review Gateway
- [x] Run full project static analysis and linting (`lint.sh all`) to confirm everything is pristine.
- [x] Perform a proactive code review against `github-copilot-review.instructions.md`.
- [x] Integrate GITHUB_MERGE_TOKEN from Vault into pr-executor.yml and verify-pr-requirements.mjs.
- [x] Synchronize with upstream `main` off point.
- [x] Present the unstaged diff to the developer in the chat for IDE review and manual approval.
- [x] Commit, push to fork, and generate a draft Pull Request.

### Phase 7: PR Auto-Merge Requirements & Dependabot Exceptions (PR #400)

- [ ] Optimize the PR trigger & executor pipeline to prevent GHA waste:
  - [ ] Refactor `.github/workflows/review-trigger.yml` to only succeed on a `/merge` comment (for human PRs) or a Copilot approval review (for Dependabot PRs), failing otherwise to abort executor triggers.
  - [ ] Refactor `.github/workflows/pr-executor.yml` to only execute its jobs if the triggering parent workflow completed successfully.
  - [ ] Refactor `.github/workflows/scripts/get-open-prs.js` to pre-resolve specific PR numbers from the parent run payload, falling back to listing only open PRs that are from Dependabot or have active `/merge` comments.
- [ ] Adapt `.github/workflows/scripts/verify-pr-requirements.mjs` to check:
  - [ ] For standard PRs (not dependabot): requires at least **1 trusted human approval** (admin, write, maintain, triage) AND at least **1 AI/Copilot review**.
  - [ ] For dependabot PRs: requires at least **1 AI/Copilot review** (bypasses human approval requirement).
- [ ] Create a comprehensive suite of native unit tests under `.github/workflows/scripts/tests/verify-pr-requirements.test.js` using `node:test` and `node:assert`:
  - [ ] Test standard PR with human-only approval (should fail, missing AI review).
  - [ ] Test standard PR with human and AI approvals (should pass).
  - [ ] Test dependabot PR with AI-only approval (should pass, bypassing human requirement).
  - [ ] Test dependabot PR without AI approval (should fail).
  - [ ] Test PR with unresolved threads (should fail).
- [ ] Run `./.github/workflows/scripts/test.sh scripts` to verify all unit tests pass flawlessly.
- [ ] Run the complete linter suite (`lint.sh all`) to ensure 100% ESLint, Prettier, and spelling compliance.
- [ ] Present the unstaged diff for visual review in the chat (Gate 2).
- [ ] Obtain cryptographic manual approval signature via `user-approval.js`.
- [ ] Execute `commit-push.sh` to commit and push the finalized configuration.
