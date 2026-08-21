# Gemini CLI System Instructions & Agent Protocols

This is the absolute source of truth for the Gemini Code Assist CLI operating within this repository.

---

## 1. Governance & Centralized Topic Blueprints

The repository's architecture, processes, and conventions are governed by two centralized **Topic blueprints**. You MUST consult these Topics as your primary entry points for all research and implementation details:

1. **[Agentic Framework & Development Process Topic](docs/development/AgenticFramework.md)**
   - Governs the 6-phase development lifecycle, GPG/Touch ID cryptographic gating, workspace isolation, and automated PR pipelines.
2. **[Coding Standards & Component Specifications Topic](docs/development/CodingStandards.md)**
   - Governs all language-specific rules (Go, Terraform, workflows, scripts), file formatting, spelling safeguards, and blueprint conventions.

---

## 2. The 6-Phase Gated Lifecycle

You operate strictly within a zero-bypass, 6-phase gated lifecycle designed to guarantee codebase stability and cryptographic security:

1. **Phase 1: Research Phase** (Active exploration; all uncommitted changes are strictly ephemeral and are discarded when entering the subsequent Plan phase).
2. **Phase 2: Plan Phase** (Enter **Plan Mode** to draft an imperative execution plan with step-by-step checklists in your temp session directory; solicit human approval via `ask_user` to cryptographically sign the plan).
3. **Phase 3: Implement Phase** (Apply surgical changes on the feature branch. Source edits are strictly blocked unless a valid `plan-approval.json` seal is active. Touching files automatically invalidates downstream signatures).
4. **Phase 4: Test Phase** (Sparks the testing subagent to execute linters and test suites; signs `test-approval.json` only upon 100% green status).
5. **Phase 5: Review Phase** (Sparks the review subagent to audit the diff for security, conventions, and spelling, validating that no issues caught in review could have been automated in testing; signs `review-approval.json`).
6. **Phase 6: Commit Phase** (Validates Plan, Test, and Review signatures; triggers GPG commits, remote pushes, and draft PR generation out-of-band via system hooks upon developer Touch ID biometric validation).

---

## 3. Git & Workspace Security Rules

- **No Direct Commits/Pushes:** You are strictly forbidden from running manual `git commit` or `git push` commands, or directly invoking commit/push scripts. All commits and pushes are managed automatically out-of-band by system hooks upon biometric touch-off.
- **No Upstream Pushes:** You are strictly forbidden from pushing code to the upstream "rancher" remote. All remote pushes must target the developer's authorized fork.
- **Developer Review First:** You are an assistant, not a primary committer. All changes must reside unstaged in the developer's active working tree for visual IDE review. You must never commit changes without presenting the exact unstaged diff in the chat and soliciting GPG-signed commit approval via the `ask_user` commit gate.

---

## 4. Directory Structure Mapping

Explore the repository dynamically using search tools (`glob`, `grep_search`). The primary workspace controls are organized as follows:

- **`.gemini/`**: Project-level automation controls (hooks, settings, skills, and specialized subagents).
- **`.claude/`**: Project-level Claude settings and hooks.
- **`.githooks/`**: Tracked native Git hooks enforcing Gate validation rules recursively.
- **`agent-scripts/`**: Shared core logic (planning/gating checks, git-safety checks, and phase manager state).
- **`docs/development/`**: Persistent, declarative technical blueprints and Topic overviews.

---

## 5. Tool Use Guidelines

- **Hermetic Environment:** Always operate inside the active Nix shell context (`nix develop`).
- **Declarative Prioritization:** Always prioritize built-in platform capabilities and ESM JavaScript scripts over raw shell commands.
- **Dynamic Context Discovery:** When looking for specific scripts, configs, or specs, run targeted searches rather than loading large directories. If you need usage guidance or features help, run `/help` or invoke the specialized helper agents (`testing_agent`, `review_agent`).
