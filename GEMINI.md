# Gated Agentic Framework Instructions

This file documents team-shared conventions, repository-wide workflows, and architectural rules for the Agentic Framework.

## 🚀 Plan Source of Truth (Task Enforcer)

- **Source of Truth:** `plan-metadata.json` (located in the session target directory) is the **sole, absolute source of truth** for plan implementation.
- **User Consumption:** The Markdown plan file (located under `plans/`) is strictly for human-user consumption, status-tracking, and visualization.
- **Workflow & Updates:** Any plan updates, additions, or task state changes **MUST** be written to `plan-metadata.json` first as a structured tasks JSON array (`"plan": { "tasks": ["task 1", "task 2"] }`). The pre-tool hooks and write utilities will then programmatically compile and update the Markdown plan file under `plans/` automatically. Implementation agents must strictly read tasks from `plan-metadata.json` for their execution loops.
