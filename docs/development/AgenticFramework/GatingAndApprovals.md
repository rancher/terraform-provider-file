# Agentic Framework: Cryptographic Gating & Approvals

## Abstract

To maintain absolute system integrity and prevent unauthorized code modifications in an autonomous programming workspace, the Agentic Framework implements a secure, **cryptographically chained gating pipeline**. This system mathematically guarantees that no code can be committed or pushed without satisfying sequential, hardware-authorized quality checkpoints: Planning (Gate 1) and Proactive Review (Gate 2).

---

## 🔒 Architectural Rationale: Why We Cryptographically Chain Gates

Traditional CI/CD pipelines and pre-commit checks are highly vulnerable to **TOCTOU (Time-of-Check to Time-of-Use)** attacks and race conditions. An autonomous AI agent could theoretically modify files _after_ passing local tests and reviews, but _before_ executing the final commit, thereby injecting unvetted code into the repository.

To eliminate this vulnerability, our framework enforces a **Strict Cryptographic Chaining Rule**:

1. **The Hash Anchor**: Every stage of the development process is anchored to a unique, live SHA-256 hash of the entire active workspace difference (`git diff HEAD`), termed the `diff_hash`.
2. **Immutable Binding**: When a gating step succeeds, its signature (`plan-approval.json` or `review-approval.json`) is cryptographically bound to that exact `diff_hash` and the active `plan_hash`.
3. **Chained Verification**: Subsequent gates—and ultimately the custom `agent-scripts/commit-push-helper.sh` utility—will unconditionally reject operations if any of the following occur:
   - The files on disk change (which changes the current `diff_hash` and causes an immediate mismatch with the signatures).
   - Any signature is missing or altered.
   - The signatures are generated out of order (e.g., trying to write a Review approval before a Test approval is signed).
4. **Self-Healing Revocation**: If any check fails or if the agent modifies any source file, the enforcer hooks automatically unlink (delete) the downstream signatures, immediately revoking approvals and halting the pipeline.

---

## 🧬 Hardware-Backed 2FA Gating & Threat Model

In a secure, semi-autonomous engineering environment, the ultimate threat is **Agent Autonomy Escalation**: an AI agent fabricating or signing off on its own changes without real developer oversight.

To prevent this, the framework binds the **Planning Gate (Gate 1)** and the final **Commit Gate (Gate 4)** to a cryptographic key. We highly recommend that the user have some form of 2-factor access to their key—whether that is a TOTP, a hardware security key (like a YubiKey), or biometric authorization (like Mac Touch ID). This requires a physical confirmation from the developer to cryptographically sign approvals, ensuring the developer remains the absolute authority over the codebase.

### Cryptographic Decryption Flow

```text
[Gemini CLI]                         [System OS (Enforcer Hook)]                  [Apple Secure Enclave]
     |                                           |                                           |
     | -- 1. Trigger exit_plan_mode --------->   |                                           |
     |                                           | -- 2. Encrypt Token with Public Key --->  |
     |                                           |       (Writes challenge envelope)         |
     |                                           |                                           |
     | <--- 3. Prompt: "Approve?" -------------- |                                           |
     |                                           |                                           |
     | -- 4. Click: [Approve Plan] ------------> |                                           |
     |                                           | -- 5. Execute age decryption ---------->  |
     |                                           |                                           | [2FA / Hardware Prompt]
     |                                           |                                           | <--- Physical Tap / Token Entry
     |                                           | <--- 6. Decrypted Token ----------------- |
     |                                           |                                           |
     | <--- 7. Write plan-approval.json -------- |                                           |
```

1. **Challenge Generation**: The enforcer hook (`04-commit-phase.js --after-ask`) intercepts the approved `ask_user` tool execution. It generates a secure, randomized challenge token and encrypts it using the developer's public GPG/age key (`~/.gemini/age-key.pub`).
2. **Hardware Authorization**: The hook invokes `age` to decrypt the challenge envelope using the private key handle (`~/.gemini/age-key.txt`).
3. **Secure Enclave Interception**: Because the private key handle is securely enrolled in the macOS Keychain and tied to the Secure Enclave, macOS intercepts the request and natively triggers a Touch ID biometric prompt.
4. **Biometric Validation**: If the developer touches the sensor, the Secure Enclave decrypts the token, confirming human presence. The hook then saves the valid `plan-approval.json` or `user-approval.json` signature to disk, unblocking the pipeline.

---

## 🛠️ Step-by-Step age and Touch ID Key Setup Guide

