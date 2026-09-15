# Agentic Framework: Workflow Optimization & Design

> **Blueprint Compliance:** This integration MUST adhere strictly to the **Strict 4-Phase Lifecycle** (Plan, Implement, Review, Commit) and the **Strict 3-Gate Architecture** (Planning Gate (Gate 1), Programmatic Review/Testing Gate (Gate 2), and Commit Gate (Gate 3)). Of these 3 gates, the Planning Gate and Commit Gate are user-facing. No phase or gate may be bypassed.

## Abstract

To maximize efficiency and eliminate friction in a human-agent collaborative environment, the Agentic Framework streamlines processes, eliminates mechanical checkpoints from human loops, and structures developer interactions around three authoritative checkpoints. Simultaneously, it prunes redundant styling instructions from agent profiles to reduce context overhead and processing costs.

---

## Technical Specification

### 1. The Gated 4-Phase Lifecycle & Three Gates

To optimize collaboration and ensure zero unvetted changes, the framework coordinates work across 4 distinct phases (`Plan`, `Implement`, `Review`, `Commit`) and enforces three strict, sequential gates:

```text
       [ Plan Phase ]
             │
             ▼
 🔒 Gate 1: Planning Gate (User-Facing / GPG Touch ID)
             │
             ▼
       [ Implement Phase (Autonomous) ]
             │
             ▼
       [ Review Phase ]
             │
             ▼
 🔒 Gate 2: Programmatic Review/Testing Gate (Programmatic / Test & Subagent)
             │
             ▼
       [ Commit Phase ]
             │
             ▼
 🔒 Gate 3: Commit Gate (User-Facing / GPG Touch ID)
```

1. **Planning Gate (Gate 1 - User-Facing)**:
   - **Phase Transition**: Plan $\rightarrow$ Implement.
   - **Security**: Prompts macOS Touch ID to GPG-sign the active strategy checklist on disk, writing `plan-approval.json`.
   - **Authorization**: Unlocks autonomous file modification, compilation, and testing capabilities.
2. **Programmatic Review/Testing Gate (Gate 2 - Programmatic)**:
   - **Phase Transition**: Implement $\rightarrow$ Review.
   - **Security**: Natively verifies that local unit/integration tests pass successfully and delegates an automated code review to our sandboxed `@project_manager` to secure the review signature (`review-approval.json`).
3. **Commit Gate (Gate 3 - User-Facing)**:
   - **Phase Transition**: Review $\rightarrow$ Commit.
   - **Security**: Displays the live unstaged Git diff in chat, requesting Conventional Commit message approval. It triggers macOS Touch ID to verify the developer's physical sign-off and write `user-approval.json`.
   - **Automation**: Upon biometric verification, the hook automatically stages files, commits with the signature, pushes, and programmatically opens a Draft PR on GitHub.

---

## Asynchronous Review Iterations

To prevent clogging active workspace contexts with long-lived PR review wait states:

- Once a PR is opened, the active session is cleanly **closed**.
- If external maintainers or automated reviewers leave requested changes on GitHub, the developer starts a **brand new development session** running a dedicated `.gemini/workflows/resolve-pr-reviews.md` workflow.
- In accordance with our PR iteration standards, comments are resolved by updating the review agent's rules first, reproducing findings, implementing fixes, re-verifying Gate 2, and committing via Gate 3.
- This keeps individual sessions extremely short-lived, fast, and completely free of state contamination.

---

## ✂️ Prompt Pruning & Tooling Synergies

Mechanical linter validation (such as scanning for trailing whitespace, checking bracket indentation, or verifying formatting) is highly repetitive and computationally expensive to delegate to LLM reasoning.

By implementing strict, deterministic, and hermetic formatting tools (Prettier, shfmt, gofmt) in our local environment:

- All formatting enforcements are offloaded to local compiler binaries.
- We **prune all mechanical style rules** from the instructions of our AI agents (e.g., `project_manager.md`).
- This dramatically reduces prompt sizes, minimizing context window footprint and cloud-processing API costs.
- The `@project_manager` and its subagents can focus 100% of their cognitive window on high-signal architectural logic, security vectors, and structural compliance.

---

## 🔒 Self-Containment Prompt Strategy for Sandboxed Subagents

When executing subagents in highly secure, isolated, and empty sandbox environments (such as those managed by `mkdtemp` in `code-review.js` or `quality-assurance.js`), the parent process actively intercepts any external filesystem tool calls (e.g. `list_directory`, `read_file`) to protect system integrity.

However, lower-reasoning models (such as `gemini-3.5-flash` running in failover modes) can become confused by an empty working directory and attempt to explore up-tree, resulting in benign but distracting security blocks.

To prevent this, custom subagent profiles designed to run in empty directories must implement a **Self-Containment Mandate**:

1. **Explicit No-Tool Rules:** System instructions must carry a loud, high-priority section instructing the model that it must **never** call any directory-listing, file-reading, or search tools.
2. **XML Payload Reliance:** System instructions must command the model to rely exclusively on the structured XML data structures (such as `<git_diff>` and `<active_plan>`) provided directly within the prompt payload, rather than attempting filesystem exploration.
3. **Graceful Failures:** This guarantees that even when model capacity failovers occur, the subagent session remains compact, silent, highly focused, and free of false-positive sandbox blocks.

---

## 🔒 Post-Review Worktree Gating & Performance Optimization

To protect the cryptographic integrity of Gate 2 (Review) and Gate 3 (Commit) from post-review tampering or silent, unvetted edits, the framework enforces a strict **zero-unstaged-changes policy** during hash calculation:

### 1. Worktree Gating (Unstaged & Untracked Prevention)

If a developer runs `quality-assurance.js` to sign Gate 2, all modifications are staged in the index and hashed. If they subsequently edit a tracked file in their worktree or add an untracked file, but do not stage it:

- The pre-commit hook runs `calculateDiffHash`.
- Rather than silently ignoring the unstaged modifications (which would allow unreviewed code to sit in the worktree during the commit), the function explicitly executes `git diff` and `git ls-files --others` to verify if the worktree is 100% clean.
- If any unstaged tracked changes or untracked files are detected, the gate throws a `Security Gating Failure` error and halts the commit.
- This forces the developer to explicitly stage the changes, altering the staged diff hash and invalidating the prior Gate 2 approval, requiring a fresh and fully transparent QA review cycle.

### 2. Deferred Default Branch Resolution (Offline Resilience)

To maximize local developer performance and guarantee 100% offline resilience:

- In incremental review modes (`forceFull = false`), the Git helpers compare the index strictly against `HEAD`, which does not require resolving the repository's default branch.
- The framework defers calling `getRepoDefaultBranch` (which might fall back to slow network queries like `git remote show origin`) until inside the explicit `forceFull` block.
- This ensures everyday local development workflows remain ultra-responsive, completely offline-compatible, and free of remote-lookup latencies.
