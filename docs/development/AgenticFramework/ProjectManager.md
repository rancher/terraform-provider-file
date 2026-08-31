# Project Manager & Map-Reduce Code Review Specifications

This component specification details the persona, orchestration sequences, safety boundaries, and verification criteria governing our automated pre-commit Map-Reduce Review pipeline coordinated by `@project_manager`.

---

## Abstract

To maintain absolute codebase security, logic correctness, and compliance with our Diátaxis-structured Reference coding standards, this repository implements an automated, parallelized Map-Reduce Code Review pipeline.

Instead of relying on monolithic prompts that suffer from context-inflation and leniency, we leverage a native three-agent ecosystem:

1. **The Project Manager (`@project_manager`):** Orchestrates the overall execution flow, runs git checks, maps file diffs, and compiles the final report.
2. **The Heads-Down Coder (`@heads_down_coder`):** A rule-stickler worker agent that audits individual file diffs line-by-line for flaws, weaknesses, and inelegant wording (Map Phase).
3. **The Data Scientist (`@data_scientist`):** A precise lead aggregator that de-duplicates, categorizes, and compiles raw findings into an unbiased, problem-only 4-Pass Quality Gate report (Reduce Phase).

---

## 🧭 Map-Reduce Execution Sequence

When the primary development session invokes `@project_manager` during the Review Phase (Gate 2):

```text
  [ Developer Session ]
           │
           ▼ (invoke_agent)
     @project_manager ──► (Step 1: Runs git diff --name-only main)
           │
           ├─► (Step 2: Map Phase - Invokes @heads_down_coder per file diff)
           │    ├─► @heads_down_coder [Go.md] ──────► Notes
           │    ├─► @heads_down_coder [JavaScript.md] ──► Notes
           │    └─► @heads_down_coder [ShellScripts.md] ──► Notes
           │
           ▼
     @project_manager ──► (Step 3: Reduce Phase - Invokes @data_scientist with compiled notes)
           │
           ▼
     @data_scientist ──► Groups, de-duplicates, sorts HIGH to LOW, and compiles final report
           │
           ▼ (Step 4: Returns final 4-Pass report)
  [ Gating Hooks ] ──► (Programmatically scans report and signs review-approval.json)
```

### Step 1: Identify Changed Files

The `@project_manager` executes `git diff --name-only main` to isolate modified files, aggressively skipping binary lockfiles and assets to conserve context.

### Step 2: Map Phase (Adversarial Auditing)

For each file, the `@project_manager` extracts its specific diff (`git diff main -- [file]`) and triggers `@heads_down_coder` using `invoke_agent`.

- The `@heads_down_coder` acts as an un-compromising, rule-stickler reviewer. It treats execution like a chess puzzle, noting every logic, syntax, documentation, or security flaw, and outputs raw, line-numbered jottings without proposing solutions.

### Step 3: Reduce Phase (Data-Driven Aggregation)

The `@project_manager` compiles all raw coder findings and invokes `@data_scientist` using `invoke_agent`.

- The `@data_scientist` de-duplicates matching comments, categorizes larger systemic patterns, and sorts concerns strictly by severity:
  - **Inconsequential (LOW):** Formatting, spellings, cosmetic rewordings.
  - **Consequential (MED/HIGH):** Logic, execution, correctness, and security.
    - **HIGH:** Main operation failures or major security holes.
    - **MED:** Edge cases, resource safety, and minor bugs.
- **Absolute Objectivity:** It produces a clinical, problem-only report (strictly no solution bias).

### Step 4: Final Output and Signature Gating

The `@project_manager` returns the structured 4-Pass report to the primary session. The pre-commit review hook `03-review-phase.js --after-invoke` programmatically scans the report for required passes and keywords. Upon success, it cryptographically signs the review gate, writing `review-approval.json` to disk and unlocking the Commit Phase (Gate 3).

---

## 🔒 Hardened Sandbox & Security Boundaries

- **Read-Only Enforcements:** The subagents are completely stripped of write capabilities, restricting their toolsets strictly to `[read_file]`, `[glob]`, and `[run_shell_command]`. They cannot modify code or manually write signatures.
- **Zero Hook Interference:** Because the project manager and its subagents are called natively within the active session using the `invoke_agent` tool, they execute in-process. This prevents the spawning of new shell sessions, bypassing all redundant workspace startup hooks natively!
- **Safe Command Excursions:** When running `git diff`, the `@project_manager` uses argv arrays, preventing shell injection vulnerabilities.
