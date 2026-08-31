# Coding Standards & Guidelines (Reference Index)

This document is the main reference index of the repository's mandatory coding standards, security baselines, and quality criteria.

All standards are structured around **Logical Architectural Domains** (e.g. Syntax/Linter, Logic/State, Concurrency/Safety, and Architecture/Testing), decoupled entirely from the review agent's execution passes to support scalable and resilient future expansions.

---

## 1. Core Development Languages (Reference Quadrant)

- **Go Standards:** Dry, searchable reference index of Go syntax, context propagation, error wrapping, concurrency, and standalone test module configurations. More details can be found in **[Go Standards](./Go.md)**.
- **Terraform Standards:** Dry, searchable reference index of Terraform snake_case naming style, variable validations, check blocks, sensitive redaction, and module layouts. More details can be found in **[Terraform Standards](./Terraform.md)**.

## 2. CI/CD & Automation Ecosystems (Reference Quadrant)

- **GitHub Actions Workflows:** Dry, searchable reference index of GHA workflow default permissions {}, OIDC token federation, SHA-pinned actions, allowed namespaces, and script isolation. More details can be found in **[GitHub Actions Workflows](./Workflows.md)**.
- **JavaScript & Node.js Rules:** Dry, searchable reference index of JavaScript empty catch block bans, GHA module exports, fail-safe JSON parsers, and execFileSync shell-injection safeguards. More details can be found in **[JavaScript Standards](./JavaScript.md)**.
- **Shell Script Rules:** Dry, searchable reference index of Bash fail-fast parameters, double brackets, modular shebangs, command substitutions, local variable scoping, and Makefile structures. More details can be found in **[Shell Scripts](./ShellScripts.md)**.

## 3. Documentation & Architectural Blueprints (Reference Quadrant)

- **Documentation & Blueprints:** Dry, searchable reference index of Markdown linter compliance, spellcheckingExceptions (`cspell`), Diátaxis layout quadrants, declarative blueprints, and strict 3-Gate/4-Phase framework guidelines. More details can be found in **[Documentation Standards](./Documentation.md)**.
- **CHANGELOG:** Archive of historical project release records and semantic version updates. More details can be found in **[Changelog](./CHANGELOG.md)**.
