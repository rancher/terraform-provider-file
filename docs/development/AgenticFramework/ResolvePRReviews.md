# PR Review Comment Resolution

---

## Abstract

This component defines our high-standard engineering process for analyzing, planning, and executing resolutions for Pull Request review comments in a dedicated, fresh development session.

---

## Purpose

Review comments from human maintainers and automated bots provide valuable insights. This workflow enforces a **"Discernment-First"** protocol: AI agents must analyze the _underlying concerns_, critically evaluate if they are valid, design high-quality, standard-compliant solutions, post clear responses to each thread on GitHub, and programmatically resolve them after refactoring.

---

## Detailed Step-by-Step Procedure

### 1. Initiate Session & Retrieve Comments

This workflow is initiated in a **brand new development session** specifically started to resolve PR comments.

- First, retrieve a chronological timeline of all general and inline review comments:

  ```bash
  .gemini/skills/get-pr-comments.sh [PR_ID]
  ```

- Analyze the timeline to map file paths, lines, authors, and feedback.

### 2. Separation of Concerns & Evaluation (Discernment Phase)

For each comment retrieved, perform a critical architectural assessment:

- **Evaluate Validity**: Is there an actual logic flaw, security vulnerability, syntax error, or style deviation?
  - **If Valid**: Acknowledge the concern and design a custom, idiomatic fix conforming to `docs/development/rules/`.
  - **If Invalid**: Prepare a clear, professional, and technical explanation why the current implementation is correct.
- **Reject Bot Hacks**: Never blindly copy sub-optimal recommendations, hacks that disable warnings, or "soft-failure" defaults that mask configuration errors.

### 3. Update active plan

Before making any file edits, adapt the active specification file under `docs/development/` to document the comments:

- Add a dedicated comment resolution section mapping out the evaluated concerns and custom solutions.
- Append corresponding task checkboxes to the plan's checklist.

### 4. Respond to Comment Threads on GitHub

To maintain high collaboration standards, post an explicit response to each comment thread on GitHub before or during the fix:

- Explain your technical evaluation and solution, or provide your counter-rational if the concern is invalid.
- _(Note: Response comments can be posted using native GitHub CLI or discussion APIs)._

### 5. Surgical Refactoring & Verification

Implement and verify changes autonomously off the approved plan:

- **Act surgically**: Touch only the necessary files.
- **Validate thoroughly**: Run local linters (`eslint`, `shellcheck`), compilers, and test suites (`make test`) to ensure exactly 0 findings and 0 regressions.

### 6. Secure Commit & Push

Once verified, present the unstaged diff and request approval via `ask_user` (format: `Commit Message: "fix(hooks): resolve review findings on PR #<id>"`). The hook will automatically write the signature, commit, push, and update the PR on GitHub.

### 7. Programmatic Thread Resolution

Once changes are pushed and verified on GitHub, programmatically resolve all comment threads on GitHub:

```bash
.gemini/skills/resolve-pr-reviews.sh [PR_ID] --bypass-token --all
```

Verify that all threads are fully closed on GitHub, concluding the resolution session.

### PR 404 Resolution Implementation Checklist

- [x] Update `hooks.test.js` to change the `.gemini and .gemini folders` test description to `.gemini and .claude folders`.
- [x] Update `hooks.test.js` to dynamically use `path.basename(process.cwd())` when resolving `tempTmpDir`, removing the hardcoded `terraform-provider-file` string.
- [x] Run `node --test .github/workflows/scripts/tests/**/*.test.js` to verify all tests pass perfectly.
- [x] Run `./.github/workflows/scripts/lint.sh` to ensure full lint compliance.

### Custom Words Cleanup Checklist

- [x] Remove duplicate `elif` and `thisisasupersecretkey` from `custom_words.txt`.

### Claude Session Start Hook Refactoring Checklist

- [x] Refactor `.claude/hooks/session-start-context.sh` to comply with the modular, standard-compliant shell script guidelines.

---

## 🛠️ Decoupled Agent-Scripts Unit Test Suite Plan

We are implementing a fully decoupled, tool-agnostic unit test suite for the core modules under `agent-scripts/`. This replaces the previous agent-specific test files and organizes test assertions directly under the root-level `agent-scripts/tests/` directory:

