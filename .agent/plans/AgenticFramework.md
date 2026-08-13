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

---

## Phase 7: Development Process Streamlining and Workflow Optimization (New PR)
**Objective**: Optimize the standard development process workflow (`development-process.md`) to run smoother and be less disjointed by consolidating intermediate approvals around three distinct, high-signal, and mandatory Approval Gates (Planning, IDE/Commit, and PR Sign-off).

1. **Gate 1: Planning Gate (Initial Strategy Approval)**:
   - Present the planning blueprint and checklist in the chat before any file modifications are made.
   - Once approved, the agent operates with full autonomous authorization to implement, build, run acceptance tests, execute linters, and invoke pre-commit reviews without stopping for interim approvals.
2. **Gate 2: IDE & Commit Gate (Implementation Approval)**:
   - Present the active unstaged git diff and propose a conventional commit message.
   - Execute the secure skill: `.agent/skills/commit-push.sh -m "commit message"`.
   - The interactive TTY approval prompt inside the secure skill serves as the definitive Gate 2 approval, consolidating review, GPG-signing, committing, and pushing into a single smooth flow.
3. **Gate 3: Pull Request Sign-Off Gate (Merge Approval)**:
   - Programmatically generate a Draft PR, resolve automated review comments, and present the final PR URL for human merge on GitHub.

---

## Implementation Checklist - Phase 7 (Streamline Development Process)

### Phase 7.1: Branch & Planning
- [x] Checkout a clean new branch `feature/workflow-streamline` off synchronized `main`
- [x] Author and edit the master plan (`AgenticFramework.md`) with the streamline blueprint and obtain Gate 1 approval in the chat

### Phase 7.2: Refactor and Simplify Workflow
- [x] Refactor `.agent/workflows/development-process.md` to clearly define the three Approval Gates and eliminate intermediate, disjointed chat approvals
- [x] Ensure all references to "Gateways" are standardized around "Approval Gates"

### Phase 7.3: Validation, Static Analysis, and Linting
- [x] Run actionlint and markdown linters to verify the modified `.md` workflows
- [x] Verify that no other process files or hooks have mismatched gateway text

### Phase 7.4: Secure Push & PR Generation
- [ ] Present the unstaged diff for Gate 2 visual IDE review in the chat
- [ ] Stage changes and execute the secure `.agent/skills/commit-push.sh` skill (TTY Gate 2)
- [ ] Programmatically generate a Draft PR on GitHub
- [ ] Monitor CI and resolve PR review comments to pass Gate 3 merge sign-off

---

## Phase 8: High-Resilience Syncing & Native TTY Feedback Prompts (Hardened Sync & Interactive Gates)
**Objective**: Build a high-resilience default-branch syncing skill, remove bypass options from `commit-push.sh` (always sync and always ask for approval), and develop a reusable, native TTY-based interactive feedback prompt script for hooks.

1. **High-Resilience Auto-Stashing Sync (`git-sync.sh`)**:
   - Refactor `git-sync.sh` to automatically stash uncommitted or untracked changes securely (`git stash push -u -m "git-sync-auto-stash"`) instead of erroring out immediately.
   - Gracefully restore stashed changes on script exit (`git stash pop` under the exit trap).
2. **Zero-Bypass Push Gateway (`commit-push.sh`)**:
   - Remove `--no-sync` and `-y|--yes|--auto-confirm` bypass options from `commit-push.sh`, mandating upstream synchronization and interactive developer confirmation on every run.
3. **Native TTY Feedback Hook Prompt (`tty-prompt.js`)**:
   - Design a reusable, stylized, and cross-platform TTY-based prompt script `.agent/hooks/tty-prompt.js`.
   - Any hook (Bash or Node.js) can invoke `node .agent/hooks/tty-prompt.js "Message"` to natively block execution and request confirmation directly from the developer's terminal, enabling programmatic gate integrations.

---

## Implementation Checklist - Phase 8 (Hardened Sync & Native TTY Prompts)

### Phase 8.1: High-Resilience Sync Skill Hardening
- [x] Refactor `verify_git_env()` and `cleanup()` in `.agent/skills/git-sync.sh` to implement automatic stash-on-sync and safe stash restoration on exit
- [x] Verify that running `git-sync.sh` on dirty trees securely stashes and pops with zero data loss

### Phase 8.2: Zero-Bypass Gating on Commit-Push Skill
- [x] Refactor `.agent/skills/commit-push.sh` to remove `-y`, `--yes`, and `--no-sync` options, making synchronization and TTY approval fully mandatory
- [x] Standardize and simplify the modular stages inside `commit-push.sh` to remove bypass checks

### Phase 8.3: Native TTY Hook Prompt Implementation
- [x] Author and implement the secure native terminal feedback utility `.agent/hooks/tty-prompt.js`
- [x] Verify that other hooks or skills can invoke it to programmatically establish developer confirmation gates