The framework uses the `age` modern encryption utility and `age-plugin-se` (Apple Secure Enclave plugin) to coordinate biometric signatures. Both packages are **natively provided** by our hermetic Nix development shell (`flake.nix`).

### 1. Generate a Standard age Key (Fallback / Linux)

To generate a standard, file-based age key pair (primarily used in non-Darwin environments or as a backup):

```bash
# Generate the key pair and save to the standardized path
age-keygen -o ~/.gemini/age-key.txt

# Extract the public key and save it to the pub file
age-keygen -y ~/.gemini/age-key.txt > ~/.gemini/age-key.pub
```

### 2. Generate an Apple Secure Enclave (Touch ID) age Key (macOS / Darwin)

To generate a hardware-bound private key handle securely stored in your macOS Keychain and tied to Touch ID:

```bash
# Generate a Secure Enclave GPG-compatible age key pair
age-plugin-se -g -o ~/.gemini/age-key.txt

# The public key is printed directly to stdout during generation.
# Copy that public key string (starting with "age1...") and write it to:
echo "age1<your_public_key_string_here>" > ~/.gemini/age-key.pub
```

_Note: This creates a secure private key reference in `age-key.txt` that only the Apple Secure Enclave can decrypt. The actual private key never leaves your physical hardware._

### 3. Generate an Apple Secure Enclave (Touch ID) SSH Key (macOS / Darwin)

Alternatively, you can create a native macOS Touch ID-backed SSH key using the Apple Secure Enclave (`ssh-keychain.dylib`), which can also be utilized for `age` cryptographic gating via SSH integration.

1. **Create the biometric identity in the Secure Enclave:**
   ```bash
   sc_auth create-ctk-identity -l ssh -k p-256-ne -t bio
   ```
2. **Generate the SSH key handle:**
   ```bash
   ssh-keygen -w /usr/lib/ssh-keychain.dylib -K -N ""
   ```
3. **Export the Security Key Provider to your environment:**
   ```bash
   export SSH_SK_PROVIDER=/usr/lib/ssh-keychain.dylib
   echo 'export SSH_SK_PROVIDER=/usr/lib/ssh-keychain.dylib' >> ~/.zprofile
   ```
4. **Add the key to your SSH agent:**
   ```bash
   ssh-add -K -S /usr/lib/ssh-keychain.dylib
   ```
5. **Update your SSH Configuration:**
   Edit your `~/.ssh_config` (or `~/.ssh/config`) to ensure the correct provider is used:
   ```text
   Host *
     IdentityAgent none
     SecurityKeyProvider /usr/lib/ssh-keychain.dylib
   ```
6. **Forward the agent:** Ensure your local VM (e.g., Colima) is configured to forward your SSH agent to your containers.

---

## 🤖 Programmatic Subagent Isolation & AfterTool Hook Integration

While Gates 1 and 3 require human Touch ID biometrics, **Gate 2 (Proactive Review)** is programmatically audited and signed by invoking a specialized local subagent (`review_agent`). Automated tests are enforced programmatically in the pre-review hooks, eliminating the need for a standalone testing subagent.

To guarantee absolute objectivity, the subagent is **fully isolated and sandboxed**:

1. **Read-Only Enforcements**: The `review_agent` is stripped of write capabilities, restricting its toolset strictly to `[read_file]`. It cannot modify code or write approvals.
2. **AfterTool Hook Verification**:
   - When the main agent calls `invoke_agent` targeting `review_agent`, the native `AfterTool` hook (`03-review-phase.js --after-invoke`) intercepts the subagent's execution report.
   - It parses the report looking for the standardized success blocks:
     - `review_agent` -> `PR Review status: 🟢 PERFECT - 0 findings. Code is fully secure, standard-compliant, and optimized.`
   - If the success string is found, the hook **natively and securely** writes `review-approval.json` to disk, signing it with the active `diff_hash` and `plan_hash`.
   - If any violation or failure is reported, the hook instantly unlinks (deletes) the signatures, revoking any previous approvals.

This architecture prevents the main agent or subagent from manually writing approvals or manipulating results, enforcing a completely deterministic quality gateway.

---

## 🛠️ Hook Robustness & Timeout Fix Plan

We are fixing a reliability issue with the `commit-phase-after-ask-user` hook (`04-commit-phase.js --after-ask`), which is triggered on developer commit approval. The hook currently fails because:

