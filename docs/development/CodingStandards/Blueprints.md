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
- **Bottom Half: Implementation Checklist**:
  - **Implementation Checklist**: A section named `## Implementation Checklist` containing a sequential, step-by-step checklist of specific tasks.
  - **Dynamic Expansion**: The checklist is a living document. It must be dynamically expanded to add new sub-tasks, verification steps, or specific bug fixes discovered during development.
  - **Sequential Work Protocol**: Work strictly in turn. You are not allowed to skip steps or run steps in parallel if they depend on one another. Update checkboxes in place (`- [ ]` -> `- [x]`) **once completed and before starting the next step**.
  - _(Note: Standard quality gates like local tests, linting, and reviews are natively enforced by our git-push and user-approval hooks. You do NOT need to include them as manual checkbox items in the checklist)._

---

## Planning Repository Changes

- **Rule:** Before starting any code modification, a plan must be drafted and approved by the user.
- **Avoid Blueprint Sprawl:** You MUST NOT create a brand new Topic Overview or Component Specification if the task fits under an existing architectural domain. Instead, _edit_ and _adapt_ the existing files, expanding their specifications and checklists.
- **Order of Execution:** The very first task after plan approval is updating the Topic Overview and Component Specification. No source code changes can occur until these documents are updated on disk.
- **Lifecycle:** Not every Pull Request requires a new specification file. Adapting and expanding existing specifications is the preferred, high-standard mode of development.
