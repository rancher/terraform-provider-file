# Standard Repository Release Process: Architectural Blueprint & Tooling Specification

## **1. Actor-vs-Automation Interaction Swimlanes**

This swimlane diagram traces the detailed event triggers and data flow between development roles and automated GHA runners:

```
|                [ Actor ]                    |                  [ Automation (GHA / Nix / Vault) ]            |
├─────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
|                                             |                                                                |
| === PART 1: PULL REQUEST TO SQUASH-MERGE ===|                                                                |
|                                             |                                                                |
|  1. PR Opened or Code Updated ------------> | ──► Trigger: pull_request (opened / synchronize)               |
|     (Contributor submits change)            |    ├─► Native Copilot Review triggers automatically            |
|                                             |    └─► Nix: Runs static tests, linting, and unit-checks        |
|                                             |         │                                                      |
|                                             |         ▼ (Checks Completed successfully)                      |
|                                             |       Trigger: workflow_run (completed)                        |
|                                             |       ──► Coordinator executes (Dry-Run Mode)                  |
|                                             |           - Scans approval state                               |
|                                             |           - Finds: No trusted reviews or approvals yet         |
|                                             |           - Action: Posts comment: "PR Needs Collaborator Review"|
|                                             |                                                                |
|  2. Collaborator Reviews PR & Comments ---->| ──► Trigger: pull_request_review (submitted)                   |
|     (Collaborator leaves feedback/questions)|       ──► Coordinator executes (Merge Mode)                    |
|                                             |           - Finds: No approvals, unresolved comment threads    |
|                                             |           - Action: Posts status comment: "Unresolved Comments"|
|                                             |                                                                |
|  3. Contributor Resolves Comments           |                                                                |
|     (Option A: Fixes code & pushes commit)  |                                                                |
|     └─► Pushes Commit ────────────────────> | ──► Re-runs Step 1 (Nix Unit Tests -> Dry-Run check)           |
|                                             |                                                                |
|     (Option B: Resolves via browser)        |                                                                |
|     └─► Resolves conversation on GitHub     |      [ No GHA trigger fired for "clicking resolve" ]           |
|                                             |                                                                |
|     (Option C: "Pokes" via comment)         |                                                                |
|     └─► Types top-level or thread comment -> | ──► Trigger: issue_comment / pull_request_review_comment       |
|         (e.g., "resolved", "ready")         |       ──► Coordinator executes (Merge Mode)                    |
|                                             |           - GraphQL: Queries all review threads                |
|                                             |           - Finds: All threads are marked resolved             |
|                                             |           - Action: Updates status comment, waits for Approval │
|                                             |                                                                |
|  4. Collaborator Submits Final Approval ──> | ──► Trigger: pull_request_review (submitted)                   |
|     (Trusted Collaborator clicks "Approve") |       ──► Coordinator executes (Merge Mode)                    |
|                                             |           - GQL Check: Confirms 100% of comment threads resolved│
|                                             |           - Review Check: Validates ≥ 1 Collaborator Approval  |
|                                             |           - Action: Fires Proxy Approval (vouching for review) │
|                                             |           - Action: Fires SemVer Guard (scopes file boundary)  |
|                                             |           - Action: Sanitizes commit message (product-safe)    |
|                                             |           - Action: Executes SQUASH MERGE into 'main'          |
|                                             |           - Action: Automatically deletes status comments      |
|                                             |                                                                |
| === PART 2: SQUASH-MERGE TO PRODUCTION RELEASE =================─────────────────────────────────────────────┤
|                                             |                                                                |
|  5. Squash Merge Lands on main ───────────> | ──► Trigger: push to main                                      |
|                                             |       ──► Release Please Action runs:                          |
|                                             |           - Scans Conventional Commit squash titles            |
|                                             |           - Calculates next version increment                  |
|                                             |           - Action: Updates/creates draft "Release PR"         |
|                                             |             (e.g., "chore: release v1.2.3")                    |
|                                             |                                                                |
|                                             | ──► Trigger: pull_request (targeting Release Please branch)    |
|                                             |       ──► Release PR CI runs:                                  |
|                                             |           - Nix: Runs Unit Tests                               |
|                                             |           - AWS: Assumes OIDC IAM Role                         |
|                                             |           - Nix: Executes FULL ACCEPTANCE TEST SUITE           |
|                                             |                  (acc-relay: Real AWS resource deployment)      |
|                                             |         │                                                      |
|                                             |         ▼ (Heavy Integration Tests Pass)                       |
|                                             |       ──► Release Candidate (RC) Step:                         |
|                                             |           - Calculates next RC tag (e.g., v1.2.3-rc.0) via API |
|                                             |           - Vault: Securely extracts GPG keys                  |
|                                             |           - Nix: GoReleaser compiles & signs RC binaries       |
|                                             |           - Action: Publishes GPG-Signed RC Release            |
|                                             |                                                                |
|  6. Maintainer Merges Release PR ─────────> | ──► Trigger: push to main (Release PR merged)                  |
|     (Maintainer approves/merges Release PR) |       ──► Release Please Action runs:                          |
|                                             |           - Detects Release PR merge                           |
|                                             |           - Action: Outputs: release_created = true            |
|                                             |         │                                                      |
|                                             |         ▼                                                      |
|                                             |       ──► Full Release Step:                                   |
|                                             |           - Action: Automatically tags version (v1.2.3)        |
|                                             |           - Vault: Securely extracts GPG credentials           |
|                                             |           - Keyring Workaround: Dynamically parses primary ID  |
|                                             |           - Nix: GoReleaser cross-compiles stable binaries     |
|                                             |           - Action: Publishes Final GPG-Signed Release         |
|                                             |                                                                |
```

