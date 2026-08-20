# Component Specification: PR Executor Target PR Resolution

- **Related Topic:** [GitHub Workflows & Automation](../GitHubWorkflows.md)
- **Target Component:** `.github/workflows/pr-executor.yml`
- **Issue Reference:** rancher/terraform-provider-file#389

---

## Abstract

This component details the architectural modifications to the PR Executor and Auto-Merge workflow (`.github/workflows/pr-executor.yml`) to ensure reliable pull request resolution. It resolves a platform-level limitation where the GHA `workflow_run` event payload's `pull_requests` array is left empty when triggered by a pull request originating from a fork.

---

## 1. Architectural Strategy & Context

The `PR Executor and Auto-Merge` workflow is triggered upon the completion of a parent `pull_request` or `pull_request_review_trigger` workflow. To verify and merge the correct pull request, it must resolve the triggering pull request number.

Currently, the workflow extracts this number directly from `github.event.workflow_run.pull_requests[0].number` or queries `getWorkflowRun`. However, due to GitHub Actions security and API constraints, the `pull_requests` array is **always empty** when the parent workflow is triggered by a pull request originating from a **fork repo**. Since all human contributions in this repository are required to originate from forks, this completely blocks the automated merge execution pipeline.

### Proposed Robust Fallback Strategy

When both the payload and the direct `getWorkflowRun` query fail to provide a `pull_requests` entry, the executor will execute a multi-layered fallback strategy:

1. **Associated Commit Lookup**: Fetch any pull requests associated with the head commit SHA (`parentRun.head_sha`) using the GitHub REST API (`listPullRequestsAssociatedWithCommit`).
2. **Open PR Search**: Fetch all active open pull requests for the repository and match the head commit SHA (`parentRun.head_sha`) or branch name (`parentRun.head_branch`) against the active head ref (`pr.head.sha` or `pr.head.ref`).

---

## 2. Security Analysis & Threat Mitigations

Because the PR Executor runs with elevated permissions (`contents: write`, `pull-requests: write`), security and tamper-proofing are paramount:

### A. Fork Branch Name Hijacking Protection (Collision Prevention)

If the workflow fell back to matching a branch name like `patch-1` or `update` alone, a malicious actor could name a branch on their fork to collide with a trusted branch/PR, potentially hijacking the target `prNumber` and triggering a merge run.

- **Mitigation**: The fallback branch matching logic strictly validates the fork repository owner:

  ```javascript
  p.head.ref === parentRun.head_branch && p.head.repo.owner.login === parentRun.head_repository.owner.login;
  ```

  This ensures branch-name matching only succeeds if the PR originates from the exact same fork that triggered the workflow run.

### B. Event & Code Isolation (Base Ref Guarantee)

A bad actor might attempt to modify the `pr-executor.yml` workflow file or the validation/merge scripts inside their PR branch to bypass checks or run arbitrary code.

- **Mitigation**: GitHub Actions executes `workflow_run` workflows **exclusively using the workflow YAML file from the base repository's default branch (`main`)**. Furthermore, the `actions/checkout` step checkouts `main` by default. As a result, all executed YAML definitions and imported scripts (`verify-pr-requirements.mjs`, `merge-pr.js`) are read strictly from the base repository's trusted `main` branch, making PR branch tampering impossible.

### C. Immutable Gated Verification Checks

Even if a bad actor manages to resolve their PR number in the executor, they cannot bypass the security requirements. The `Verify PR Requirements` job enforces:

1. **Verified GPG Signatures**: Every single commit in the PR must be signed and verified by GitHub.
2. **Trusted Role Approval**: The PR must have at least one approval from a trusted role (Owner, Member, Collaborator) with write permissions.
3. **AI Review Gate**: The PR must have a valid AI review from Copilot or our agent.
4. **Resolved Review Conversations**: 100% of review comment threads must be resolved.
5. **Trusted /merge Trigger**: For human PRs, a `/merge` comment must be explicitly posted in the conversation thread by a trusted repository member.

---

## 3. Technical Blueprint

The inline `actions/github-script` step in `.github/workflows/pr-executor.yml` will be updated with the following robust logic:

```javascript
let prNumber;
const parentRun = context.payload.workflow_run;

if (parentRun && parentRun.pull_requests && parentRun.pull_requests.length > 0) {
  prNumber = parentRun.pull_requests[0].number;
  core.info(`Identified target PR #${prNumber} from workflow_run payload.`);
} else if (parentRun) {
  try {
    const { data: runDetail } = await github.rest.actions.getWorkflowRun({
      owner: context.repo.owner,
      repo: context.repo.repo,
      run_id: parentRun.id,
    });
    if (runDetail.pull_requests && runDetail.pull_requests.length > 0) {
      prNumber = runDetail.pull_requests[0].number;
      core.info(`Identified target PR #${prNumber} via API fetch.`);
    }
  } catch (err) {
    core.warning(`Failed to fetch workflow run details: ${err.message}`);
  }

  // Fallback 1: Query open pull requests associated with the head commit SHA
  if (!prNumber && parentRun.head_sha) {
    try {
      const { data: associatedPRs } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
        owner: context.repo.owner,
        repo: context.repo.repo,
        commit_sha: parentRun.head_sha,
      });
      if (associatedPRs && associatedPRs.length > 0) {
        prNumber = associatedPRs[0].number;
        core.info(`Identified target PR #${prNumber} via associated commit SHA: ${parentRun.head_sha}`);
      }
    } catch (err) {
      core.warning(`Failed to fetch associated PRs by commit SHA: ${err.message}`);
    }
  }

  // Fallback 2: Search all open pull requests for matching head branch and repository owner, or head SHA
  if (!prNumber) {
    try {
      const { data: openPRs } = await github.rest.pulls.list({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'open',
      });

      const headOwner = parentRun.head_repository?.owner?.login;
      const matchedPR = openPRs.find(
        (p) =>
          p.head.sha === parentRun.head_sha ||
          (parentRun.head_branch &&
            p.head.ref === parentRun.head_branch &&
            headOwner &&
            p.head.repo?.owner?.login === headOwner),
      );

      if (matchedPR) {
        prNumber = matchedPR.number;
        core.info(`Identified target PR #${prNumber} from open PRs list by matching head SHA or branch/owner.`);
      }
    } catch (err) {
      core.warning(`Failed to search open pull requests: ${err.message}`);
    }
  }
}
```

---

## 4. Implementation Checklist

- [x] Implement robust multi-layered PR resolution logic in `.github/workflows/pr-executor.yml` using head SHA and head branch fallbacks.
- [x] Run codebase linters and static checks to verify workflow file formatting.
- [ ] Seek final IDE and commit approval.
