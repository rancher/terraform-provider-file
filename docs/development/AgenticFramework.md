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

### 🔄 The Combined End-to-End Lifecycle

This integrated narrative traces how these components operate together to execute a standard codebase change:

1. **Phase 1: Research & Reproduce**: The developer or agent initializes a task according to the **Development Process**, reproducing any bug state with an empirical test.
2. **Phase 2: Planning & Blueprinting**: The developer draft a specification checklist under `docs/development/`. Before any file edits are allowed, the **Planning Hook** intercepts execution to verify the plan's presence and hash, prompting Touch ID to GPG-sign and write the planning gate signature (`plan-approval.json`).
3. **Phase 3: Implementation**: The agent executes the change in place, adhering strictly to the **Strict Output Style** or **Conversational Output Style** rules. If external boilerplates are edited, the **Boilerplate Sync Skill** ensures synchronizations are safe and clean.
4. **Phase 4: Proactive Quality & Testing**: Once changes are ready, the developer runs the test and linter suites. The **Testing Hook** intercepts the subagent execution, validating the outcome and signing the testing gate (`test-approval.json`). The **Review Hook** then invokes our specialized, hardened **Review Subagent** (`review_agent`) to evaluate the active diff, signing the review gate (`review-approval.json`).
5. **Phase 5: Chunking & Commit**: Once all three gates are securely verified and chained on disk, the developer initiates the **Commit Gate**, which triggers Touch ID biometrics via the **Cryptographic Gating Hook** to GPG-sign, commit, and push the active changes cleanly to GitHub.

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
