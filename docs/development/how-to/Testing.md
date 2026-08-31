# How to Run Linting, Formatting, and Code Quality Tests

This document is a sequential, goal-oriented How-To guide for verifying code quality, formatting files, running static analysis linters, and executing the test suites in this repository.

---

## Step 1: Validate Your Hermetic Environment

Ensure you are operating inside the secure, hermetic Nix development shell. This guarantees that all required linters, formatters, and test runners (such as `golangci-lint`, `shellcheck`, `cspell`, and `go`) are locked to their precise repository versions.

## Step 2: Format All Codebase Assets

Before running linter checks or submitting code, you must format all files to satisfy the repository's formatting quality gates:

```bash
# 1. Format Go files:
make fmt

# 2. Format Shell files using shfmt:
shfmt -w .gemini/skills/code-review/scripts/code-review.sh

# 3. Format JavaScript, JSON, and Markdown files using Prettier:
npx prettier --write .
```

## Step 3: Run Static Analysis & Linters

Execute static analysis linter checks to catch potential security vulnerabilities, syntactic bugs, and style issues:

```bash
# 1. Run golangci-lint (gosec, errcheck, staticcheck):
make lint

# 2. Run Shellcheck on all Bash scripts:
shellcheck .gemini/skills/code-review/scripts/code-review.sh

# 3. Run ESLint on JavaScript hooks and scripts:
npx eslint .

# 4. Run CSpell to perform spellchecking:
cspell docs/development/reference/Go.md
```

## Step 4: Execute the Go Unit Test Suite

Run local unit tests to verify the core provider logic and utility packages:

```bash
# Run all Go unit and helper tests with coverage:
make test
```

## Step 5: Execute Terraform Acceptance Tests

Acceptance tests spin up real resources using Terraform to verify end-to-end compatibility. Always run acceptance tests before proposing a release:

```bash
# Execute all acceptance tests (seeds the plugin cache and executes test/):
make testacc
```