1. **Test Suite Structure**:
   - `agent-scripts/tests/planning.test.js`: Validates planning gate checks (`checkActivePlan`) under different git status scenarios.
   - `agent-scripts/tests/security.test.js`: Validates direct git push/commit blocks, remote safety verification, and script manual execution protection.
   - `agent-scripts/tests/gating.test.js`: Validates all cryptographic gating check helpers (`verifyPlanGate`, `verifyTestGate`, `verifyReviewGate`).
   - `agent-scripts/tests/after-invoke.test.js`: Validates subagent report parsing, saving, and Gate 2/3 signature generation/revocation.
   - `agent-scripts/tests/after-ask.test.js`: Validates Touch ID GPG-signing biometric challenges.
2. **Unified Execution**:
   - Verify `agent-scripts` test mode in `.github/workflows/scripts/test.sh`.

### **Sequential Implementation Checklist**

- [x] Write the modular planning unit tests in `agent-scripts/tests/planning.test.js`.
- [x] Write the modular security unit tests in `agent-scripts/tests/security.test.js`.
- [x] Write the modular gating unit tests in `agent-scripts/tests/gating.test.js`.
- [x] Write the modular after-invoke unit tests in `agent-scripts/tests/after-invoke.test.js`.
- [x] Write the modular after-ask unit tests in `agent-scripts/tests/after-ask.test.js`.
- [x] Update eslint glob configs in `eslint.config.mjs` and `lint.sh` to target and lint the new `agent-scripts/tests/` directory.
- [x] Update `.github/workflows/pull_request.yaml` script-tests job to target `workflow-scripts` and add `agent-script-tests` job targeting `agent-scripts` mode.
- [x] Execute `node --test agent-scripts/tests/**/*.test.js` to verify 100% of the new unit tests pass cleanly.
- [x] Execute `./.github/workflows/scripts/lint.sh` to ensure full lint compliance.

---

## 🛠️ PR 405 Gating Parity & Review Comments Plan

We are resolving the PR review findings and fixing the Conventional Commit validation CI failure by:

1. Rewording the unconventional commit message to conform to strict Conventional Commit rules.
2. Hardening `gate-before-commit-ask.js` and `sign-commit-gate.js` to strictly match the Gate 4 commit prompt format to prevent false positive commit blocks or signature bypasses.
3. Upgrading `agent-scripts/security.js` to block manual spoofing of any planning, testing, review, or commit gate signature/challenge JSON files.

### **Sequential Implementation Checklist**

- [x] Refactor `.claude/hooks/gate-before-commit-ask.js` to strictly match the Gate 4 commit prompt format (`Commit Message: "..."` or `Commit Message: \`...\``).
- [x] Refactor `.claude/hooks/sign-commit-gate.js` to strictly match the Gate 4 commit prompt format.
- [x] Refactor `agent-scripts/security.js` to extend approval-file manipulation checks to cover all planning, testing, review, and commit gate JSON files (`plan-approval.json`, `plan-approval.challenge`, `test-approval.json`, `review-approval.json`, `user-approval.json`, `user-approval.challenge`).
- [x] Guide the developer to reword the unconventional commit message `Potential fix for pull request finding` in their local branch history to `fix(agent): align testing and review agent gate verifications`.
- [x] Verify that all 18 agent-scripts tests and all linters are 100% green.

---

## 🛠️ PR 405 Subagent Revocation & Timeout Plan

We are resolving the new PR review comment by:

1. Hardening both `.claude/hooks/subagent-report-gate.js` and `.gemini/hooks/03-review-phase.js --after-invoke` to treat unparsable/missing transcripts as a failure and immediately delete existing signatures (Gate 2/3) to prevent stale states.
2. Confirming and locking Gating timeouts to 60 seconds (`60000` ms) inside `.gemini/settings.json` and `.claude/settings.json`.

### **Sequential Implementation Checklist**

- [x] Refactor `.claude/hooks/subagent-report-gate.js` to revoke/unlink Gate 2/3 signatures if the subagent report/transcript is unparsable or missing.
- [x] Refactor `.gemini/hooks/03-review-phase.js` (under the `--after-invoke` argument) to revoke/unlink Gate 2/3 signatures if the subagent report/transcript is unparsable or missing.
- [x] Confirm that `.gemini/settings.json` and `.claude/settings.json` timeouts are set to 60 seconds.
- [ ] Verify that all 18 agent-scripts tests and linters are 100% green.