1. **Timeout Exceeded**: The hook timeout in `.gemini/settings.json` is set to `5000` (5 seconds). Because the hook executes remote Git pushes and GitHub PR creation, it naturally exceeds this limit and gets terminated.
2. **Misleading Error Reporting**: If any step in the automated commit, push, or PR generation fails, the entire hook fails inside the generic Secure Enclave cryptographic verification `try-catch` block, outputting a misleading "Secure Enclave commit decryption failed" error.

### **Sequential Implementation Checklist**

- [x] Increase the `commit-phase-after-ask-user` hook timeout in `.gemini/settings.json` from `5000` to `60000` ms (60 seconds) to allow sufficient time for Git remote push and PR creation operations.
- [x] Refactor `.gemini/hooks/04-commit-phase.js` (under the `--after-ask` argument) to isolate the automated commit, push, and PR generation into its own dedicated, beautifully logged `try-catch` block to prevent masking of cryptographic Touch ID signature failures and provide high-signal debugging output.
- [x] Verify that all Javascript unit tests pass cleanly after refactoring.
- [x] Perform a dry-run linter execution to ensure formatting and coding standards compliance.

---

## 🛠️ Modular Controller & Function Decoupling Plan (Agent-Scripts)

To prevent code duplication, facilitate clean multi-agent workspace sharing, and support modular extensibility, we are decoupling the core "Agentic" logic (skills and hooks) from the Gemini-specific CLI integration layer:

1. **Root-Level `agent-scripts/` Directory**:
   - All generic, reusable agent scripts (both ESM Node.js files and POSIX Shell helpers) will live directly in a **flat root-level `agent-scripts/` directory**. There are no `hooks` or `skills` subdirectories under `agent-scripts/` because hooks/skills are Gemini-specific CLI integration concepts; the extracted logic represents generic agent procedures.
2. **Controller/Shim Architecture**:
   - Each hook in `.gemini/hooks/` and skill in `.gemini/skills/` will act strictly as a **controller**.
   - These controllers parse Gemini-specific tool execution payloads, make clean function or script calls to the modular scripts under `agent-scripts/`, handle the responses, and output expected Gemini standard protocols.
   - Core implementation functions are broken down into tight, clean files adhering strictly to `shell-scripts.instructions.md` and `github-script.instructions.md` standards.

### **Sequential Implementation Checklist**

- [x] Create the root-level `agent-scripts/` directory.
- **Hooks Decoupling**:
  - Planning gate logic (`checkActiveBlueprint`, `checkActivePlan`) is isolated under `agent-scripts/planning.js`.
  - Cryptographic verification functions (`verifyPlanGate`, `verifyTestGate`, `verifyReviewGate`, `calculateDiffHash`) are extracted to `agent-scripts/gating.js`.
  - Sub-agent report parsing and JSON signature logic (`saveReport`, `verifyTestReport`, `verifyReviewReport`) are extracted to `agent-scripts/after-invoke.js`.
  - Apple Secure Enclave / Touch ID biometric challenges (`handlePlanApproval`, `handleCommitApproval`) are isolated inside `agent-scripts/after-ask.js`.
  - Reusable execution path-safety logic (`verifyGitCommand`) is extracted to `agent-scripts/security.js`.
  - `.gemini/hooks/` and `.claude/hooks/` files act purely as lightweight `PreToolUse` and `AfterToolUse` I/O controllers that import these ESM modules.
- **Skills & Helpers Consolidation**:
  - All legacy modular shell helpers (`git-utils.sh`, `check-branch.sh`, `verify-limits.sh`, `verify-gates.sh`, `commit-helper.sh`, `push-helper.sh`) have been entirely retired.
  - The logic for executing conventional GPG/SSH signed commits, branch verification, push safety, drafting PRs, and checking active blueprints has been heavily fortified, secured, and natively consolidated into `agent-scripts/git-helpers.js`.
  - The legacy AI skills `.gemini/skills/commit-push.sh` and `.gemini/skills/create-pr.sh` have been completely removed. Commits and PRs are now generated securely via the biometric execution of `after-ask.js`.
- **Tooling & Validation Compliance**:
  - The codebase linters (`.github/workflows/scripts/lint.sh`) and formatting engines are configured to scan and secure all `.js` files natively.
  - `eslint.config.mjs` enforces ESM module standards across the `agent-scripts/` and hook directories.
  - Granular, mock-scaffolded unit tests exist in `agent-scripts/tests/` to guarantee absolute runtime safety and cryptographic consistency for all helper functions.
