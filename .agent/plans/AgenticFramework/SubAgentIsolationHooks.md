# Agentic Framework: Programmatic Sub-Agent Isolation and Hook Delegation

- **Executed Date:** 2026-08-17
- **Purpose:** Enforces strict programmatic isolation on sub-agents (making them read-only and restricted) and offloads signature generation entirely to native CLI hooks (`AfterTool` on `invoke_agent`). This guarantees that approvals are physically generated only after the successful completion of isolated agent execution, removing all spoofing vectors.

---

## Architectural Blueprint

### 1. Sub-Agent Isolation (The Tool Principle)

In the Gemini CLI, sub-agents are constrained by the `tools` array defined in their `.md` definition files. By physically removing `write_file`, `replace`, and `run_shell_command` from these arrays, the sub-agents are strictly read-only and mathematically incapable of modifying the workspace.

- **Review Agent (`review_agent.md`)**:
  - Remove `run_shell_command` and `write_file`.
  - Toolset: `[read_file]`.
  - It becomes a strictly read-only reviewer.

- **Testing Agent (`testing_agent.md`)**:
  - Create a new agent for running tests and verifying builds.
  - Toolset: `[read_file, run_shell_command]`.
  - The testing agent is allowed to run tests and linters, but its `run_shell_command` is monitored by our existing safety hooks. It cannot commit, push, or modify the TOTP/Age secrets.

### 2. The Native Approval Mechanism (`AfterTool` on `invoke_agent`)

To decouple signature generation from the main agent, we will hook the tool invocation lifecycle.

- **Hook:** Add an `AfterTool` hook on `invoke_agent` in `.gemini/settings.json`.
- **Logic:** The hook script (`.agent/hooks/after-invoke-agent.js`) will execute automatically whenever the main agent finishes running a sub-agent.
- **Workflow:**
  1. The hook parses `tool_input.agent_name` to identify the sub-agent.
  2. It intercepts the sub-agent's final report (`tool_response.llmContent`).
  3. It writes the exact, unedited report to `~/.gemini/tmp/.../logs/<agent_name>_report.md` so the main agent can read it later if there are failures.
  4. It evaluates the success of the sub-agent run:
     - **For `testing_agent`:** Did all tests pass? (We will parse the report or check the exit code of tests).
     - **For `review_agent`:** Did the report contain "0 findings" or a specific "Approved" keyword?
  5. If successful, the hook _natively_ writes `test-approval.json` or `review-approval.json` to the secure tmp directory, chaining the `diff_hash` and `plan_hash` automatically.
  6. The main agent is completely cut out of the signature writing process!

### 3. Nix Platform Safety (Darwin vs Linux)

Since the Nix development shell is executed on Linux-based CI/CD systems, we must ensure that any macOS-specific packages are not included unconditionally in the Linux package set.

- **Remediation:** Gate `pkgs.age-plugin-se` inside `flake.nix` behind `pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.age-plugin-se ]`.

### 4. GHA Script Injection Prevention

Direct interpolation of context variables (like `${{ github.base_ref }}`) inside GHA `run:` shell command lines can be exploited to execute arbitrary shell code via crafted branch names.

- **Remediation:** Move all context-interpolated variables inside `.github/workflows/pull_request.yaml` to the job or step-level `env:` block, and reference them exclusively as safe shell environment variables (e.g. `"$BASE_REF"`).

### 5. GHA Comment Trigger Trust Checks & Skipped Runs

Comment-triggered workflows (like `review-trigger.yml`) currently run on any commenter's posts. To prevent unauthorized users or automated comment threads from triggering a `/merge` or activating executor jobs, we must validate comments strictly.

- **Remediation:**
  1. Add strict author association checks to allow `/merge` commands only from trusted contributors (`OWNER`, `MEMBER`, `COLLABORATOR`).
  2. Move the comment text filter to job-level `if:` blocks so that non-matching comment events are gracefully skipped (skip-state) instead of executing and failing noisily, reducing clutter and preventing required-status-check deadlocks.

### 6. Thin Javascript GHA Loaders

Embedded javascript code blocks inside `.github/workflows/pr-executor.yml` must remain minimal.

