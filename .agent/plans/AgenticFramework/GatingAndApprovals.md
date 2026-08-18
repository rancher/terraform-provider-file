# Agentic Framework: Cryptographic Gating & Approvals

- **Executed Date:** 2026-08-14
- **Purpose:** Establishes rigorous cryptographic developer and review-agent approvals to authorize commits and branches natively, removing bypass prompts and validating change integrity.

---

## Technical Specification

The gating pipeline employs SHA-256 integrity verifications and secure user signatures to establish two clear approval gates.

### 1. Developer IDE Approval Gate (`user-approval.js`)

Provides visual reviews and records the developer's sign-off locally:

- **Calculation**: Computes SHA-256 checksum of active changes: `git diff HEAD`.
- **Validation**:
  - Rejects symbolic links to prevent bypasses.
  - Enforces current owner UID checks matching `$UID`.
  - Matches the approved hash against the active codebase state.
- **Output**: Generates a local secure file with restrictive permissions (`0600`) at `~/.gemini/tmp/terraform-provider-file/user-approval.json`.

### 2. Proactive Review Agent Gate (`write-approval.sh`)

Saves a secure cryptographic review manifest confirming zero Copilot or style violations:

- **Verification**: Generates a secure One-Time Pad (OTP) token via `.agent/skills/generate-otp.sh`.
- **Integration**: The review agent or generalist executes `write-approval.sh` to record the approval status under `~/.gemini/tmp/terraform-provider-file/review-approval.json`.

---

## Detailed Checklist History

### Phase 6: Cryptographic Review Gate & Modular Script Hardening (PR #396)

- [x] Implement regular file and owner UID checks for review files
- [x] Mandate SHA-256 hashing inside skills
- [x] Refactor `commit-push.sh` into modular single-responsibility functions
- [x] Incorporate Rancher-owned remote push safety enforcements

### Phase 11: Resolving PR #398 Review Comments & Hardening Guidelines

- [x] Enforce unconditional SSL setup before fast-paths in `nix-run.sh`
- [x] Refactor `write-approval.sh` to use `jq` securely (no raw heredocs)
- [x] Implement symlink guards `rm -f "$approval_file"` before writing approvals
- [x] Update `commit-push.sh` to use `--keep-index` (`-k`) on stash pushes
- [x] Update `tty-prompt.js` to dynamically support variable option prompts (`[y/N]` vs `[Y/n]`)
- [x] Align security block reason messages inside `block-rancher-git.js`

### Phase 12: Cryptographic Developer IDE Approval Gates (Prompt-Free Gating Cycle)

- [x] Build and implement `.agent/skills/user-approval.js`
- [x] Remove old procedural main prompt logic from `commit-push.sh`
- [x] Integrate `verify_developer_approval()` checking plan checkboxes dynamically