### Phase 8.4: Verification, Static Analysis, and Push
- [x] Execute ShellCheck and ESLint on the modified scripts
- [x] Run automated tests locally to verify no regressions
- [ ] Present the unstaged diff for visual review in the chat, stage changes, and push using the zero-bypass `commit-push.sh` skill (which will run sync and prompt for TTY approval)

---

## Phase 9: Proactive Review Anti-Bypass Guardrails (Anti-Spoofing Hook Protections)
**Objective**: Build secure anti-bypass guardrail checks inside the process-enforcement hooks (`enforce-planning.js` and `block-rancher-git.js`) to unconditionally block any manual agent-level attempt to write, edit, delete, or spoof `review-approval.json` (either via file-write tools or shell redirections/mutations), forcing strict redirection to the standard development process.

1. **Write-Tool Anti-Bypass Hook (`enforce-planning.js`)**:
   - Add a rule to block `write_file` or `replace` tool calls if the target path ends with `review-approval.json`.
2. **Shell-Redirection Anti-Bypass Hook (`block-rancher-git.js`)**:
   - Add a rule to block `run_shell_command` calls that attempt to write, create, copy, redirect, or delete `review-approval.json` manually (e.g. `echo ... > review-approval.json` or `cat > review-approval.json`), forcing delegation to the actual `@review_agent` subagent.

---

## Implementation Checklist - Phase 9 (Anti-Bypass Guardrails)

### Phase 9.1: Implement Write-Tool Block
- [x] Refactor `.agent/hooks/enforce-planning.js` to unconditionally deny `write_file` or `replace` on `review-approval.json`

### Phase 9.2: Implement Shell-Redirection Block
- [x] Refactor `.agent/hooks/block-rancher-git.js` to parse commands and deny direct manual manipulation/spoofing of `review-approval.json` (such as via redirections `>` or commands `cat`, `echo`, `touch`, `rm`, `mv`, `cp`)

### Phase 9.3: Verification, Authentic Review & Secure Push
- [x] Run actionlint, ESLint, and ShellCheck to verify hook correctness
- [ ] Unstage any previous manual approval file attempts and verify that manual hooks block spoofing
- [ ] **Pass Gate 2 Authentically**: Delegate a genuine proactive review of our staged changes to our review subagent (`generalist`), letting it run all static analysis and programmatically write the secure `/Users/matt.trachier/.gemini/tmp/terraform-provider-file/review-approval.json` file authentically
- [ ] Execute the zero-bypass `commit-push.sh` skill to securely commit and push our changes (TTY Gate 2)

---

## Phase 10: Asynchronous Draft PR Gating & PR Comment Resolution Cycle (Gate 3 & Resolution Process)
**Objective**: Restructure the final Quality Gate (Gate 3) inside `development-process.md` to cleanly separate PR draft creation, manual developer review, draft-to-ready conversion, and asynchronous review-comment resolution into highly cohesive, distinct lifecycle steps.

1. **Gate 3: Draft PR Gating**:
   - The agent programmatically generates a Draft PR on GitHub using `create-pr.sh --draft` and halts execution.
   - The agent waits for explicit developer review and approval in the chat.
   - If approved, the agent executes a secure command/skill to mark the PR as "ready" for review on GitHub (`gh pr ready <pr-number>`).
   - The current development session is then closed cleanly, letting the developer wait asynchronously for team and AI reviews.
2. **Asynchronous PR Comment Resolution Process (`resolve-pr-reviews.md`)**:
   - If changes or feedback are received on GitHub, the developer starts a brand new development session using the dedicated `resolve-pr-reviews.md` workflow.
   - The agent:
     - Chronologically pulls all general and inline review comments.
     - Critically evaluates whether each concern is valid or invalid.
     - Posts programmatic/explicit responses to each comment thread on GitHub.
     - Surgically refactors the codebase to resolve valid concerns.
     - Programmatically resolves the comment threads using `resolve-pr-reviews.sh`.

---

## Implementation Checklist - Phase 10 (Gate 3 & Asynchronous PR Iteration)

### Phase 10.1: Refactor Gate 3 in development-process.md
- [x] Update Phase 6 (Gate 3) of `development-process.md` to outline the draft-creation, chat approval, ready-state transition, and clean session-closing steps
- [x] Explicitly direct the developer to initiate a separate, asynchronous review-comment resolution session upon receiving comments

### Phase 10.2: Refactor resolve-pr-reviews.md Workflow
- [x] Update `.agent/workflows/resolve-pr-reviews.md` to define a rigorous, step-by-step procedure for analyzing, evaluating, responding to, refactoring, and programmatically resolving comments in a fresh session

### Phase 10.3: Verification, Authentic Review & Layer 3 Push
- [ ] Run actionlint and markdown linters to verify workflow document correctness
- [ ] Present the unstaged diff for final visual review in the chat, stage changes, and push using the zero-bypass `commit-push.sh` skill (TTY Gate 2) to complete this feature branch and prepare Gate 3 draft PR creation!
