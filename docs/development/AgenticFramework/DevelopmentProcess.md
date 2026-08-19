# Standard Development Process

---

## Abstract

This component outlines the repository's standard, step-by-step developer and agent development process. It is structured around Three Authoritative Approval Gates that enforce strict plan validation, testing compliance, and biometric Touch ID commits.

---

## 🔒 The Three Authoritative Approval Gates

To ensure high-signal coordination and eliminate redundant or disjointed prompts, this workflow is strictly consolidated around three mandatory **Approval Gates**. Outside of these gates, the agent is granted full autonomous authorization to execute.

### **Gate 1: Planning Gate (Initial Strategy Approval)**

- **Location**: Phase 2 (Blueprint & Planning) - Step 5.
- **Protocol**: The agent MUST NOT modify any source files or run any mutating development commands before presenting the Topic Overview or Component Specification (inside the `docs/development/` directory) in the chat and receiving explicit developer approval.
- **Autonomous Phase**: Once Gate 1 is approved, the agent operates with **full autonomous authorization** through Phase 3 (Surgical Implementation) and Phase 4 (Proactive Quality Gate). The agent does _not_ need to stop and ask for "interim" permissions to compile, run tests, lint, or invoke the review agent.

### **Gate 2: IDE & Commit Gate (Implementation Approval)**

- **Location**: Phase 5 (IDE Review & Secure Commit-Push) - Steps 13 & 14.
- **Protocol**: The agent presents the active unstaged git diff in the chat for the developer's visual IDE review and requests approval via `ask_user` containing the proposed conventional commit message (format: `Commit Message: "feat: <message>"`).
- **Execution**: Once approved, our secure `after-ask-user.js` hook automatically:
  1. Writes the cryptographic `user-approval.json` signature tied to the diff hash.
  2. Executes `.gemini/skills/commit-push.sh -m "<parsed_message>"` to securely commit and push.
  3. Programmatically generates a Draft Pull Request on GitHub using `.gemini/skills/create-pr.sh --draft`.
     This eliminates any chance for the agent to inject unvetted files between approval and commit.

### **Gate 3: Draft PR Review Gate (Ready-for-Review Approval)**

- **Location**: Phase 6 (Draft PR & Ready Conversion) - Steps 16 & 17.
- **Protocol**: The developer inspects the draft PR on GitHub. Upon receiving the developer's explicit approval in the chat, the agent converts the PR to "ready for review" (`gh pr ready <pr-number>`), presents the standard PR link, and cleanly **closes the development session**.
- **Asynchronous Review Cycle**: The developer waits asynchronously for team and AI reviews. If changes or comments are received on GitHub, the developer starts a **brand new, separate development session** executing the specialized `resolve-pr-reviews.md` workflow to resolve comments and merge.

---

## Core Mandates

1. **Zero Data Loss Guarantee:** Never run destructive git commands (such as `git reset --hard`, `git checkout .`, or `git clean -fd`) on modified workspace files unless explicitly requested by the developer, or after backing up work to a temporary branch/stash or the standard backup folder.
2. **IDE Review Priority:** The developer prefers to review code changes directly in their IDE while they are **unstaged** in the Git working directory to maintain color-coded diff visibility. Never execute a `git commit` without presenting the exact unstaged diff and receiving explicit approval in the chat.
3. **No Upstream Pushes:** Never push directly to upstream "rancher" remotes. All remote operations must target the user's fork.
4. **Strict Release-Please & SemVer Rules (Product-Centric):** All draft commit messages must strictly adhere to Release-Please rules from the end-user product's perspective:
   - **`feat`** (bumping SemVer Minor) and **`refactor`/`!`** (bumping SemVer Major) MUST ONLY be used if the change directly modifies the Terraform files defining the published module itself (`main.tf`, `variables.tf`, `versions.tf`, or `outputs.tf`).
   - **Internal Dev Changes:** Changes to helper scripts, CI/CD configuration, linters, internal hooks, or test suites DO NOT affect the published product. They MUST NOT use `feat`, `refactor`, or `!` types. Instead, use non-bumping conventional prefixes such as `build`, `ci`, `test`, `docs`, `fix`, or `chore`.
5. **Secure Local Backup & Isolation (~/.gemini/tmp):** To isolate staged commits for pristine IDE review with zero clutter, the agent MUST temporarily backup all non-layer modified and untracked files to the standard `~/.gemini/tmp/<repo-name>/backup_changes` directory.

---

## Step-by-Step Procedure

### Phase 1: Research & Reproduce

1. **Understand Goal & Hurdle:** Map the user's high-level goal and hurdle. If an existing workflow matches (e.g. CI failure matches `troubleshoot-workflows.md`), declare it explicitly.
2. **Codebase Exploration:** Search the codebase for existing patterns, conventions, and affected source/test files.
3. **Empirical Bug Reproduction:** For bug fixes, write a reproduction script or local test that demonstrates the failure, and run it to confirm the bug state.

### Phase 2: Planning, Strategy & Blueprint Synchronization (Gate 1)

