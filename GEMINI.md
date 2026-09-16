# Gated Agentic Framework Instructions

This file documents team-shared conventions, repository-wide workflows, and architectural rules for the Agentic Framework.

## 1. 🚀 Plan Source of Truth & Gate 1 (Task Enforcer)

- **Source of Truth:** `plan-metadata.json` (located in the session target directory) is the **sole, absolute source of truth** for plan implementation.
- **User Consumption:** The TOML plan file (located under `plans/`) is strictly for human-user consumption, status-tracking, and visualization.
- **Workflow & Updates:** Any plan updates, additions, or task state changes **MUST** be written to `plan-metadata.json` first as a structured tasks JSON array (`"plan": { "tasks": ["task 1", "task 2"] }`). The pre-tool hooks and write utilities will then programmatically compile and update the TOML plan file under `plans/` automatically. Implementation agents must strictly read tasks from `plan-metadata.json` for their execution loops.
- **Plan Requirements:** To pass Gate 1, the tasks array MUST explicitly mention:
  1. Running comprehensive tests.
  2. Satisfying quality gates.
  3. Maintaining the agentic framework.
  4. Updating documentation.

## 2. Session Initialization & Troubleshooting (Start Here)

- **Active State:** Always start by reading `.gemini/tmp/<repo-name>/memory/remediation-state.md` and `MEMORY.md` (where `<repo-name>` is the name of your repository, e.g. `terraform-provider-file`) to retrieve the active task, PR number, and current state.
- **Phase Checking:** Check `.gemini/tmp/<repo-name>/phase-state.json` to verify the active gating phase (Plan, Implement, Review, Commit).

## 3. Pull Request Remediation Workflow

When resolving PR comments, you must strictly follow this loop:

1. **Update Reference Rules:** Translate review comments into strict checking rules in `docs/development/reference/*.toml` (e.g., `JavaScript.toml`).
2. **Reproduce Findings:** Run `node agent-scripts/quality-assurance.js` on the unmodified codebase to ensure the pipeline reproduces the issues.
3. **Iterative 2-Item Loop:** Implement surgical fixes strictly in batches of **two items at a time**. Apply fixes, run validation/linters, and get user agreement before moving to the next pair.
4. **Final Review:** Run tests and `quality-assurance.js` again to get 0 findings and the `review-approval.json` signature (Gate 2).
5. **Resolve Comments:** Execute `node agent-scripts/manage-pr-comments.js` to resolve GitHub threads.

## 4. Ask User & Commit Gate (Gate 3)

- All `ask_user` intents are strictly allowlisted (`plan approval`, `commit approval`, `clarification`, `suggest action`).
- **Approval Format:** `plan approval` and `commit approval` MUST strictly use valid JSON in the metadata files on disk. For the `ask_user` call, present a clean Markdown description of the action.
