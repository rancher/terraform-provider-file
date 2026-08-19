# Agentic Framework: Cryptographic Gating & Approvals

## Abstract

To maintain absolute system integrity and prevent unauthorized code modifications in an autonomous programming workspace, the Agentic Framework implements a secure, **cryptographically chained gating pipeline**. This system mathematically guarantees that no code can be committed or pushed without satisfying three sequential, hardware-authorized quality checkpoints: Planning (Gate 1), Testing (Gate 2), and Proactive Review (Gate 3).

---

## 🔒 Architectural Rationale: Why We Cryptographically Chain Gates

Traditional CI/CD pipelines and pre-commit checks are highly vulnerable to **TOCTOU (Time-of-Check to Time-of-Use)** attacks and race conditions. An autonomous AI agent could theoretically modify files _after_ passing local tests and reviews, but _before_ executing the final commit, thereby injecting unvetted code into the repository.

To eliminate this vulnerability, our framework enforces a **Strict Cryptographic Chaining Rule**:

1. **The Hash Anchor**: Every stage of the development process is anchored to a unique, live SHA-256 hash of the entire active workspace difference (`git diff HEAD`), termed the `diff_hash`.
2. **Immutable Binding**: When a gating step succeeds, its signature (`plan-approval.json`, `test-approval.json`, or `review-approval.json`) is cryptographically bound to that exact `diff_hash` and the active `plan_hash`.
3. **Chained Verification**: Subsequent gates—and ultimately the custom `.gemini/skills/commit-push.sh` utility—will unconditionally reject operations if any of the following occur:
   - The files on disk change (which changes the current `diff_hash` and causes an immediate mismatch with the signatures).
   - Any signature is missing or altered.
   - The signatures are generated out of order (e.g., trying to write a Review approval before a Test approval is signed).
4. **Self-Healing Revocation**: If any check fails or if the agent modifies any source file, the enforcer hooks automatically unlink (delete) the downstream signatures, immediately revoking approvals and halting the pipeline.

---

## 🧬 Apple Secure Enclave (Touch ID) Gating & Threat Model

In a secure, semi-autonomous engineering environment, the ultimate threat is **Agent Autonomy Escalation**: an AI agent fabricating or signing off on its own changes without real developer oversight.

To prevent this, the framework binds the **Planning Gate (Gate 1)** and the final **Commit Gate (Gate 4)** to a physical piece of hardware: the **Apple Secure Enclave** via macOS Touch ID. This requires a physical, biological touch from the developer to cryptographically sign approvals, ensuring the developer remains the absolute authority over the codebase.

### Cryptographic Decryption Flow

```text
[Gemini CLI]                         [System OS (Enforcer Hook)]                  [Apple Secure Enclave]
     |                                           |                                           |
     | -- 1. Trigger ask_user ("plan") ------>   |                                           |
     |                                           | -- 2. Encrypt Token with Public Key --->  |
     |                                           |       (Writes challenge envelope)         |
     |                                           |                                           |
     | <--- 3. Prompt: "Approve?" -------------- |                                           |
     |                                           |                                           |
     | -- 4. Click: [Approve Plan] ------------> |                                           |
     |                                           | -- 5. Execute age decryption ---------->  |
     |                                           |                                           | [Touch ID Popup]
     |                                           |                                           | <--- Physical Tap
     |                                           | <--- 6. Decrypted Token ----------------- |
     |                                           |                                           |
     | <--- 7. Write plan-approval.json -------- |                                           |
```

1. **Challenge Generation**: The enforcer hook (`after-ask-user.js`) intercepts the approved `ask_user` tool execution. It generates a secure, randomized challenge token and encrypts it using the developer's public GPG/age key (`~/.gemini/age-key.pub`).
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

---

## 🤖 Programmatic Subagent Isolation & AfterTool Hook Integration

While Gates 1 and 4 require human Touch ID biometrics, **Gate 2 (Testing)** and **Gate 3 (Proactive Review)** are programmatically audited and signed by invoking specialized local subagents (`testing_agent` and `review_agent`).

To guarantee absolute objectivity, the subagents are **fully isolated and sandboxed**:

1. **Read-Only Enforcements**: The `review_agent` is stripped of write capabilities, restricting its toolset strictly to `[read_file]`. It cannot modify code or write approvals.
2. **AfterTool Hook Verification**:
   - When the main agent calls `invoke_agent` targeting `testing_agent` or `review_agent`, the native `AfterTool` hook (`after-invoke-agent.js`) intercepts the subagent's execution report.
   - It parses the report looking for the standardized success blocks:
     - `testing_agent` -> `TEST RUN status: 🟢 SUCCESS - All tests and linting passed.`
     - `review_agent` -> `PR Review status: 🟢 PERFECT - 0 findings. Code is fully secure, standard-compliant, and optimized.`
   - If the success string is found, the hook **natively and securely** writes `test-approval.json` or `review-approval.json` to disk, signing it with the active `diff_hash` and `plan_hash`.
   - If any violation or failure is reported, the hook instantly unlinks (deletes) the signatures, revoking any previous approvals.

This architecture prevents the main agent or subagent from manually writing approvals or manipulating results, enforcing a completely deterministic quality gateway.
