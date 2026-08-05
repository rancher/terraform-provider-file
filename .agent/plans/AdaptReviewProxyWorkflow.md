# Plan: Adapt Review Proxy Workflow

* **Executed Date:** 2026-08-04
* **Purpose:** Refine the repository PR verification and merge process by replacing the legacy cron-scheduled polling workflow (`scheduled-pr-verification.yml`) with a secure, real-time, event-driven merge executor triggered by `workflow_run` on tests and review approvals. Incorporates Write-level proxy approvals for Triage-level human reviewers to legally satisfy GitHub branch protection rules.
* **Goals & Code Snippets:**
  - Create `.github/workflows/review-trigger.yml` that triggers on `pull_request_review` (submitted) to safely signal a review has completed.
  - Rename/refactor `.github/workflows/scheduled-pr-verification.yml` to `.github/workflows/pr-executor.yml`, triggering on `workflow_run` of `pull_request` and `review_trigger` with `copilot-requests: write` permissions.
  - Update `.github/workflows/scripts/verify-pr-requirements.js` to:
    1. Proxy-approve PRs on behalf of the bot if a trusted human (MEMBER, OWNER, COLLABORATOR) approved.
    2. Pass credentials securely inside the Nix execution script using inline env variables (`GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`).
    3. Use the initial commit message as fallback, appending `fix: ` if it lacks a conventional type prefix, and enforcing SemVer guards on non-product fallbacks.

---

## Implementation Checklist

### Phase 3: Surgical Implementation (Act)
- [x] Create `.github/workflows/review-trigger.yml` with `pull_request_review` trigger and zero permissions.
- [x] Create `.github/workflows/pr-executor.yml` (renamed executor workflow) triggering on `workflow_run`.
- [x] Remove legacy scheduled workflow (`.github/workflows/scheduled-pr-verification.yml`).
- [x] Inject proxy approval logic into `.github/workflows/scripts/verify-pr-requirements.js`.
- [x] Fix Copilot CLI Nix authentication by passing credentials inside the nix-run.sh inline script environment.
- [x] Implement initial commit fallback title and body construction.
- [x] Implement defensive SemVer safety guards on non-product fallback messages to downgrade `feat/refactor/!` to `chore`.
- [x] Update `.github/workflows/scripts/lint.sh` to include the actionlint ignore workaround.

### Phase 4: Testing & Verification (Quality Gate 1)
- [x] Run `actionlint` locally to verify workflow syntax correctness (ignoring `copilot-requests`).
- [x] Run `node --check` to verify JavaScript syntax correctness of modified script.

### Phase 5: Chunking & Staging Isolation (Quality Gate 2)
- [x] Present the finalized unstaged diff to the developer in the chat.
- [x] Solicit manual developer IDE review and obtain explicit approval in the chat.

### Phase 6: Authorized Commit & PR Generation (Quality Gate 3)
- [x] Stage only specific modified files (no `git add .` or `-A`).
- [x] Commit with conventional prefix `ci:` and `APPROVED_BY_USER=1`.
- [x] Push the branch `feature/review-proxy-workflow` to our origin fork.
- [x] Generate a Draft Pull Request on GitHub using `.agent/skills/create-pr.sh --draft`.
- [x] Graduate the draft PR to ready-for-review using `.agent/skills/create-pr.sh --ready`.
