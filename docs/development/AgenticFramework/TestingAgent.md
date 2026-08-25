# Testing Agent Component Specification

This component specification details the persona, orchestration capabilities, and verification checklists governing our automated pre-commit Testing Subagent (`testing_agent`).

---

## Abstract

The Testing Subagent is a specialized AI agent tasked with executing our local static analysis, syntax linters, and unit testing suites in sequence. By verifying that our changes compile and pass all project validations, the agent ensures that no broken code or formatting regressions reach our VCS, programmatically writing the `test-approval.json` signature to unblock our downstream review gates.

---

## 🛠️ Architectural Design & Constraints

### 1. Model & Tooling Definition

To allow the execution of test suites and linters locally inside the Nix dev shell:

- The Testing Subagent's custom model definition is located at `.gemini/agents/testing_agent.md`.
- It is granted access to the `run_shell_command` tool to invoke compiler scripts, linters, and testing binaries, as well as `read_file` to review logs and files.

### 2. Mandatory Verification Suites

The Testing Subagent executes the following verification steps in sequence:

- **Project Linters**: Invokes `./.github/workflows/scripts/lint.sh` to run our 11 static analysis checks, formatting, secret scanning, and spelling validations.
- **Go Unit Tests**: Runs `make test` to compile and execute all Go-level unit test suites inside `internal/provider/`.
- **Script Unit Tests**: Executes `node --test .github/workflows/scripts/tests/**/*.test.js` to verify our JavaScript-based hooks, triggers, and release scripts.

### 3. Gating & Chaining Integration

The Testing Subagent operates as our **Testing Gate (Gate 2)** during our development process:

- It requires Gate 1 (Planning Gate) to be successfully signed and valid before execution is authorized by `.gemini/hooks/03-review-phase.js`.
- Upon successful execution with zero errors, the system's `03-review-phase.js --after-invoke` hook automatically intercepts, cryptographically signs, and writes `test-approval.json` to disk, chaining it to our active plan and diff hashes.