---

## **2. Core Automation & Security Tooling Specifications**

To enforce a zero-trust, reproducible release pipeline, the repository utilizes four foundational tools: **Nix**, **The CI-Image**, **Release Please**, and **GoReleaser**.

### **A. Nix: Zero-Trust Hermetic Reproducibility**
* **Purpose:** Nix acts as a declarative package manager that defines the **exact build and test environment** down to the cryptographic hash. It locks the compiler, linter, runtime, and CLI utilities (Go, Node.js, Terraform, actionlint, etc.) in `flake.nix`.
* **Security & Automation Contribution:**
  - **Eliminates Environment Drift:** Standardizes the toolchain so that a developer running a test locally uses the *exact same binary byte-code* as the CI runner, eliminating "works on my machine" failures.
  - **Zero-Dependency Host Runners:** The GitHub Actions runner does not need pre-installed tools. Nix fetches and isolates everything inside a sandbox, securing the pipeline against malicious or outdated runner environments.

### **B. The CI-Image: Pre-Built Dependency Caching**
* **Purpose:** A pre-built Docker image (`ghcr.io/rancher/ci-image/nix`) containing a base Nix environment and pre-cached tool dependencies.
* **Security & Automation Contribution:**
  - **Time Optimization:** Bootstrapping Nix and compiling developer tools on every GHA workflow run can take several minutes. The pre-built CI image slashes initialization overhead to under **15 seconds**.
  - **Immutable Runtime Environment:** By freezing the CI-Image version (e.g. `nix:20260603-18`), the project secures its pipeline against supply-chain updates and runtime image modifications.

### **C. Release Please: Declarative Versioning & Changelog Automation**
* **Purpose:** An automated release management engine that parses Conventional Commits (`feat:`, `fix:`, `chore:`) to calculate Semantic Versioning (SemVer) jumps.
* **Security & Automation Contribution:**
  - **Manual Versioning Eradication:** Completely automates version calculations and generates high-fidelity changelogs.
  - **The Release PR Pattern:** Instead of tagging immediately on merge, it maintains a long-lived "Release PR" that acts as a staging queue. This allows the team to inspect version jumps and provides a physical gateway where final integration tests are executed.

### **D. GoReleaser: Automated Compiling, Packaging & GPG Signing**
* **Purpose:** A release automation engine designed to build, package, sign, and publish compiled binaries (such as Terraform providers) for multiple CPU architectures and Operating Systems.
* **Security & Automation Contribution:**
  - **Cryptographic Signing (GPG):** GoReleaser integrates with local GPG keys (securely pulled from Vault in memory) to cryptographically sign provider binaries and generate SHA256 checksums. This guarantees to the Terraform Registry that the binary has not been tampered with since compilation.
  - **Standardized Multi-Platform Matrixing:** Automatically cross-compiles for `linux`, `darwin`, and `windows` across `amd64` and `arm64` in a single, atomic step.
  
#### **🔧 Security Engineering Tip: GPG Key ID Extraction Workaround**
Static configuration of a GPG Key ID in secrets managers often leads to breaking releases. For example, if a key is rotated, or if Vault is accidentally configured with an encryption subkey ID rather than the primary signing key ID, GoReleaser will abort with a signing failure.

