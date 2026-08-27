# 💬 Ask User Component

The `ask_user` tool is the primary mechanism for the autonomous agent to collaborate with, ask clarification questions of, or obtain cryptographically signed approvals from the human developer. 

To prevent parsing ambiguity, maintain structured history, and guarantee robust automation validation, **all `ask_user` tool calls must be formatted as structured TOML payloads.**

---

## 📋 Schema Requirements

Every `ask_user` request must format its question string as a valid, well-formed TOML document. The schema supports generic queries as well as specialized, gated approval workflows.

### 1. General Fields (Required for All Requests)

- `intent` (string): The clear, high-level purpose of the request.
  - For standard queries, use values like `"question"`, `"clarification"`, `"feedback"`, etc.
  - For planning gate approval, this must be exactly `"plan approval"`.
  - For commit gate approval, this must be exactly `"commit approval"`.
- `request` (string): The actual question, description, or prompt being presented to the human developer.

### 2. Plan Approval Specific Fields (Required when `intent = "plan approval"`)

- `plan` (string, multi-line markdown): The complete implementation and testing checklist plan drafted under `plans/`. This must be a well-formed markdown string.

### 3. Commit Approval Specific Fields (Required when `intent = "commit approval"`)

- `hash` (string): The git diff SHA/hash produced during the review phase (using `calculateDiffHash()`) that the developer is approving.
- `commit-message` (string): The exact, conventional commit message to use for the automated git commit.
- `pr-description` (string, markdown): The detailed description of the pull request to use when programmatically opening the PR.

---

## 💡 Templates & Examples

The following templates represent the correct formatting required for each use-case. When using the `ask_user` tool, copy and populate the appropriate block exactly.

### Example A: Standard/Clarification Question
```toml
intent = "clarification"
request = "I see multiple testing folders under `test/`. Should I place our new integration tests under `test/local/basic/` or create a new directory?"
```

### Example B: Planning Gate Approval
```toml
intent = "plan approval"
request = "I have drafted the plan for implementing the TOML validation feature. Do you cryptographically approve this plan so that I can exit Plan Mode and begin writing the code?"
plan = """
# Enforce TOML Format for ask_user Tool

## Objective
Update the Agentic Framework to formalize all `ask_user` tool inputs into a structured TOML format...

## Implementation Steps
- [ ] Install `@iarna/toml`
- [ ] Create `.gemini/hooks/ask-user-toml-validator.js`
- [ ] Configure `settings.json`
"""
```

### Example C: Commit Gate Approval
```toml
intent = "commit approval"
request = "My automated testing and review checks have completed successfully, and I have generated a candidate commit message. Do you approve these changes for commit?"
hash = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"
commit-message = "feat: implement structured TOML ask_user hooks"
pr-description = """
This PR introduces structured TOML validation for all `ask_user` tool calls.

### Changes
- Created `ask-user-toml-validator.js` enforcer hook.
- Integrated validation in `settings.json`.
- Modified plan and commit phase hooks to parse TOML.
"""
```

---

## 🔒 Violation & Enforcement

Any `ask_user` tool call that is not well-formed TOML, or is missing required fields (such as `intent` or `request`), will be rejected with a `deny` decision by our pre-tool enforcer hooks. 

If your tool call is blocked:
1. Review the validation error returned by the hook.
2. Ensure you have formatted your prompt inside `questions[0].question` or `question` exactly as a TOML document.
3. Use triple-quotes (`"""`) for multiline strings (such as plans).
4. Verify all mandatory keys are provided for your specific `intent`.
