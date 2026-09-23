## Description

This PR introduces external turn-budget tracking and handoff checkpointing to the orchestrator agent sessions, alongside a modular restructuring of the agent test suite.

### Key Changes

1. **Turn Budget Tracking & Sandboxing (`agent-scripts/lib/turn-accounting.js`, `agent-scripts/lib/agent-runner.js`)**:
   - Added `TurnTracker` supporting both SDK session event hooks (`tool_call`, `tool_result`) and content stream fallback inspection with turn latching.
   - Introduced dynamic turn budgeting based on model tier (`getMaxTurnsForModel`).
   - Added interactive exhaustion prompts (`promptTurnBudgetExhaustion`) with non-interactive CI fallback.
   - Implemented `requestHandoffSummary` which safely disarms active tools and requests a structured markdown status checkpoint upon budget exhaustion.
   - Restored tool unregistration when `isolate: true` so all tools other than `no_op` are explicitly removed.

2. **QA Output Fail-Closed Security (`agent-scripts/lib/utils.js`, `agent-scripts/orchestrator.js`)**:
   - Maintained fail-closed security for `approval_status`: omitted status is never inferred as `APPROVED`, ensuring malformed or truncated responses cannot bypass verification.
   - Updated the QA prompt and validation logic to require explicit status checks.

3. **Test Suite Modularization & Zero-Dependency Migration**:
   - Replaced monolithic `agent-scripts/tests/hook.test.js` with modular, focused tests under `agent-scripts/lib/`:
     - `agent-runner.test.js`
     - `git-release.test.js`
     - `turn-accounting.test.js`
     - `utils.test.js`
     - `.gemini/hooks/block-restricted-commands.test.js`
   - Hardened `parseJSON` in `block-restricted-commands.test.js` using a reverse-scanning line parser to robustly handle complex or nested outputs.
   - Updated `package.json` test runner glob to execute all modular suites.
   - Updated `run_agent_script_tests` in `.github/workflows/scripts/test.sh` to dynamically discover test files across `agent-scripts/` and `.gemini/hooks/`, ensuring the `Agent Script Unit Tests` CI job passes without the deprecated `agent-scripts/tests/` directory.

4. **Configuration & Housekeeping**:
   - Added agent `maxTurns` overrides in `.gemini/settings.json`.
   - Ignored logs and PDF outputs in `.gitignore`.

---

## Verification

- Ran the full test suite via `npm test` (77 passing tests).
- Ran `bash .github/workflows/scripts/test.sh agent-scripts` (32 passing tests).
- Ran `bash .github/workflows/scripts/test.sh workflow-scripts` (45 passing tests).
- Ran `bash .github/workflows/scripts/lint.sh shellcheck` (passed cleanly).
