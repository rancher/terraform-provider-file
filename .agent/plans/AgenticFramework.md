# Agentic Framework Master Blueprint Index

- **Executed Date:** 2026-08-14
- **Purpose:** Serving as the master architectural index and technical domain guide for the repository's secure developer automation framework, hooks, skills, and security enforcements. Following our modular subdirectory scaling policy, individual system-specific features, checklists, and execution logs are divided into dedicated blueprint files.

---

## Modular Architectural Blueprints Map

The Agentic Framework is organized into scoped, focused blueprints under the dedicated subdirectory `.agent/plans/AgenticFramework/`:

### 1. [Secure Workflows & Hook Enforcements](./AgenticFramework/SecureWorkflowsAndHooks.md)

- **Files Configured**: `.agent/hooks/block-rancher-git.js`, `.agent/hooks/enforce-planning.js`, `.agent/skills/git-sync.sh`
- **Focus**: Intercepts unvetted direct `git commit`/`push` commands, enforces planning gates, and manages high-resilience automatic branch stashes.

### 2. [Cryptographic Gating & Approvals](./AgenticFramework/GatingAndApprovals.md)

- **Files Configured**: `.agent/skills/user-approval.js`, `.agent/skills/write-approval.sh`, `.agent/skills/generate-otp.sh`
- **Focus**: Manages UNIX regular file, symlink, and owner UID validations. Tied cryptographically to current `git diff HEAD` checksum hashes.

### 3. [Workflow Optimization & Prompt Pruning](./AgenticFramework/WorkflowPruningAndOffloading.md)

- **Files Configured**: `.agent/workflows/development-process.md`, `.agent/workflows/resolve-pr-reviews.md`, `.agent/agents/review_agent.md`
- **Focus**: Streamlines developer workflows around Three Authoritative Approval Gates, coordinates asynchronous PR comment reviews, and optimizes agent prompts.

### 4. [Boilerplate Sync Skill](./AgenticFramework/BoilerplateSync.md)

- **Files Configured**: `.agent/skills/sync-boilerplate.sh`, `.boilerplate-sync.json`
- **Focus**: Implements our manifest-driven, shallow-cloned boilerplate file syncing, sandbox validation, and exit-trap cleanup traps.

---

## Consolidated Historical Milestone Checklist

### Phase 1: Create Root Routing Files

- [x] Create root routing files (`GEMINI.md`, `CLAUDE.md`, `.github/copilot-instructions.md`)

### Phase 2: Create the Master Instructions File

- [x] Create the master instructions file (`AGENTS.md`)

### Phase 3: Scaffold the `.agent` Directory Structure

- [x] Create directories and populate README files

### Phase 4: Populate Initial Base Files

- [x] Populate output-styles, rules, skills, and workflows

### Phase 5: Secure Workflows & Interceptors

- [x] Implement initial block-rancher hook and defunct branch safeguards (Migrated to [Hooks Blueprint](./AgenticFramework/SecureWorkflowsAndHooks.md))

### Phase 6: Proactive Review & Hardening Gates

- [x] Implement secure GPG signatures and file verification (Migrated to [Gating Blueprint](./AgenticFramework/GatingAndApprovals.md))

### Phase 7: Three Approval Gates Streamlining

- [x] Consolidate process gateways into 3 clear gates (Migrated to [Workflows Blueprint](./AgenticFramework/WorkflowPruningAndOffloading.md))

### Phase 8: High-Resilience Auto-Stashing Syncs

- [x] Implement auto-stashing in `git-sync.sh` and POSIX TTY prompts (Migrated to [Hooks Blueprint](./AgenticFramework/SecureWorkflowsAndHooks.md))

### Phase 9: Secure Write Anti-Bypass Guardrails

- [x] Restrict tool writes or command spoofing of approvals (Migrated to [Hooks Blueprint](./AgenticFramework/SecureWorkflowsAndHooks.md))

### Phase 10: Asynchronous Draft PR Gating & Iteration

- [x] Implement draft creation and separate resolution procedure (Migrated to [Workflows Blueprint](./AgenticFramework/WorkflowPruningAndOffloading.md))

### Phase 11: Resolving PR Review Comment Hardening

- [x] Resolve 6 PR review comments and harden scripts (Migrated to [Gating Blueprint](./AgenticFramework/GatingAndApprovals.md))

### Phase 12: Cryptographic Developer Gates

- [x] Build user-approval and remove TTY prompts (Migrated to [Gating Blueprint](./AgenticFramework/GatingAndApprovals.md))

### Phase 13: Review Agent Offloading

- [x] Prune trailing whitespace checking guidelines from review agent (Migrated to [Workflows Blueprint](./AgenticFramework/WorkflowPruningAndOffloading.md))