---

## 🛠️ PR 405 Gating Hardening & Precise Divergence Plan

We are resolving the two new PR review findings by:

1. Refining the divergence check in `agent-scripts/after-ask.js` to only auto-enable the force flag (`-f`) if Histories have actually **diverged** (neither is an ancestor of the other), not when local is behind.
2. Expanding the manual writing/editing spoof block in `.claude/hooks/enforce-blueprint.js` and `.gemini/hooks/02-plan-phase.js` to cover all gate-related signature files including challenges (`.challenge`) and age envelopes (`.age`).

### **Sequential Implementation Checklist**

- [x] Refactor `agent-scripts/after-ask.js` to perform precise divergence vs. behind checks.
- [x] Refactor `.claude/hooks/enforce-blueprint.js` to block manual edits to all `.json`, `.challenge`, and `.age` gate signature files.
- [x] Refactor `.gemini/hooks/02-plan-phase.js` to block manual edits to all `.json`, `.challenge`, and `.age` gate signature files.
- [x] Verify that all 18 agent-scripts tests and linters are 100% green.

---

## 🛠️ PR 405 GPG Hook Recovery & Active Gate Revocation Plan

We are resolving the new recovery and revocation requirements by:

1. Hardening `.gemini/hooks/04-commit-phase.js --before-ask` and `.claude/hooks/gate-before-commit-ask.js` to actively check if the current diff_hash matches the test/review signature files before commit approval prompts. If a mismatch is detected, it actively unlinks/deletes the testing/review signatures, logs an active revocation message, and fails.
2. Hardening `handleCommitApproval` inside `agent-scripts/after-ask.js` to catch any failures during standard push, force push, or PR generation. Upon error, it executes a zero-trust reset by unlinking all signature files (`plan-approval.json`, `test-approval.json`, `review-approval.json`, `user-approval.json`) and outputting a highly visible troubleshooting log with actionable guide points.

### **Sequential Implementation Checklist**

- [x] Write `checkAndRevokeStaleGates(targetDir, activeDiffHash, expectedPlanHash)` inside `agent-scripts/gating.js` to actively verify and delete stale Gate 2/3 signature files.
- [x] Refactor `.gemini/hooks/04-commit-phase.js` (under the `--before-ask` argument) to call `checkAndRevokeStaleGates` and actively revoke stale signature files before commit ask checks.
- [x] Refactor `.claude/hooks/gate-before-commit-ask.js` to call `checkAndRevokeStaleGates` and actively revoke stale signature files before commit ask checks.
- [x] Refactor `handleCommitApproval` in `agent-scripts/after-ask.js` to perform a zero-trust signature revocation reset and log structured troubleshooting steps upon automated push/PR failure.
- [x] Verify that all 18 agent-scripts tests and linters are 100% green.

---

## 🛠️ PR 406 Gating Hardening Plan

We are resolving the 4 new PR review findings by:

1. Hardening `checkAndRevokeStaleGates` in `agent-scripts/gating.js` to only revoke signature files when activeDiffHash and expectedPlanHash are fully truthy.
2. Refactoring `agent-scripts/after-ask.js` to replace shell-interpolated `execSync` commands with safe, injection-immune `execFileSync('git', [...])` calls.
3. Plucking the early guard loophole in `.gemini/hooks/03-review-phase.js --after-invoke` to actively revoke signature files if the response or report is empty/missing.
4. Tuning GHA hook timeout documentation in `ResolvePRReviews.md` to clarify that only networked ask-approval hooks are set to 60 seconds.

### **Sequential Implementation Checklist**

- [ ] Refactor `checkAndRevokeStaleGates` in `agent-scripts/gating.js` to evaluate truthy hashes before unlinking.
- [ ] Refactor `agent-scripts/after-ask.js` to use secure, shell-injection-immune `execFileSync('git', [...])` commands for merge-base ancestor checks.
- [ ] Refactor `.gemini/hooks/03-review-phase.js` (under the `--after-invoke` argument) early guards to actively call `revokeGate` on missing or empty LLM responses.
- [ ] Verify that all 18 agent-scripts tests and linters are 100% green.
