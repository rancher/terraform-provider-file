# Plan: CI-Based PR Verification and Scheduled Auto-Merge

- **Executed Date**: 2026-07-30
- **Purpose**: Enforce strict CI verification rules (signed commits, 2 reviewers or 1 reviewer + 1 AI agent, and resolved comments) for PRs merging into main, with immediate dry-run feedback in `pull_request.yaml` and daily auto-merge via a scheduled cron workflow.

## Objective
Implement a CI-driven mechanism to verify strict requirements for PRs merging into `main` (verified commits, 2 reviewers or 1 reviewer + 1 AI agent, resolved review comments, and all CI passing) and automatically merge them. Provide immediate, actionable feedback to contributors inside their PRs by running the verifications directly in the `pull_request` workflow, while using a scheduled polling workflow to perform the actual secure auto-merge. If the polling workflow cannot merge a PR, it will post a helpful comment on the PR detailing exactly what is missing.

## Key Files & Context
- **Modified Workflow**: `.github/workflows/pull_request.yaml` - Updated to include a new `verify-pr-requirements` job.
- **New Workflow**: `.github/workflows/scheduled-pr-verification.yml` - A new scheduled workflow running on a cron schedule (`0 14,18,23 * * 1-5`, corresponding to CST times: 8:00 AM, 12:00 PM, and 5:00 PM) and `workflow_dispatch`.
- **New Script**: `.github/workflows/scripts/verify-pr-requirements.js` - A shared node script executed via `actions/github-script` to perform complex verifications, conditionally merge, and post comments.

## Implementation Steps

### 1. Create the Shared Verification Script
Write `.github/workflows/scripts/verify-pr-requirements.js` to handle verification, merging, and commenting.
- **Inputs**: `PR_NUMBER` (optional, for specific PRs) and `AUTO_MERGE` (boolean).
- **Verification Logic**:
  - **Verified Commits**: Query PR commits via GraphQL/REST to ensure every commit has a valid GPG/SSH signature (`verification.verified === true`).
  - **Reviewers**: Query PR reviews. Identify humans vs. AI agents. Require either 2 approving humans OR 1 approving human + 1 AI agent reviewer.
  - **Resolved Comments**: Execute a GraphQL query to check all `reviewThreads` for the PR. All threads must have `isResolved === true`.
- **Feedback (pull_request.yaml)**: If `AUTO_MERGE` is false, it uses `core.setFailed()` to output precise errors (e.g., "Missing 1 human approval") to fail the CI check.
- **Action (polling workflow)**: If `AUTO_MERGE` is true:
  - If all criteria (including all CI check runs) are successful, it will execute a `squash` merge via the GitHub API. It will dynamically invoke the Copilot Agent CLI inside the Nix shell to craft a high-quality, consolidated Conventional Commit title and body from all the PR's individual commits, ensuring a clean git history on `main`.
  - If criteria are **not** met, it will post (or update) a comment on the PR (e.g., "The auto-merge job ran, but this PR cannot be merged yet. Missing: 1 human approval."). It will check existing comments to avoid spamming the PR with duplicates. To further minimize notifications, comments are only posted or updated on scheduled runs occurring at 12:00 PM CST (18:00 UTC) or during manual `workflow_dispatch` triggers; comment actions are skipped during other weekday schedule triggers (8:00 AM CST / 14:00 UTC and 5:00 PM CST / 23:00 UTC).

### 2. Update `pull_request.yaml` for Immediate Feedback
- Add a new job: `verify-pr-requirements`.
- This job will run `.github/workflows/scripts/verify-pr-requirements.js` with `AUTO_MERGE=false`.
- It executes on the PR branch, meaning contributors immediately see a failed CI check with detailed instructions.

### 3. Create the Scheduled Auto-Merge Workflow
- Write `.github/workflows/scheduled-pr-verification.yml`.
- Configure the schedule (`0 14,18,23 * * 1-5`) and manual dispatch.
- Define strict permissions (`pull-requests: write`, `contents: write`, `checks: read`).
- The job will iterate through open PRs targeting `main` and run `.github/workflows/scripts/verify-pr-requirements.js` with `AUTO_MERGE=true`.

## Verification & Testing
- Ensure the script accurately identifies AI vs. human reviewers and handles GraphQL pagination.
- Verify the comment logic successfully finds and updates its previous comment rather than creating spam on every cron trigger.