1. **Acquire, Edit, or Create Architectural Specification:** Following `docs/development/rules/blueprints.instructions.md`, verify if an existing Topic Overview or Component Specification exists for the target domain.
   - **If an existing specification covers the domain:** You MUST NOT create a new file. Instead, _edit_ and _adapt_ the existing specification under `docs/development/`, modifying its top-half blueprint and expanding/re-opening the bottom-half implementation checklist.
   - **If no existing specification matches the domain:** Create a new Topic Overview (at `docs/development/<Topic>.md`) and a corresponding Component Specification (at `docs/development/<Topic>/<Component>.md`).
   - **Checklist Construction:** Build and expand the sequential implementation checklist in the Component Specification to detail the specific sub-tasks. (Note: You do NOT need to include standard quality gates like running tests or reviews as physical checkboxes; these are natively enforced by the security hooks).
2. **🔒 Solicit Plan Approval (Gate 1):** Present the updated blueprint and implementation checklist to the developer in the chat for explicit approval. **The agent is strictly prohibited from modifying any source files or running mutating development commands until Gate 1 approval is received.**

### Phase 3: Surgical Implementation (Autonomous Action)

1. **Execute Plan & Track State (No Stage/Commit):** Implement the plan sequentially, updating checkboxes in the plan file in place. Keep edits simple, precise, and idiomatic. Do NOT stage (`git add`) or commit (`git commit`).
2. **Build & Test Verification:** Compile, build, and run tests locally.
   - **Full Test Suite Context Warning:** The full test suite can take over an hour and generate massive logs. Redirect output (e.g., `./run_tests.sh [options] > /tmp/run_tests.log 2>&1`) and run `.gemini/skills/parse-test-logs.sh` to prevent context window flooding.
   - **Fast Verification Option:** Validate changes quickly on a single fixture:

     ```bash
     ./run_tests.sh -f sle-micro-61-canal-stable-one-rpm-ipv4
     ```

3. **Static Analysis & Linters:** Run ecosystem linters (e.g., `golangci-lint`, `shellcheck`, `tflint --recursive`, `actionlint`) and resolve all warnings.

### Phase 4: Proactive Quality Gate (Autonomous Action)

1. **Proactive Code Review:** Delegate a proactive code review of your active local git diff directly to the custom review subagent by running `@review_agent` in the chat. The agent will rigorously verify your modifications against `docs/development/rules/github-copilot-review.instructions.md` and all repository standards, generating a pre-commit review report and the secure cryptographic SHA-256 approval signature.
2. **Resolve Findings:** Refactor and fix any concerns discovered by the review agent, ensuring exactly 0 automated Copilot or linter findings.

### Phase 5: Chunking & IDE Review (Gate 2)

1. **Logical Partitioning:** If there is a large volume of changes, group files into focused, independent **subsystem boundaries** (layers).
2. **Upstream Synchronization:** Before checkout, switch to `main` and execute `.gemini/skills/git-sync.sh` to ensure our branch off point is completely up-to-date with upstream.
3. **Isolate First Layer (Keep Unstaged):** Create a dedicated branch directly off the updated `main`. To keep the workspace clean, backup all other non-layer files to the standard `~/.gemini/tmp/<repo-name>/backup_changes` directory. Clean other files from the working directory, leaving **exclusively** the target layer's changes unstaged.
4. **🔒 Solicit IDE & Commit Approval (Gate 2):** Present the unstaged diff to the developer in the chat for visual IDE review. Formulate a conventional commit message and ask for approval via `ask_user` in the exact format: `Commit Message: "feat: <message>"`.
5. **🔒 Automated Secure Commit & Push**: Upon the developer's approval in `ask_user`, our secure `after-ask-user.js` hook automatically intercepts, writes the `user-approval.json` signature, stages the changes, and runs the secure skill `.gemini/skills/commit-push.sh -m "<message>"`. **Direct manual git commit and push commands are strictly prohibited.**

### Phase 6: Draft PR & Ready Conversion (Gate 3)

1. **🔒 Automated Draft PR Generation (Gate 3):** Immediately after successful push, the hook automatically runs `.gemini/skills/create-pr.sh --draft` to generate a Draft PR on GitHub.
2. **Inspect Draft PR:** Wait for the developer to inspect the draft PR link programmatically returned in the hook logs on GitHub.
3. **Convert PR to Ready & Conclude Session:** Once the developer explicitly instructs you to finalize the PR in chat, convert the PR from Draft to "Ready for Review" using the GitHub CLI: `gh pr ready <pr-number>`. Provide a completion summary, present the final PR link, and cleanly **close the current development session**.

### Phase 7: Asynchronous PR Iteration & Next Layer Restoration

1. **Asynchronous Review Wait-State:** The developer waits asynchronously for team and AI reviews. If comments or requested changes are submitted on GitHub, the developer starts a **brand new development session** running the dedicated `.gemini/workflows/resolve-pr-reviews.md` workflow to resolve comments.
2. **Proceed to Next Layer:** Switch back to the synchronized `main`, restore the remaining files from the backup directory `~/.gemini/tmp/<repo-name>/backup_changes` back into the active workspace, and return to Step 11 for the next layer.
3. **Completion Summary:** Once all layers are successfully complete and merged, provide a concise summary with links to all Pull Requests.
