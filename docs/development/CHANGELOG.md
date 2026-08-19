# Developer Documentation Changelog

This changelog tracks all updates, refactors, and structural changes made to the developer architecture blueprints and repository specifications under the `docs/development/` directory.

---

## [Unreleased] - 2026-08-19

### Refactored

- **Consolidated Topics & Directories**: Grouped all process guidelines, workflows, and formatting rules under a unified directory structure to maximize cohesive discoverability and comply strictly with standard paradigms.
- **Relocated Workflows**: Moved all repository-specific automation workflows from `.gemini/workflows/` to `docs/development/AgenticFramework/`:
  - `development-process.md` -> `AgenticFramework/DevelopmentProcess.md`
  - `resolve-pr-reviews.md` -> `AgenticFramework/ResolvePRReviews.md`
  - `troubleshoot-workflows.md` -> `AgenticFramework/TroubleshootWorkflows.md`
- **Relocated Formatting Styles**: Moved formatting style guidelines from `.gemini/output-styles/` to `docs/development/AgenticFramework/`:
  - `strict.md` -> `AgenticFramework/OutputStyleStrict.md`
  - `conversational.md` -> `AgenticFramework/OutputStyleConversational.md`
- **Established Coding Standards Topic**: Created a new top-level **Coding Standards** topic overview (`CodingStandards.md`) and relocated all standards and language instructions from `.gemini/rules/` to `docs/development/CodingStandards/`:
  - `go.instructions.md` -> `CodingStandards/Go.md`
  - `terraform.instructions.md` -> `CodingStandards/Terraform.md`
  - `workflows.instructions.md` -> `CodingStandards/Workflows.md`
  - `github-script.instructions.md` -> `CodingStandards/GitHubScript.md`
  - `shell-scripts.instructions.md` -> `CodingStandards/ShellScripts.md`
  - `github-copilot-review.instructions.md` -> `CodingStandards/GitHubCopilotReview.md`
  - `documentation.instructions.md` -> `CodingStandards/Documentation.md`
  - `blueprints.instructions.md` -> `CodingStandards/Blueprints.md`
  - `standards.md` -> Eliminated by absorbing global linting/spelling/formatting rules into `CodingStandards.md` and standard testing targets into `Testing.md`.
- **Pruned Unused Folders**: Completely deleted `.gemini/workflows/`, `.gemini/output-styles/`, and `.gemini/rules/` from the automation suite, restoring `.gemini/` as a generic portable template.
- **Retired `PLAN_LOG.md`**: Removed the redundant historical plan logs.

### Added

- **Official Gemini layout reference**: Created `.gemini/README.md` defining Google's standard user-level vs project-level folder structure.
- **Changelog**: Added this `CHANGELOG.md` file specifically tracking developer documentation.
