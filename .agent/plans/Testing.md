# Testing, Static Analysis & Linting Blueprint

- **Executed Date:** Pending
- **Purpose:** Establish a comprehensive, deterministic, and hermetic pipeline for testing and code-quality enforcement. By shifting mechanical formatting, syntax, and known anti-patterns to fast programmatic linters, we ensure zero regressions and continuously reduce the cognitive load on our AI Review Agents.

---

## Architecture & Configuration

### 1. Programmatic Linting (Current Focus)

**Objective**: Inject fast, deterministic linters via Nix to enforce layout, formatting, and syntax mechanically.

- **Nix Tooling**: Add `shfmt`, `prettier`, `markdownlint-cli`, `golangci-lint`, `actionlint`, and `tflint` to `flake.nix`.
- **Prettier (`.prettierrc`)**: Enforce uniform trailing commas, quote marks, and tab-widths across JS, JSON, and MD files.
- **MarkdownLint (`.markdownlint.yaml`)**: Validate semantic structure while intentionally ignoring inline HTML or line-length limits required by agent prompt formatting.
- **GoLint (`.golangci.yml`)**: Enable `gosec` (security), `errcheck` (safety), `revive`/`stylecheck` (idioms), and `gocyclo` (complexity).
- **Orchestration (`lint.sh`)**: Centralize the execution of all linters into a unified `.github/workflows/scripts/lint.sh` harness.

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

- [ ] Present the unstaged diff for visual IDE review in the chat.
- [ ] Obtain declarative user approval via `user-approval.js`.
- [ ] Delegate a proactive review to `@review_agent` to secure the `review-approval.json` signature.
- [ ] Execute `commit-push.sh` to autonomously commit and push the finalized configuration.
