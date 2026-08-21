# Component Specification: PR Executor Target Resolution & Workflow Execution Protections

- **Related Topic:** [GitHub Workflows & Automation](../GitHubWorkflows.md)
- **Target Components:** `.github/workflows/pr-executor.yml`, `.github/workflows/scripts/get-target-pr.js`, `.github/workflows/scripts/handle-verification-failure.js`, `.github/workflows/scripts/merge-pr.js`
- **Issue Reference:** rancher/terraform-provider-file#391, rancher/terraform-provider-file#389

---

## Abstract

This component details the architectural specification and platform-level protections governing the automated pull request verification, auto-merge, and workflow execution pipelines.

To resolve GitHub API limitations regarding pull requests originating from forks (where the `workflow_run` payload's `pull_requests` array is left empty), the workflow implements a multi-layered fallback target PR resolution strategy. To ensure high maintainability, the logic is extracted into a standalone, fully unit-tested Node.js module (`get-target-pr.js`). Furthermore, the redundant `/merge` comment gate is removed from target resolution to enable automated status feedback on all PR trigger events.

Finally, this component specifies the declarative platform-level rulesets (Workflow Execution Protections) configured via GitHub Actions Policies to restrict untrusted actors or unauthorized webhook events from executing workflows.

---

## 1. Target PR Resolution & Fallback Strategy

The `PR Executor and Auto-Merge` workflow (`pr-executor.yml`) is triggered upon the completion of a parent `pull_request` or `pull_request_review_trigger` workflow. To verify and merge the correct pull request, it must resolve the triggering pull request number.

Because the GHA payload's `pull_requests` array is empty when parent runs are initiated from a fork, the executor implements a multi-layered fallback strategy to resolve the target PR:

1. **Associated Commit Lookup**: Queries pull requests associated with the head commit SHA (`parentRun.head_sha`) using the GitHub REST API (`listPullRequestsAssociatedWithCommit`).
2. **Open PR Search**: Queries all active open pull requests for the repository and matches the head commit SHA (`parentRun.head_sha`) or branch name (`parentRun.head_branch`) against the active head ref (`pr.head.sha` or `pr.head.ref`).

### Refactored Script Components

- **`get-target-pr.js`**: Contains no redundant `/merge` comment checks. Its single responsibility is the resolution and return of the target PR number based on payload metadata or SHA/branch fallbacks.
- **`handle-verification-failure.js`**: Status comment posting has no time-based or scheduling constraints, ensuring that any failure immediately reports feedback to the PR. Comments are uniquely signed via `<!-- auto-merge-verification-signature -->` and updated in place to prevent duplicates.
- **`merge-pr.js`**: Locates and purges warning threads containing `<!-- auto-merge-verification-signature -->` upon successful PR merge.

### `pull_request_review_trigger` Checkout Enforcement

The trigger workflow (`review-trigger.yml`) executes the script `.github/workflows/scripts/log-trigger.sh` upon detecting valid comments. To allow secure script execution, the workflow includes `contents: read` permissions and executes the standard `actions/checkout@v7.0.1` step (targeting the `main` branch) within the `trigger` job prior to running the script. This ensures the runner environment possesses access to the required scripts, avoiding exit code 127.

---

## 2. Ruleset Administration & Configuration Interface

GitHub Actions Policies and Workflow Execution Protections introduce a centralized ruleset framework that acts as a gatekeeper _prior_ to a workflow run starting. If the event or the actor who initiated it is not permitted, execution is blocked before any runner is provisioned.

The GitHub Ruleset interface provides the configuration steps required to activate these protections:

- **Navigation Path:** Access is located within the repository’s settings screen under the **Actions > Policies** sub-menu.
- **Scoping & Scopes:** Scopes are established at the **Repository** level globally (there is no branch selector).
- **Rule Definitions:** Desired rules are mapped and enabled within the interface:
  - **Restrict Actors:** Maps specific write-level roles (e.g., `Read`, `Maintain`, `Admin`) or installed apps (e.g. the **GitHub Actions** App for GITHUB_TOKEN pushes) permitted to trigger workflow runs.
  - **Restrict Events:** Defines allowed webhook triggers (e.g., permitting `push` and `workflow_run` while restricting dangerous events).
  - **Require Lockfile:** Enforces secure locking metrics for files to prevent pipeline modifications during execution.

---

## 3. Security Analysis & Threat Mitigations

Because the PR Executor runs with elevated permissions (`contents: write`, `pull-requests: write`), security and tamper-proofing are paramount:

### A. Fork Branch Name Hijacking Protection (Collision Prevention)

Matching a branch name like `patch-1` or `update` alone could allow a malicious actor to name a branch on their fork to collide with a trusted branch/PR, hijacking the target `prNumber` and triggering a merge run.

- **Mitigation**: The fallback branch matching logic strictly validates the fork repository owner:

  ```javascript
  p.head.ref === parentRun.head_branch && p.head.repo.owner.login === parentRun.head_repository.owner.login;
  ```

  This ensures branch-name matching only succeeds if the PR originates from the exact same fork that triggered the workflow run.

### B. Event & Code Isolation (Base Ref Guarantee)

A bad actor might attempt to modify the `pr-executor.yml` workflow file or the validation/merge scripts inside their PR branch to bypass checks.

- **Mitigation**: GitHub Actions executes `workflow_run` workflows **exclusively using the workflow YAML file from the base repository's default branch ref**. Furthermore, the `actions/checkout` step checks out the default branch ref of the base repository by default. All executed YAML definitions and imported scripts (`verify-pr-requirements.mjs`, `merge-pr.js`) are read strictly from the base repository's trusted default branch commit, making PR branch tampering impossible.

### C. Immutable Gated Verification Checks

Even if a bad actor manages to resolve their PR number in the executor, they cannot bypass the security requirements. The `Verify PR Requirements` job enforces:

1. **Verified GPG Signatures**: Every single commit in the PR must be signed and verified by GitHub.
2. **Trusted Role Approval**: The PR must have at least one approval from a trusted role (Owner, Member, Collaborator) with write permissions.
3. **AI Review Gate**: The PR must have a valid AI review from Copilot or our agent.
4. **Resolved Review Conversations**: 100% of review comment threads must be resolved.

### Threat Mitigation Scopes

| Attack Vector               | Threat Description                                                                                                                 | Ruleset Mitigation Strategy                                                                                        |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| **Poisoned Pipeline (PPE)** | Attackers submit a PR from a fork modifying workflow files or exploiting events to run malicious code in privileged base contexts. | Prohibit dangerous events or use event rules to run YAML files exclusively from base repository default refs.      |
| **Manual-Trigger Abuse**    | Non-maintainer contributors with write access invoke sensitive deployment/release pipelines manually.                              | Use **Restrict Actors** to limit `workflow_dispatch` to specific roles (e.g. `Maintain` or `Admin`).               |
| **Untrusted Actor Runs**    | External contributors or compromised integration tokens trigger costly automated runs.                                             | Use **Restrict Actors** to block low-trust identities or unauthorized bots from initiating any workflow execution. |
| **Workflow File Tampering** | Attackers bypass file-level branch protection rules (like CODEOWNERS) to force-execute compromised workflows.                      | Centralized repository policies override any configuration declared in the local workspace YAML files.             |

---

## Component Verification State

- **PR Resolution Architecture:** The resolution logic is fully modularized under `.github/workflows/scripts/get-target-pr.js` and securely integrated into `pr-executor.yml`.
- **Pagination & Ambiguity Protection:** Open PR and associated PR search fallbacks securely utilize `github.paginate` to handle large candidate lists, implementing strict head-owner validations and defensive early-failures on ambiguous matching to prevent mis-targeted merges.
- **Blueprint Consolidation:** The legacy `PRExecutor-RemoveMergeGate.md` and `WorkflowExecutionProtections.md` specifications have been fully consolidated natively into this master blueprint.
- **Testing & Verification:** Comprehensive unit tests (`get-target-pr.test.js`) explicitly mock and verify paginated Octokit unrolling, deleted-repo safety checks, and strict ambiguity resolution failures. All codebase linters and static checks guarantee flawless workflow formatting.
