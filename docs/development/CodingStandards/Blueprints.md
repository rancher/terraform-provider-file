# Architectural Blueprints & Planning

---

## Abstract

These guidelines prescribe the required layout, lifecycle rules, and planning procedures used to document repository features, workflows, and automated checks under the `docs/development/` directory.

---

---

## Nomenclature & Structure

### 1. Topic Overview (`docs/development/<Topic>.md`)

An overarching domain document that provides a high-level understanding of a major system area (e.g., `ReleaseProcess`, `TestingFramework`, `AgenticWorkflow`).

- **Abstract/Introduction**: Describes the general concepts of the topic and why it exists.
- **Architectural Design**: Contains design documents, sequence diagrams, or ASCII diagrams explaining how the system's components fit together.
- **Component Checklist**: A list of all sub-components that comprise this topic, linking to their respective Component Specifications.

### 2. Component Specification (`docs/development/<Topic>/<Component>.md`)

A technical design document and actionable specification for a single sub-component under a topic (e.g., `ReleaseProcess/Testing.md`, `AgenticWorkflow/SubAgentIsolation.md`).

- **Top Half: Technical Specification**:
  - **Abstract**: A clear, technical abstract section named `## Abstract` explaining the component's goals and architectural intent.
  - **Specification Details**: Detailed structural design rules, configuration requirements, sequence diagrams, and code snippets.
- **Bottom Half: Declarative System State**:
  - **System State & Components**: Outlines the target architecture, declarative structure, files, schemas, and verification states.
  - **No Imperative Checklists**: Blueprints MUST NOT contain step-by-step active task checklists or checkboxes. All imperative task steps and checklists live strictly inside the imperative **Plan** drafted in the session's temporary plans folder during Plan Mode.

---

## Planning Repository Changes

- **Rule:** Before starting any code modification, an imperative **Plan** is drafted in the session's temp plans directory and approved by the user via GPG/Touch ID sign-off.
- **Avoid Blueprint Sprawl:** If the implementation alters the system's declarative design, the corresponding declarative **blueprints** in `docs/development/` are updated to document the new target architecture state. New files are avoided if the changes fit within an existing domain overview; editing and adapting existing blueprints is the standard practice.
- **Order of Execution:** The blueprints under `docs/development/` are updated first during the Implement phase to reflect the new declarative state before modifying source code. No source changes are permitted without a valid `plan-approval.json` seal.
- **Lifecycle:** Blueprints are persistent specifications representing the codebase's current and target declarative state. Plans are transient, imperative execution steps that are discarded once the PR is complete.
