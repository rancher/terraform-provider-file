# Plan: PR 403 Review Resolution & Hardening

**Objective:**
Resolve merge conflicts between `feature/secure-agent-pipeline` and `main`, and rigorously address the comprehensive set of review comments provided by Copilot for PR 403 to achieve a pristine, zero-trust codebase.

## Key Files & Context

- `.agent/skills/commit-push.sh`
- `.boilerplate-sync.json`
- `.github/workflows/review-trigger.yml`
- `.github/workflows/scripts/tests/verify-pr-requirements.test.js`
- `.markdownlint.yaml`
- `update-action-versions.sh` & `update-modules.sh`
- `flake.nix`
- `RELEASING.md`
- `.agent/hooks/after-invoke-agent.js`
- `.agent/skills/git-sync.sh`
- `.gemini/settings.json`

## Implementation Steps

### 1. Merge Conflicts Resolution

- [x] Resolve conflicts in `.agent/skills/commit-push.sh`, `.boilerplate-sync.json`, `.github/workflows/review-trigger.yml`, `.github/workflows/scripts/tests/verify-pr-requirements.test.js`, and `.markdownlint.yaml`, prioritizing `main` branch optimizations while keeping PR 403 hooks.

### 2. Workflow Security & CI Fixes

- [x] **`pull_request.yaml`**: Pass `BASE_REF` safely via environment variables and validate it before shell interpolation.
- [x] **`review-trigger.yml`**: Strictly check `author_association` for `/merge` comments and ensure "Copilot pass" comments are authored by genuine bots. Convert the workflow failure condition to use a job-level `if` statement to skip gracefully instead of failing.
- [x] **`flake.nix`**: Gate the `age-plugin-se` package behind `pkgs.stdenv.isDarwin` to unbreak Linux CI.
- [ ] **Spelling**: Add `sandbox`, `sandboxed`, and `sandboxing` to `custom_words.txt` to fix the CI spelling checker.

### 3. Scripts & Hooks Hardening

- [x] **`update-modules.sh`**: Avoid unconditionally prefixing module versions with `v` if the registry version does not require it. Optimize the `grep` search to explicitly exclude `.terraform` and `.git` directories. Correct CLI help text.
- [x] **`update-action-versions.sh`**: Correct CLI help text to point to `.github/workflows/scripts/`.
- [ ] **`commit-push.sh`**: Restore proactive review validation check natively against `review-approval.json` to close the security gate, and harden its ownership checks, jq presence check, and SHA-256 helper reuse.
- [x] **`hooks.test.js`**: Refactor tests to use dynamically generated unique temp directories instead of hardcoded paths.
- [x] **`.gemini/settings.json`**: Ensure `.agent/hooks/block-secrets.js` is invoked for `write_file` and `replace` hooks.
- [x] **`block-secrets.js`**: Remove the unused `path` import.

### 4. Documentation

- [x] Update `RELEASING.md` diagrams to correctly reference `issue_comment` triggers instead of the obsolete `pull_request_review`.

## Verification & Testing

- [ ] Run full project linters (`lint.sh all`) to ensure 0 formatting or stylistic errors.
- [ ] Run native unit tests (`test.sh scripts`) to ensure logic functions flawlessly.
- [ ] Record developer approval, generate the proactive review signature, and commit the resolutions cleanly via `commit-push.sh`.
