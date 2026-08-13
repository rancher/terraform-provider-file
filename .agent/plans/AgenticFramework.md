# Secure Workflows and Push Process Blueprint

* **Executed Date:** 2026-08-12
* **Purpose:** Establish a robust security gateway for all code commits and pushes, mandating the use of the secure `.agent/skills/commit-push.sh` skill and prohibiting direct `git commit` or `git push` commands.
* **Domain Specification:**
  - **Commit-Push Skill:** Consolidates pre-commit validation, branch defunct checks, upstream synchronization via `git-sync.sh`, remote ancestry verification (fail-fast behind remote), interactive developer approval via TTY, and signed/signed-off commits and pushes.
  - **Direct Git Block Hook:** `block-rancher-git.js` acts as an agent-level command interceptor, blocking any direct invocation of `git commit` or `git push` to guarantee that all execution goes through the secure skill.

---

## Implementation Checklist

### Phase 1: Create Root Routing Files
- [x] Create root routing files (`GEMINI.md`, `CLAUDE.md`, `.github/copilot-instructions.md`)

### Phase 2: Create the Master Instructions File
- [x] Create the master instructions file (`AGENTS.md`)

### Phase 3: Scaffold the `.agent` Directory Structure
- [x] Create directories and populate README files

### Phase 4: Populate Initial Base Files
- [x] Populate output-styles, rules, skills, and workflows

### Phase 5: Secure Workflows and Push Process Hook Enforcements (PR #394)
**Objective**: Establish process-enforcement hooks (`block-rancher-git.js`) and secure skills (`commit-push.sh`) to block direct manual commits and pushes, requiring the secure, validated commit-push skill pipeline.

#### Phase 5.1: Rebase & Resolve Conflicts
- [x] Perform a git rebase of `feature/workflows-secure-push` onto `main`
- [x] Resolve any conflicts in `.agent/skills/commit-push.sh` during the rebase

#### Phase 5.2: Refactor and Resolve Copilot Review Comments
- [x] **Address Comment #1 (Branch Restoration):** Switch back to the active feature branch in `.agent/skills/commit-push.sh` after `git-sync.sh` runs, preventing stashes from being accidentally applied on `main`.
- [x] **Address Comment #2 (Zero jq Dependency):** Replace `jq` with `gh pr view --template` when querying defunct branch status in `commit-push.sh` to handle environments without `jq`.
- [x] **Address Comment #3 (Process Text Reconciliation):** Remove outdated references to `APPROVED_BY_USER=1` in hooks and documentation to align with the new secure-push process:
  - [x] Refactor `.agent/hooks/startup-context.sh`
  - [x] Refactor `.agent/workflows/development-process.md`
- [x] **Address Comment #4 (Bypass Hook Removal):** Remove the `BYPASS_COMMIT_HOOK=1` bypass mechanism from `block-rancher-git.js` and `.agent/skills/commit-push.sh`, enforcing unconditional blocks on direct `git commit`/`push`.
- [x] **Address Comment #5 (Safe Ancestry Check):** Replace the mutating `git pull --ff-only` check with a non-mutating, robust fetch and ancestor comparison via `git rev-list --count HEAD..origin/$current_branch` in `commit-push.sh`.

#### Phase 5.3: Validation, Static Analysis, and Linting
- [x] Execute ESLint/linter checks on updated javascript hooks (`block-rancher-git.js`)
- [x] Execute ShellCheck/linter checks on updated shell scripts (`commit-push.sh`)
- [x] Run automated tests locally to verify no regressions

#### Phase 5.4: Proactive Review & Push
- [x] Run `@review_agent` to perform a proactive review of the unstaged git diff
- [x] Resolve any review findings to ensure exactly 0 findings
- [x] Complete the rebase, sign and push to the fork remote
- [x] Monitor GitHub Actions CI status for PR 394

---

## Phase 6: Cryptographic Review Gate & Modular Script Hardening (PR #396)
**Objective**: Build a hardened, production-grade cryptographic review-approval gate between the review agent and the commit-push skill, refactor `commit-push.sh` into modular single-responsibility functions, and enforce strict remote push safety checks.

1. **Owner and Symlink Hardening**:
   - Check if `/tmp/review-approval.json` is a regular file (reject symbolic links to block symlink attacks).
   - Verify file ownership: the file owner UID must match the current user's UID (`$UID`) to block file-injection from other users on the system.
2. **SHA-256 Cryptographic Verification**:
   - Mandate SHA-256 as the core cryptographic integrity verification algorithm.
   - Refuse fallback to broken/weak hash algorithms like MD5 or default SHA-1.
3. **Modular Function Refactoring**:
   - Refactor `commit-push.sh` from a monolithic procedural main block into modular, single-responsibility helper functions.
4. **Git Stash Conflict Resilience**:
   - Wrap `git stash pop` in error handling to gracefully inform the developer about merge conflicts, assuring them their stashed changes remain preserved in the Git stash.
5. **Upstream Remote Push Safety Enforcer**:
   - Implement `verify_push_safety` inside `commit-push.sh` to proactively reject pushing to any Rancher-owned remote URL (e.g. upstream), conforming to strict security protocols.

---

## Implementation Checklist - Phase 6 (PR #396 Comment Resolutions)

### Phase 6.1: Rebase & Resolve Conflicts
- [x] Perform a git rebase of `feature/workflows-secure-review-gate` onto `main`
- [x] Resolve any conflicts in `.agent/skills/commit-push.sh` during the rebase

### Phase 6.2: Refactor and Resolve Copilot Review Comments
- [x] **Address Comment #1 (Zero jq Dependency):** Verify defunct branch protection remains jq-free (Done via PR 394).
- [x] **Address Comment #2 (Owner & Symlink Gate):** Add regular file check, symlink rejection, and current user owner UID verification for `/tmp/review-approval.json` in `commit-push.sh`.
- [x] **Address Comment #3 (SHA-256 Cryptography):** Mandate SHA-256 algorithm and fail-fast if no SHA-256 tool (`shasum -a 256` or `sha256sum`) is available.
- [x] **Address Comment #4 (Robust Stash Recovery):** Catch `git stash pop` failures gracefully, preserving stash and outputting explicit user instructions.
- [x] **Address Comment #5 (Modular Script Architecture):** Refactor `commit-push.sh` into clean, single-responsibility functions (e.g. `parse_args`, `verify_proactive_review`, `prompt_developer_approval`).
- [x] **Address Comment #6 (Safe Permissions & Algorithm in Agent Prompt):** Update `.agent/agents/review_agent.md` to instruct calculating SHA-256 and writing the approval file using secure permissions (`umask 077`).
- [x] **Address Comment #7 (Upstream Remote Safety):** Incorporate the `verify_push_safety` function inside `commit-push.sh` to prevent pushing to Rancher-owned remotes.
- [x] **Address Comment #8 (Clean Hook Workarounds):** Confirm `BYPASS_COMMIT_HOOK=1` is dropped from all commit/push invocations.

### Phase 6.3: Validation, Static Analysis, and Linting
- [x] Execute ESLint/linter checks on updated javascript files
- [x] Execute ShellCheck on `commit-push.sh`
- [x] Run automated tests locally to verify no regressions

### Phase 6.4: Proactive Review & Push
- [x] Run `@review_agent` to perform a proactive review of the active git diff
- [x] Resolve any review findings to ensure exactly 0 findings
- [x] Complete the rebase, sign and push to the fork remote
- [x] Monitor GitHub Actions CI status for PR 396
