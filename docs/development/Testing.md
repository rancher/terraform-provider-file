# Testing, Static Analysis & Linting

This topic overview establishes our comprehensive testing, static analysis, and programmatic linting architecture, detailing how these verification layers operate together to ensure maximum codebase reliability.

---

## Abstract

Our testing strategy combines fast, deterministic static analysis (programmatic linters) with exhaustive unit and integration testing. By shifting mechanical formatting, syntax verification, and security scanning to local automated tools, we guarantee that no regressions reach production and significantly reduce the cognitive overhead on human reviewers and AI subagents alike.

---

## 🧭 How Our Verification Layers Work Together

To maintain 100% compliant code with zero manual formatting reviews, the repository employs three distinct, complementary verification layers:

### 1. Programmatic Linting & Static Analysis

We execute a unified linter suite locally and in CI/CD to mechanically enforce style, spelling, shell script safety, and Go idioms before code compiles.

- **Linters Configured**: `golangci-lint` (Go security and safety), `actionlint` (GHA syntax), `shellcheck`/`shfmt` (shell scripts), `prettier` (formatting), `markdownlint` (documentation structure), and `cspell` (spelling).
- **Unified Harness**: Orchestrated via `.github/workflows/scripts/lint.sh`.

### 2. Automated Unit Testing

Go unit tests and GHA script E2E tests are executed to verify the structural correctness of the provider clients and hooks.

- **Go Tests**: Executed via `make test` targeting `internal/provider/`.
- **Node.js Script Tests**: Executed via `node --test` targeting `.github/workflows/scripts/tests/`.

### 3. E2E Acceptance Testing (AWS Integration)

We run heavy end-to-end integration tests that deploy actual AWS infrastructure via Terraform, verifying the real-world correctness of our resources and clients.

- **Orchestration**: Executed via `make testacc` targeting AWS resource actions.

---

## 🧪 Test Suite & Execution Guidelines

### 1. Independent Module Architecture

To isolate testing dependencies and prevent pollute-drift in our main provider binary, our testing framework is structured as an independent Go module:

- The `./test` directory MUST stand as a standalone Go module named `test`.
- The `./test` module should maintain a separate package for each test suite to ensure clear boundaries and modular execution.
- Testing structures must be kept as DRY as possible. Where feasible, extract common resource and fixture creations into their own helper packages.
- Each test must establish its own localized Terraform plugin cache to guarantee hermetic execution, seeded directly from the global cache in `run_tests.sh`.

### 2. Makefile Actions & Nix Integration

Our `Makefile` acts as the root entrypoint for developer interaction, providing clean actions that abstract environmental setup:

- **Nix Dev Shell**: The Makefile must natively detect if Nix is installed, raise an error if absent, and handle entering the Nix dev environment (`nix develop`) before running downstream tools.
- **Targets Required**:
  - `make lint`: Automatically runs `.github/workflows/scripts/lint.sh` to check formatting, styling, and syntax.
  - `make test`: Runs unit tests via `run_tests.sh` with no options.
  - `make build`: Seeds the global plugin cache and validates provider examples.
  - `make cleanup ID=<id>`: Explicitly runs `cleanup.sh` for a specific execution ID.

### 3. The Test Runner (`run_tests.sh`)

Our test runner is a highly flexible, robust wrapper script that governs the entire execution lifecycle:

- **Execution Traps**: The script must implement a global `trap` to ensure that even if a run panics, is interrupted, or fails, the `cleanup.sh` script is unconditionally executed.
- **CommandLine Options**:
  - `--lint-only`: Runs the static validation suite without booting Go tests.
  - `--build-only`: Compiles the provider and seeds the Terraform cache.
  - `--cleanup-id <id>`: Cleans up AWS resources associated with a specific run.
  - `--slow-mode`: Sets the test runner execution speed to 1 (running tests sequentially to prevent AWS throttling).
- **Orphan Resource Cleanup**: If `cleanup.sh` is executed without an ID, it must look up and destroy any orphaned cloud resources tagged with `"Owner": "terraform-ci@suse.com"`.

---

## Architecture & Configuration

### 1. Programmatic Linting

**Objective**: Inject fast, deterministic linters via Nix to enforce layout, formatting, and syntax mechanically.

- **Nix Tooling**: All linting and formatting dependencies are loaded natively through `flake.nix`.
- **Prettier (`.prettierrc`)**: Enforces uniform trailing commas, quote marks, and tab-widths across JS, JSON, and MD files.
- **MarkdownLint (`.markdownlint.yaml`)**: Validates semantic structure while intentionally ignoring inline HTML or line-length limits required by agent prompt formatting.
- **GoLint (`.golangci.yml`)**: Enables `gosec` (security), `errcheck` (safety), `revive`/`stylecheck` (idioms), and `gocyclo` (complexity).

### 2. Go Unit & Integration Testing (Future Expansion)

_(Placeholder for future standardizations around `make test`, coverage thresholds, and parallelization)._

### 3. Acceptance & End-to-End Testing (Future Expansion)

_(Placeholder for future standardizations around Terraform Acceptance Testing `make testacc`)._

---

## Implementation Checklist

### Phase 1: Linting Environment Scaffold

- [x] Add `shfmt`, `prettier`, `markdownlint-cli`, `golangci-lint`, `actionlint`, and `tflint` to the `devShells` packages list in `flake.nix`.
- [x] Update `flake.lock` (if necessary) to resolve new dependencies natively.
- [x] Create `.prettierrc` (enforcing strict formatting for JS/JSON/MD).
- [x] Create `.markdownlint.yaml` (configured to ignore intentional line breaks or HTML inline elements).
- [x] Create `.golangci.yml` (enabling Go security, error checking, style, and complexity plugins).

### Phase 2: Pipeline Orchestration & Formatting

- [x] Refactor `.github/workflows/scripts/lint.sh` to introduce modular run functions for `run_shfmt`, `run_prettier`, `run_markdownlint`, `run_golangci_lint`, and `run_cspell`.
- [x] Execute an initial repository-wide auto-format sweep using `prettier --write` and `shfmt -w` to baseline the codebase cleanly without polluting future feature diffs.
- [x] Resolve any pre-existing code findings flagged by the new linters (specifically remaining markdownlint issues).

### Phase 3: Gating & Secure Push (Gate 2)

- [x] Present the unstaged diff for visual IDE review in the chat.
- [x] Obtain declarative user approval via `user-approval.js`.
- [x] Delegate a proactive review to `@review_agent` to secure the `review-approval.json` signature.
- [x] Execute `commit-push.sh` to autonomously commit and push the finalized configuration.
