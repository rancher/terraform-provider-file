# Component Specification: PR Executor /merge Requirement Removal

- **Related Topic:** [GitHub Workflows & Automation](../GitHubWorkflows.md)
- **Target Component:** `.github/workflows/scripts/get-target-pr.js`
- **Target Tests:** `.github/workflows/scripts/tests/get-target-pr.test.js`
- **Issue Reference:** rancher/terraform-provider-file#389

---

## Abstract

This component updates the PR Executor target resolution logic (`get-target-pr.js`) to remove the redundant `/merge` comment restriction. Because the triggering events of the PR Executor workflow are already tightly controlled and filtered by GitHub Actions event rules, a secondary check inside `get-target-pr.js` is unnecessary and inappropriately blocks automatic verification of PRs triggered by other valid events (such as CI completion or Copilot approvals).

This component also refactors the verification failure handler (`handle-verification-failure.js`) to ensure that a single persistent feedback comment is cleanly posted and updated on the PR rather than spamming new comments on subsequent runs.

---

## 1. Architectural Strategy & Context

Currently, `get-target-pr.js` checks for a `/merge` comment from a trusted member on all human pull requests. If absent, it exits with `core.setFailed`, failing the workflow run.

This early failure blocks the downstream `Verify PR Requirements` job (`verify-pr-requirements.mjs`) from running and reporting missing requirements on Pull Requests that were triggered intentionally (e.g., on PR synchronization or review triggers).

### Refactoring Strategy

1. **Simplify `get-target-pr.js`**: Completely remove the `/merge` check. The script's only job is to resolve and return the target PR number based on the payload or fallbacks.
2. **Refine `handle-verification-failure.js`**:
   - Remove the `isScheduled` and `currentHour` restrictions on posting/updating status comments, so that any failure immediately gives feedback on what needs resolving.
   - Update `COMMENT_SIGNATURE` to a more generic `<!-- auto-merge-verification-signature -->`.
   - Update the comment body template to refer to general auto-merge status rather than scheduled runs only.
   - Verify that `updateOrPostComment` correctly parses and updates existing comments matching the signature, avoiding comment spam.
3. **Refine `merge-pr.js`**:
   - Update `COMMENT_SIGNATURE` to the same generic `<!-- auto-merge-verification-signature -->`.
   - Update `deleteBotCommentIfExists` to find and delete comments containing the signature, preventing orphaned warning comments.

---

## 2. Security Analysis & Threat Mitigations

- **Workflow Trigger Security**: The PR Executor is triggered by standard workflow completions (`pull_request`) and comment events (`pull_request_review_trigger`). Unauthorized repository external actors are already blocked from executing these trigger workflows, mitigating risk.
- **Rigor of Downstream Verification**: Removing the `/merge` comment gate from `get-target-pr.js` does not bypass any PR merge requirements. The `Verify PR Requirements` job still executes and rigorously checks for passing CI, verified commit signatures, trusted human approval reviews, and unresolved comments. It is impossible to merge a PR that does not satisfy these constraints.

---

## 3. Implementation Checklist

- [x] Create the Component Specification blueprint under `docs/development/GitHubWorkflows/`.
- [x] Update `.github/workflows/scripts/get-target-pr.js` to remove the `/merge` comment check and the `isDependabot` check.
- [x] Update `.github/workflows/scripts/tests/get-target-pr.test.js` to remove the `/merge`-related unit tests (`fails when human PR lacks /merge comment` and `skips /merge check and passes for dependabot[bot]`).
- [x] Update `.github/workflows/scripts/handle-verification-failure.js` to remove schedule constraints and update the signature to `<!-- auto-merge-verification-signature -->`.
- [x] Update `.github/workflows/scripts/merge-pr.js` to use the new signature.
- [ ] Run `node --test .github/workflows/scripts/tests/**/*.test.js` to verify all tests pass.
- [ ] Seek final commit review.
