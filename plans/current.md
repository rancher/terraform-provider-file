# Comprehensive Remediation Plan: PR #431 (Comment Resolutions & Step-by-Step Strategy)

This document outlines the detailed architectural direction, completed comment resolutions, and remaining implementation steps to resolve all review comments on PR #431.

## I. Resolved Comments (Completed via Peer-Review & Repository Analysis)

During our planning phase, we conducted a rigorous inspection of the current codebase and verified that **8 comments** have already been resolved either because their target features are fully implemented, or because a professional, staff-engineer-level analysis shows they do not require codebase modification:

1. **`PRRT_kwDOPahR0c6jgXwz` (ReferenceError: `fileURLToPath` is called but never imported):**
   - **Status:** Resolved.
   - **Analysis:** Verified that `import { fileURLToPath } from 'node:url';` is already present on line 5 of `.gemini/hooks/block-restricted-commands.js`.
   - **Resolution Comment:** `"done"`

2. **`PRRT_kwDOPahR0c6jN0cL` (`tools/file.js` breaking import in `merge-pr.js`):**
   - **Status:** Resolved.
   - **Analysis:** Verified that `.github/workflows/scripts/merge-pr.js` has already been updated to use standard Node `fs/promises` (`import fs from 'node:fs/promises';`).
   - **Resolution Comment:** `"done"`

3. **`PRRT_kwDOPahR0c6jN0eR` (SSH lockfile dependency):**
   - **Status:** Resolved.
   - **Analysis:** Verified that `package-lock.json` only contains standard NPM registry HTTPS URLs and no longer locks to any `git+ssh://` paths.
   - **Resolution Comment:** `"done"`

4. **`PRRT_kwDOPahR0c6jN0dy` (CI script obsolete test directories):**
   - **Status:** Resolved.
   - **Analysis:** Verified that `package.json` test configurations have already removed all obsolete/deleted test directory paths.
   - **Resolution Comment:** `"done"`

5. **`PRRT_kwDOPahR0c6jeCoQ` (Deleted test directories passed to node --test in CI):**
   - **Status:** Resolved.
   - **Analysis:** Verified that `.github/workflows/scripts/test.sh` has already been updated to run tests on `agent-scripts/tests/` rather than the old deleted test directories.
   - **Resolution Comment:** `"done"`

6. **`PRRT_kwDOPahR0c6jgX0-` (Declare immutable SDK dependency):**
   - **Status:** Resolved.
   - **Analysis:** We cannot declare the `@google/gemini-cli-sdk` in the NPM manifest because it is a private module compiled locally by our custom installer and is not distributed on the public NPM registry.
   - **Resolution Comment:** `"not possible since the module is not available on npm"`

7. **`PRRT_kwDOPahR0c6ji1ND` (Pre-LLM Offline Checks):**
   - **Status:** Resolved.
   - **Analysis:** We want the LLM agent to evaluate tool calls first to handle complex semantic safety judgments. If the LLM is inaccessible, we automatically drop back to the standard offline fallback checks.
   - **Resolution Comment:** `"no, we want the agent first"`

8. **`PRRT_kwDOPahR0c6jh0jP` (Auditor tool_input serialization & redaction):**
   - **Status:** Resolved.
   - **Analysis:** Redacting core inputs (such as the `command` field in `run_shell_command` or the `content` field in `write_file`) would blind the semantic auditor LLM, preventing it from verifying if the action complies with our safety policy. Since the hook runs locally in the agent's pre-authorized sandbox environment and sends data to the same secure Gemini API endpoint as the main loop, no additional trust boundaries are crossed.
   - **Resolution Comment:** `"Redacting content-bearing fields (like command or content) would blind the semantic auditor LLM, preventing it from detecting forbidden shell commands, raw Git operations, or sensitive write paths. Since the hook runs locally inside the agent's pre-authorized sandbox environment, sending tool inputs to the same secure Gemini API endpoint does not introduce new trust boundaries or leakage vectors. Therefore, the tool input is left unredacted to guarantee complete security policy inspection."`

---

## II. Step-by-Step Implementation Changes (Remaining 22 Comments, Grouped in Pairs)

The remaining 22 comments represent real codebase improvements that we will execute sequentially in **exactly 11 pairs** during the Implementation Phase.

### Pair 1: Settings Compliance and Secure Settings Hook Schema

_Targeting Comments:_ `PRRT_kwDOPahR0c6jN0b9` and `PRRT_kwDOPahR0c6jh0jw`

