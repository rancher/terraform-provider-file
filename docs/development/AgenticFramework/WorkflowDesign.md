# Agentic Framework: Workflow Optimization & Design

## Abstract

To maximize efficiency and eliminate friction in a human-agent collaborative environment, the Agentic Framework streamlines processes, eliminates mechanical checkpoints from human loops, and structures developer interactions around three authoritative checkpoints. Simultaneously, it prunes redundant styling instructions from agent profiles to reduce context overhead and processing costs.

---

## Technical Specification

### 1. The Three Authoritative Approval Gates

Rather than requiring constant, step-by-step developer permissions during development, the framework consolidates coordination around three highly structured, secure milestones:

```text
       [ Research & Implementation ]
                     │
                     ▼
 🔒 Gate 1: Planning Gate (Touch ID Signed)
                     │
                     ▼
       [ Autonomous Coding & Testing ]
                     │
                     ▼
 🔒 Gate 2: IDE & Commit Gate (Touch ID Signed)
                     │
                     ▼
 🔒 Gate 3: Draft PR Gating & Graduation
```

1. **Planning Gate (Gate 1)**:
   - **Trigger**: Opening/modifying a Component Specification file (e.g. `docs/development/MyTopic/MyComponent.md`) and requesting approval.
   - **Security**: Prompts macOS Touch ID to cryptographically verify developer agreement with the active strategy, writing a secure `plan-approval.json`.
   - **Authorization**: Once Gate 1 is signed, the agent is granted full autonomous authorization to modify files, run unit tests, and compile.
2. **IDE & Commit Gate (Gate 2)**:
   - **Trigger**: Resolving the task, verifying 100% green tests, and requesting GPG-signed commit.
   - **Security**: Displays the live unstaged git diff and requires conventional commit message approval, triggering Touch ID to verify the developer's physical sign-off and write `user-approval.json`.
   - **Automation**: Upon signing, the enforcer hook automatically stages files, signs/commits, pushes, and opens a Draft PR on GitHub.
3. **PR Sign-Off Gate (Gate 3)**:
   - **Trigger**: The developer reviews the Draft PR on GitHub and provides final ready-for-review approval in chat.
   - **Automation**: The agent graduates the PR to ready-for-review on GitHub and gracefully closes the development session.

---

## Asynchronous Review Iterations

To prevent clogging active workspace contexts with long-lived PR review wait states:

- Once a PR is opened, the active session is cleanly **closed**.
- If external maintainers or automated reviewers leave requested changes on GitHub, the developer starts a **brand new development session** running a dedicated `.gemini/workflows/resolve-pr-reviews.md` workflow.
- This keeps individual sessions extremely short-lived, fast, and completely free of state contamination.

---

## ✂️ Prompt Pruning & Tooling Synergies

Mechanical linter validation (such as scanning for trailing whitespace, checking bracket indentation, or verifying formatting) is highly repetitive and computationally expensive to delegate to LLM reasoning.

By implementing strict, deterministic, and hermetic formatting tools (Prettier, shfmt, gofmt) in our local environment:

- All formatting enforcements are offloaded to local compiler binaries.
- We **prune all mechanical style rules** from the instructions of our AI agents (e.g., `review_agent.md`).
- This dramatically reduces prompt sizes, minimizing context window footprint and cloud-processing API costs.
- The `review_agent` can focus 100% of its cognitive window on high-signal architectural logic, security vectors, and structural compliance.
