# Agentic Framework & Developer Tooling

This topic overview details the architecture, capabilities, and execution workflows of the repository's secure developer automation and agentic framework.

---

## Abstract

The Agentic Framework represents a secure, zero-trust developer environment designed to optimize and coordinate human engineers and autonomous subagents. By utilizing containerized sandboxing, Apple Secure Enclave biometric gating, and event-driven hooks, the framework ensures absolute codebase integrity, strict process compliance, and rapid software delivery with zero cognitive drag.

---

## 🧭 How Our Framework Components Work Together

Our framework is comprised of 9 closely integrated components that work together dynamically to guide developers and agents through the software development lifecycle:

### 1. Architectural & Process Specifications

These specifications establish the step-by-step procedures and rules for executing modifications, resolving reviews, or debugging pipeline errors:

- **Development Process**: Defines our unified 7-step development lifecycle off of the `main` branch, structured around three authoritative approval gates. More details can be found in **[Standard Development Process](./AgenticFramework/DevelopmentProcess.md)**.
- **PR Review Resolution**: Governs our asynchronous PR comment resolution workflow, separating comment timeline parsing, evaluation, and manual fixes. More details can be found in **[Asynchronous PR Review Resolution](./AgenticFramework/ResolvePRReviews.md)**.
- **Workflow Troubleshooting**: Establishes standard log-retrieval techniques, parsing, and diagnostic approaches to resolve CI/CD and release workflow failures. More details can be found in **[CI/CD Workflow Troubleshooting](./AgenticFramework/TroubleshootWorkflows.md)**.

### 2. Gating, Safety & Security Infrastructure

These components form our zero-bypass security sandbox, preventing unauthorized code modification, secret leaks, or command injection:

- **Secure Workflows & Hooks**: Intercepts unvetted direct `git commit`/`push` commands and enforces the presence of signed planning blueprints prior to any file writes. More details can be found in **[Secure Workflows & Hook Enforcements](./AgenticFramework/SecureWorkflowsAndHooks.md)**.
- **Cryptographic Gating**: Coordinates Apple Secure Enclave / Touch ID developer biometrics and chains planning, testing, and review gate signatures. More details can be found in **[Cryptographic Gating & Approvals](./AgenticFramework/GatingAndApprovals.md)**.
- **Workflow Optimization & Subagent Design**: Configures our custom specialized subagents (`review_agent` and `testing_agent`) with hardened, read-only permissions and prunes mechanical style checks from core LLM prompts. More details can be found in **[Workflow Optimization & Design](./AgenticFramework/WorkflowDesign.md)**.
- **Review Subagent**: Detailed specifications and sandboxing parameters for our pre-commit Review Agent. More details can be found in **[Review Subagent](./AgenticFramework/ReviewAgent.md)**.
- **Testing Subagent**: Detailed specifications and orchestration capabilities for our automated Testing Agent. More details can be found in **[Testing Subagent](./AgenticFramework/TestingAgent.md)**.
- **Claude Code Integration**: Documents how this same gated process is implemented for Claude Code via its own native primitives, in parallel with the Gemini CLI implementation described above. More details can be found in **[Claude Code Integration](./AgenticFramework/ClaudeCodeIntegration.md)**.

### 3. Shared Skills & Persona Formatting Guidelines

These utilities and formatting styles maintain clean, high-signal, and standardized communication during collaborative engineering:

- **Boilerplate Sync Skill**: Implements our manifest-driven, shallow-cloned boilerplate file syncing and exit-trap cleanup procedures. More details can be found in **[Boilerplate Sync Skill](./AgenticFramework/BoilerplateSync.md)**.
- **Strict Output Style**: Rules and structural guidelines for the high-signal, zero-chitchat agent response persona. More details can be found in **[Formatting Style - Strict](./AgenticFramework/OutputStyleStrict.md)**.
- **Conversational Output Style**: Rules and structural guidelines for the collaborative peer partner response persona. More details can be found in **[Formatting Style - Conversational](./AgenticFramework/OutputStyleConversational.md)**.

---

### 🔄 The Combined End-to-End Lifecycle (6-Phase Gated Pipeline)

The framework coordinates developers and agents through a strict, zero-bypass 6-phase lifecycle that guarantees codebase integrity:

1. **Phase 1: Research Phase**
   - Active exploration, script execution, and information gathering are allowed.
   - Any modifications to codebase files are strictly ephemeral: entering the subsequent Plan phase automatically triggers `git reset --hard` and `git clean -fd` to wipe all uncommitted changes.
   - Prevents un-planned or accidental "experimental" code from leaking into the workspace.

2. **Phase 2: Plan Phase**
   - Developer drafts plans inside `docs/development/` detailing implementation specifications.
   - Plan approval is requested via `ask_user`. A positive human response cryptographically GPG-signs the plan and writes a valid `plan-approval.json` seal to disk.
   - Exiting the Plan phase switches the repository to a dedicated `feature/<plan-name>` branch and resets any intermediate dirty state.

3. **Phase 3: Implement Phase**
   - Source code modifications are authorized _only_ in this phase.
   - Interceptor hooks (`enforce-planning.js`) verify that a valid plan seal (`plan-approval.json`) is active. If missing or invalid, all source edits are denied!
   - Continuous Invalidation: the moment a source file is touched, any downstream approvals (`test-approval.json`, `review-approval.json`, `user-approval.json`) are immediately deleted.

4. **Phase 4: Test Phase**
   - Code modifications are blocked. The Testing Subagent (`testing_agent`) is executed to run all test suites and linters.
   - Signs `test-approval.json` _only_ after all tests succeed. If a test fails, the signature is revoked and the phase cannot be exited.

5. **Phase 5: Review Phase**
   - Conducts a high-rigor review by `review_agent` evaluating the active diff against security, standards, and spelling guidelines.
   - An automation audit is conducted: if a caught issue could have been detected in testing, a test is implemented and the review is failed.
   - Signs `review-approval.json` only after complete sign-off.

6. **Phase 6: Commit Phase**
   - Requires Plan, Test, and Review approvals.
   - Direct manual `git commit` or `git push` is unconditionally blocked for AI agents.
   - Exiting the Commit phase automatically triggers GPG-signed commits, pushing, and draft PR generation via authorized system hooks and biometric approval.

---

## Consolidated Historical Milestone Checklist

### Phase 1: Create Root Routing Files

- [x] Create root routing files (`GEMINI.md`, `CLAUDE.md`, `.github/copilot-instructions.md`)

### Phase 2: Create the Master Instructions File

- [x] Create the master instructions file (`AGENTS.md`)

### Phase 3: Scaffold the `.gemini` Directory Structure

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
