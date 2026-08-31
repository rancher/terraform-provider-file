# Agentic Framework & Developer Tooling (Conceptual Explanation)

This document provides a reflective, concept-oriented overview of the repository's secure developer automation, zero-bypass security sandbox, and Gated 4-Phase Lifecycle.

---

## Abstract

The Agentic Framework represents a secure, zero-trust developer environment designed to optimize and coordinate human engineers and autonomous subagents. By utilizing containerized sandboxing, Apple Secure Enclave biometric gating, and event-driven hooks, the framework ensures absolute codebase integrity, strict process compliance, and rapid software delivery with zero cognitive drag.

---

## 🧭 How Our Framework Components Work Together

Our framework is comprised of 12 closely integrated components that work together dynamically to guide developers and agents through the software development lifecycle:

### 1. Architectural & Process Specifications

These specifications establish the step-by-step procedures and rules for executing modifications, resolving reviews, or debugging pipeline errors:

- **Development Process:** Defines our unified 7-step development lifecycle off of the `main` branch, structured around three authoritative approval gates.
- **PR Review Resolution:** Governs our asynchronous PR comment resolution workflow, separating comment timeline parsing, evaluation, and manual fixes.
- **Workflow Troubleshooting:** Establishes standard log-retrieval techniques, parsing, and diagnostic approaches to resolve CI/CD and release workflow failures.

### 2. Gating, Safety & Security Infrastructure

These components form our zero-bypass security sandbox, preventing unauthorized code modification, secret leaks, or command injection:

- **Secure Workflows & Hooks:** Intercepts unvetted direct `git commit`/`push` commands and enforces the presence of signed planning blueprints prior to any file writes.
- **Cryptographic Gating:** Coordinates Apple Secure Enclave / Touch ID developer biometrics and chains planning, testing, and review gate signatures.
- **Workflow Optimization & Subagent Design:** Configures our custom specialized subagents with hardened, read-only permissions and prunes mechanical style checks from core LLM prompts.
- **Review Subagents:** Detailed specifications and sandboxing parameters for our pre-commit Review Agents (Heads-Down Coder and Data Scientist).
- **Claude Code Integration:** Documents how this same gated process is implemented for Claude Code via its own native primitives, in parallel with the Gemini CLI implementation.
- **Ask User Component:** Governs the structured TOML format requirements, schema, and templates for all collaborative and gating questions directed to the human developer, validated natively within each phase's submodule.

### 3. Shared Skills & Persona Formatting Guidelines

These utilities and formatting styles maintain clean, high-signal, and standardized communication during collaborative engineering:

- **Boilerplate Sync Skill:** Implements our manifest-driven, shallow-cloned boilerplate file syncing and exit-trap cleanup procedures.
- **Strict Output Style:** Rules and structural guidelines for the high-signal, zero-chitchat agent response persona.
- **Conversational Output Style:** Rules and structural guidelines for the collaborative peer partner response persona.

---

## 🔄 The Combined Gated 4-Phase Lifecycle

This integrated narrative traces how our system coordinates work across 4 development phases and 3 authoritative gates to execute a standard codebase change:

1. **Plan Phase (Gate 1):** The developer and agent research the requirements, write a failing reproduction test if fixing a bug, and draft an imperative plan checklist under `plans/` in the session workspace. Before any code files can be modified, the **Planning Gate (Gate 1)** intercepts execution to verify the plan's validity, prompting GPG/Touch ID biometrics to write the planning signature (`plan-approval.json`).
2. **Implement Phase:** The agent surgically implements the changes on disk off the approved plan checklist, adhering strictly to the formatting and standard conventions of the repository.
3. **Review Phase (Gate 2):** The developer or agent runs the local tests and linter suites. The **Quality Gate (Gate 2)** programmatically validates the workspace by verifying that local tests pass successfully and delegating a proactive code review to our sandboxed **Review Subagents**, which write the review signature (`review-approval.json`) upon success.
4. **Commit Phase (Gate 3):** Once all quality and testing requirements are satisfied, the developer or agent initiates the **Commit Gate (Gate 3)**. This triggers GPG/Touch ID biometrics via the enforcer hook to sign the commit (`user-approval.json`), stage files, commit cleanly, and push the active changes to GitHub to open a Pull Request.