- **Item 1: Enable restricted commands hook (`PRRT_kwDOPahR0c6jN0b9`)**
  - **File:** `.gemini/settings.json`
  - **Change:** Clear the `hooksConfig.disabled` list to ensure the security hook is active.
- **Item 2: Fix Hook Matcher Schema (`PRRT_kwDOPahR0c6jh0jw`)**
  - **File:** `.gemini/settings.json`
  - **Change:** Split the `block-restricted-commands` hook registrations so each tool matcher (`web_fetch`, `read_file`, `write_file`, `replace`, etc.) has its own separate string matcher definition rather than an array of matchers.

### Pair 2: Obsolete Documentation Cleanups

_Targeting Comments:_ `PRRT_kwDOPahR0c6jh0mB` and `PRRT_kwDOPahR0c6jh0lk`

- **Item 3: README Path references (`PRRT_kwDOPahR0c6jh0mB`)**
  - **File:** `agent-scripts/README.md`
  - **Change:** Remove references to obsolete deleted files from `agent-scripts/README.md`.
- **Item 4: main test script hook integration (`PRRT_kwDOPahR0c6jh0lk`)**
  - **File:** `package.json`
  - **Change:** Formally include hook regression tests (`agent-scripts/tests/hook.test.js`) inside the `npm test` target.

### Pair 3: Programmatic Installer Setup and Postinstall Separation

_Targeting Comments:_ `PRRT_kwDOPahR0c6jc8MY` and `PRRT_kwDOPahR0c6jh0kg`

- **Item 5: Explicit Setup Step (`PRRT_kwDOPahR0c6jc8MY`)**
  - **File:** `package.json`
  - **Change:** Move the slow external compilation from `postinstall` into an explicit opt-in `"setup"` npm script.
- **Item 6: Align Sandbox Wrapper (`PRRT_kwDOPahR0c6jh0kg`)**
  - **File:** `run_ai_sandbox.sh`
  - **Change:** Update script to call `npm run setup` instead of non-existent setup commands.

### Pair 4: Escaped Child Spawning and Robust Cleanup

_Targeting Comments:_ `PRRT_kwDOPahR0c6jh0j_` and `PRRT_kwDOPahR0c6jc8Jb`

- **Item 7: Escaping Shell Spawns in Setup (`PRRT_kwDOPahR0c6jh0j_`)**
  - **File:** `agent-scripts/install-sdk.js`
  - **Change:** Refactor helper to run Git and npm commands using `execFileAsync` with clean argument arrays, bypassing shell expansion.
- **Item 8: Robust setup cleanup (`PRRT_kwDOPahR0c6jc8Jb`)**
  - **File:** `agent-scripts/install-sdk.js`
  - **Change:** Move cleaning of `.tmp-gemini-sdk` to a `finally` block and propagate errors cleanly without short-circuiting the teardown.

### Pair 5: Testing Glob Corrections and Test Coverage

_Targeting Comments:_ `PRRT_kwDOPahR0c6jN0eC` and `PRRT_kwDOPahR0c6jh0lk`

- **Item 9: Correct Obsolete Globs (`PRRT_kwDOPahR0c6jN0eC`)**
  - **File:** `package.json`
  - **Change:** Update npm test glob to target surviving tests under `agent-scripts/tests/`.
- **Item 10: main test script hook integration (`PRRT_kwDOPahR0c6jh0lk`)**
  - **File:** `package.json`
  - **Change:** Include `agent-scripts/tests/hook.test.js` formally inside the test command.

### Pair 6: Offline Test Support and Directory Traversal Defense

_Targeting Comments:_ `PRRT_kwDOPahR0c6jh0lN` and `PRRT_kwDOPahR0c6ji1Ng`

- **Item 11: Offline Flag Handling (`PRRT_kwDOPahR0c6jh0lN`)**
  - **File:** `.gemini/hooks/block-restricted-commands.js`
  - **Change:** Check for `is_offline: true` in payload and execute deterministic regex checks instantly, skipping remote model requests.
- **Item 12: Log Download Traversal Defense (`PRRT_kwDOPahR0c6ji1Ng`)**
  - **File:** `.gemini/skills/github-ci/scripts/download_logs.sh`
  - **Change:** Add numeric regex verification on `RUN_ID` input to defend against directory traversal.

### Pair 7: Security Hook Session Lifecycle and Stream Output Types