- **Remediation:** Re-use the existing, robust `.github/workflows/scripts/get-open-prs.js` script to locate and view target PRs, keeping the inline GHA step as a minimal loader.

---

## Implementation Checklist

### Phase 1: Sub-Agent Configuration Hardening

- [x] Edit `.agent/agents/review_agent.md` to remove `run_shell_command`. It must only have `read_file`.
- [x] Create `.agent/agents/testing_agent.md` with `run_shell_command` and `read_file` to execute the local test suites and linters.
- [x] Refactor the prompt instructions in both agent files to clearly state their output format (so the hook can parse "APPROVED" or "FAILED").

### Phase 2: Hook Development

- [x] Create `.agent/hooks/after-invoke-agent.js`. It must: 1. Write the sub-agent's `tool_response.llmContent` report to disk (e.g. `logs/review_report.md`). 2. If `agent_name === 'testing_agent'` and report == "APPROVED", generate `test-approval.json`. 3. If `agent_name === 'review_agent'` and report == "APPROVED", generate `review-approval.json`. 4. Chain the generation to validate `plan-approval.json` (`plan_hash`) and the current `diff_hash`.
- [x] Update `.gemini/settings.json` to register the `after-invoke-agent.js` hook onto `AfterTool` matching `invoke_agent`.

### Phase 3: Main Agent Skill Cleanup

- [x] Delete `.agent/skills/test-approval.js` (this is now natively handled by the hook).
- [x] Delete `.agent/skills/write-approval.sh` (this is now natively handled by the hook).
- [x] Update `user-approval.js` so it only contains the read-only chained validation logic and the Gate 4 commit verification hook.

### Phase 4: Developer Process Synchronization

- [x] Update `development-process.md` and `review_agent.md` instructions to align with the new read-only agent paradigm.

### Phase 5: GHA & Nix Security Hardening (PR Findings Remediation)

- [x] Update `.gemini/agents/review_agent.md` to add strict Nix platform package gating rules.
- [x] Modify `flake.nix` to gate `age-plugin-se` behind `pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.age-plugin-se ]`.
- [x] Modify `.github/workflows/pull_request.yaml` to pass base and head references securely via the `env:` block.
- [x] Modify `.github/workflows/review-trigger.yml` to gate the execution job with job-level `if:` on author association and `/merge` pattern matches.
- [x] Modify `.github/workflows/pr-executor.yml` to refactor the inline PR-fetching javascript step to delegate to `get-open-prs.js`.

### Phase 6: Resolving Post-Commit PR Comments

- [x] Register `block-secrets.js` hook on `run_shell_command`, `write_file`, and `replace` matchers in `.gemini/settings.json`.
- [x] Remove unused `path` import from `.agent/hooks/block-secrets.js` to ensure ESLint compliance.
- [x] Add strict alphanumeric/symbol allowlist validation (`^[a-zA-Z0-9_./-]+$`) to `BASE_REF` in `.github/workflows/pull_request.yaml` before running git commands.
- [x] Harden Gate 1 validation inside `.agent/hooks/after-invoke-agent.js` to strictly check `plan-approval.challenge` hash chain.

### Phase 7: Local Gaps Resolution (Hardening Local Tests & Linters)

- [x] Update `eslint.config.mjs` to enable `'no-unused-vars': 'error'` globally and remove all ignore patterns to enforce strict warnings.
- [x] Create a comprehensive unit test suite `.github/workflows/scripts/tests/hooks.test.js` to test all enforcer hooks (`block-secrets.js`, `enforce-planning.js`, `after-ask-user.js`, etc.) using `node:test` and `node:assert`.
- [x] Surgically refactor all catch blocks, destructured parameters, and test mocks to resolve all unused-variable linter errors cleanly.
- [x] Verify that all 29 GHA tests + our new hook unit tests pass cleanly.

### Phase 8: Central Template Repository Synchronization

- [x] Update `.boilerplate-sync.json` to register all our new agent hooks, skills, and unit tests, and remove deleted legacy skills.
- [ ] Push our newly refactored agentic framework files to the centralized template repository using `.agent/skills/sync-boilerplate.sh --push`.
