# Programmatic Orchestrator & Development Scripts

## Abstract

This directory contains our developer-agent orchestration pipeline and standard automation utilities. Our workflow is proactively controlled by the central **Orchestrator** (`agent-scripts/orchestrator.js`), which enforces the Plan -> Implement -> QA -> Commit lifecycle programmatically using the `@google/genai` SDK.

---

## The Simplified 4-Phase Developer Loop

Instead of reactive, fragile hook interceptions, our development lifecycle is steered programmatically by `orchestrator.js`:

1. **Phase 1: Planning (Read-Only)**: The orchestrator restricts the model to read-only actions and generates a plan. The orchestrator pauses and requests explicit developer approval via terminal `readline` before any edits are allowed.
2. **Phase 2: Implementation (Write Access)**: Once approved, the orchestrator initiates the implementation session, enabling the agent to surgically edit code and run local tests.
3. **Phase 3: Automated QA Review (Self-Healing)**: The orchestrator runs `quality-assurance.js` to run linters, tests, and standard validation tools. Any issues are fed back to the implementation agent for automatic correction.
4. **Phase 4: Final User Review & Commit**: The orchestrator shows the unified git diff to the developer in the terminal, asks for confirmation, and creates a signed commit.

---

## 1. Core Orchestrator (`agent-scripts/orchestrator.js`)

The central execution engine using the official `@google/genai` SDK. It coordinates all tool invocations (such as file reads/writes, globbing, running commands, and asking for user feedback) and drives the four development phases sequentially.

---

## 2. Higher-Level Scripts (`agent-scripts/`)

These higher-level automation scripts execute sequences of tools to accomplish complex repository pipeline tasks:

- **`quality-assurance.js`**: Fast, single-pass programmatic Quality Assurance script that compiles, executes unit and linter suites, and delegates code-review audits to the sandboxed `@quality_assurance` agent.
- **`auto-remediate.js`**: Scalable, context-engineered execution engine that parses the remediation worklist, batches target files across sandboxed subagents, and applies surgical fixes.
- **`cleanup-data.js`**: Dynamically detects the active session ID via `logs.json` and purges older, stale temporary directories securely.
- **`manage-pr-comments.js`**: Automates the parsing and resolution of GitHub PR comment threads based on implemented fixes.
- **`run-in-nix.sh`**: Environment bootstrapper to securely run Javascript/Shell tasks in a hermetic, reproducible Nix environment.
- **`sync-boilerplate.js`**: Lightweight utility to compare and synchronize repository configuration and boilerplate files against a central template.
- **`update-action-versions.sh`**: Scans and upgrades outdated third-party GitHub Action dependencies within workflows.
- **`update-modules.sh`**: Scans and upgrades Go dependency modules to keep the provider dependencies up-to-date.

---

## 3. Libraries (`agent-scripts/lib/`) & Tools (`agent-scripts/tools/`)

Foundational, reusable modules and their CLI wrappers that interface with core resources:

- **`file.js`**: Safe path resolution and atomic filesystem reading, writing, and deletion.
- **`gemini.js`**: Spawns subagents with exponential backoff on rate limits.
- **`git.js`**: Performs status parsing, branch resolution, diff accumulation, and command execution.
- **`plan.js`**: Low-level validation rules and structural layout verification for planning documents.
- **`pr.js`**: Interacts with the GitHub CLI (`gh`) to view, update, comment, and resolve threads on Pull Requests.
- **`test.js`**: Low-level execution of unit and linters runners and parsing log files.
- **`workspace.js`**: Dynamically resolves the active user home directory and temporary path for the session.