**The Workaround:** 
To handle this key-matching weirdness, the pipeline imports the raw secret key and then **dynamically inspects the GPG key-ring in real-time** to extract the true primary signing key ID (`sec`). It overrides any static `GPG_KEY_ID` configuration with the dynamically detected ID:
```bash
# 1. Strip whitespace/spaces from static GPG_KEY_ID config
export GPG_KEY_ID=$(echo -n "${GPG_KEY_ID}" | tr -d '[:space:]')

# 2. Import raw key block into local keyring
echo "${GPG_KEY}" | gpg --import --batch

# 3. Query the GPG keyring to extract the actual imported primary secret key ID (sec)
SEC_LINE=$(gpg --batch --list-secret-keys --keyid-format LONG | grep -E '^sec' | head -n1 || true)
if [[ -n "${SEC_LINE}" ]]; then
  # Parse out the key ID after the '/' separator
  DETECTED_KEY_ID=$(echo "${SEC_LINE}" | awk '{print $2}' | cut -d'/' -f2)
  if [[ -n "${DETECTED_KEY_ID}" ]]; then
    # Overwrite the static variable with the actual imported ID
    GPG_KEY_ID="${DETECTED_KEY_ID}"
  fi
fi
```
This guarantees that GPG signing never fails due to subkey mismatches, whitespace issues, or misconfigured key identifiers.

---

## **3. Standard Phase Specifications**

### **Phase 1: Zero-Trust Pull Request Checking (CHECK)**
* **PR Opened:** A contributor submits a Pull Request targeting `main`.
* **Checked:** The standard PR checkers run inside the hermetic **Nix** shell on GHA. This executes static code linters (`golangci-lint`, `actionlint`, `shellcheck`, `gitleaks`) and runs localized unit tests with zero-trust permissions.
* **Copilot Review:** Natively triggered repository integration initiates automated AI review comments.

---

### **Phase 2: Secure, Event-Driven Merge Coordination (COORD)**
* **Event Triggered:** Completion of the checks or reviews initiates the event coordinator. This executes on `workflow_run` in the secure default branch context (`main`), protecting secrets while enabling write-level access.
* **Validated Reviews/GQL:** The coordinator checks that the PR has met the threshold of **at least 1 approval** from a trusted role (Collaborator, Member, or Owner) and runs GraphQL queries to guarantee **100% of all review comments are marked resolved** (whether left by humans or AI).
* **Proxy Approval:** If the reviewer approved but lacks Write-level administrative access in the repo (e.g., they have Triage-level access), the GHA bot automatically submits an `APPROVE` review on the PR. Since the bot has Write access, its approval satisfies GitHub's branch protection requirements, serving as a proxy for the reviewer's intent.

---

### **Phase 3: Automated SemVer Guard & Squash Merge (MERGE)**
* **Scoped Boundary Check:** Evaluates modified files. If changes are exclusively non-product (e.g. docs, tests, CI files outside the core `internal/` directory), the SemVer Guard is activated.
* **Title Sanitized:** If SemVer Guard is active, conventional commit types like `feat` or `refactor` and breaking indicators (`!`) are dynamically stripped or downgraded to `chore` or `fix` to prevent unintentional Minor or Major version bumps.
* **Squash Merged:** The PR is squashed and merged into `main` using the sanitized conventional commit message.

---

### **Phase 4: Release Management & The Integration Test Gate (GATES)**
* **Release PR Maintained:** Merging into `main` triggers `Release Please`. It calculates the next version and automatically updates a draft "Release PR" containing updated version coordinates and changelogs.
* **Integration Tests Gate:** The Release PR acts as a staging queue where a dedicated CI workflow executes the **full integration and acceptance test suite** (using real cloud resources/relays). Merging is blocked until this suite passes.
* **Release PR Merged:** Merging this PR triggers the final release process.

---

### **Phase 5: Release Tagging & Cryptographic Signing (PUBLISH)**
* **Tagged vX.Y.Z:** `Release Please` registers the release merge and automatically creates and pushes the official semantic git tag.
* **Key Extracted:** The workflow imports the signing GPG block from Vault and dynamically queries the keyring to extract the actual primary secret key ID to work around subkey/mismatch weirdness.
* **Signed & Published:** GoReleaser compiles binaries inside the reproducibly locked Nix environment, signs them with the GPG key, and publishes the signed provider assets directly to the GitHub Release.