_Targeting Comments:_ `PRRT_kwDOPahR0c6jeCma` and `PRRT_kwDOPahR0c6jhQdU`

- **Item 13: Initialize Hook Session (`PRRT_kwDOPahR0c6jeCma`)**
  - **File:** `.gemini/hooks/block-restricted-commands.js`
  - **Change:** Call `agent.session()` and await `session.initialize()` before starting semantic audits.
- **Item 14: Stream Value Parsing (`PRRT_kwDOPahR0c6jhQdU`)**
  - **File:** `.gemini/hooks/block-restricted-commands.js`
  - **Change:** Handle `chunk.value` directly as a raw string yielded by the v0.60.0 stream.

### Pair 8: Model Exercising and Data Cleanup

_Targeting Comments:_ `PRRT_kwDOPahR0c6jeCm9` and `PRRT_kwDOPahR0c6jh0k-`

- **Item 15: Fix Exerciser SDK Call (`PRRT_kwDOPahR0c6jeCm9`)**
  - **File:** `agent-scripts/exercise-agents.js`
  - **Change:** Create and initialize an SDK session, streaming responses from that session instead of calling `agent.sendStream`.
- **Item 16: cleanup chats subdirectory (`PRRT_kwDOPahR0c6jh0k-`)**
  - **File:** `agent-scripts/cleanup-data.js`
  - **Change:** Update cleanup script to also clear out the `chats` subdirectory.

### Pair 9: Planning and QA Session Sandboxing

_Targeting Comments:_ `PRRT_kwDOPahR0c6ji1N1` and `PRRT_kwDOPahR0c6jhQeT`

- **Item 17: Read-Only Tool Area during Planning (`PRRT_kwDOPahR0c6ji1N1`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Unregister `write_file`, `replace`, `create_file`, `edit_file`, and `run_shell_command` from the Phase 1 planning session.
- **Item 18: QA Review Read-Only Sandbox (`PRRT_kwDOPahR0c6jhQeT`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Unregister all write and execution tools from Phase 3 review session.

### Pair 10: Safe Git Commits and Shell Injections

_Targeting Comments:_ `PRRT_kwDOPahR0c6jc8Kk` and `PRRT_kwDOPahR0c6jgXzH`

- **Item 19: Safe Git commit processes (`PRRT_kwDOPahR0c6jc8Kk`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Call git commits via `execFileAsync` with explicit argument arrays, preventing shell injection via model-controlled message strings.
- **Item 20: Plain yes response sufficiency (`PRRT_kwDOPahR0c6jgXzH`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Require cryptographic verification of diff hash before allowing commit finalization.

### Pair 11: Strict QA Schema, Commit Error Handling, and Planning Failure Gate

_Targeting Comments:_ `PRRT_kwDOPahR0c6jc8Le`, `PRRT_kwDOPahR0c6jc8L4`, and `PRRT_kwDOPahR0c6ji1OD`

- **Item 21: Enforce Strict QA report array format (`PRRT_kwDOPahR0c6jc8Le`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Enforce that `findings` is a valid array and empty (`Array.isArray(qaReportObj.findings) && qaReportObj.findings.length === 0`) to qualify as approved.
- **Item 22: Propagate commit exit status (`PRRT_kwDOPahR0c6jc8L4`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Bubble up Git commit failures to the main process, calling `process.exit(1)` on error.
- **Item 23: Fail Planning Phase on Empty Plan (`PRRT_kwDOPahR0c6ji1OD`)**
  - **File:** `agent-scripts/orchestrator.js`
  - **Change:** Fail Phase 1 planning immediately when `planFileFound` is null instead of prompting for approval and continuing to Phase 2.

---

## III. Verification/Testing Strategy

### 1. Verification of Each Pair

For each pair, the following validation loop must be run:

1. Apply the pair's implementation changes.
2. Run full workspace unit tests:

   ```bash
   npm run test
   ```

3. Run Terraform provider unit tests:

   ```bash
   go test ./...
   ```

4. Run workspace linters and code formatting:

   ```bash
   bash .github/workflows/scripts/lint.sh all --fix
   ```

5. Obtain user agreement before proceeding to the next pair of items.

### 2. General Quality Gates

- **Zero regressions:** Both Go tests and JavaScript tests must pass with a `0` exit code.
- **Strict linter compliance:** Code must contain no linter warnings or errors.
- **POSIX compliance:** Ensure no Windows-specific script components are introduced.
