# Agentic Framework: Secure Workflows & Hook Enforcements

- **Executed Date:** 2026-08-12
- **Purpose:** Establishes robust security gateways and process interceptors inside developer workspaces, mandating the use of the secure `.agent/skills/commit-push.sh` skill and prohibiting direct `git commit` or `git push` commands.

---

## Technical Specification

The framework enforces a zero-bypass Git interceptor pattern to block unvetted developer or agent operations and redirect them cleanly to standardized workflows.

### 1. Interceptor Lifecycle & Flow

```
Developer Command [git commit]
            |
            v
[Husky / Git Hook / API Interceptor] ---> block-rancher-git.js
                                                   |
                                                   v
                                     [Unconditional Rejection]
                                                   |
                                                   v
                                  Redirect to commit-push.sh skill
```

- **Direct Git Block Hook (`block-rancher-git.js`)**: Hook interceptor that blocks any manual execution of `git commit` or `git push`, forcing use of the secure push skill.
- **Planning Enforcement Hook (`enforce-planning.js`)**: Hook interceptor that validates the presence and developer check-off status of a matching plan file before allowing code edits or script runs.

### 2. High-Resilience Syncing (`git-sync.sh`)

To eliminate dirty tree conflicts during upstream synchronization, `git-sync.sh` implements an auto-stashing layer:

- Securely stashes uncommitted changes: `git stash push -k -u -m "temp-auto-stash"`.
- Performs GHA default branch checkout, fetch, and upstream fast-forward.
- Automatically restores stashed changes on script exit (`trap 'cleanup' EXIT`), ensuring zero data loss.

---

## Detailed Checklist History

### Phase 5: Secure Workflows and Push Process Hook Enforcements (PR #394)

- [x] Create root routing files (`GEMINI.md`, `CLAUDE.md`, `.github/copilot-instructions.md`)
- [x] Create master instructions file (`AGENTS.md`)
- [x] Scaffold `.agent` directory structure and populating READMEs
- [x] Address branch-restoration safety in `commit-push.sh`
- [x] Address `jq` dependency elimination using `gh pr view --template`
- [x] Remove bypass hook options (`BYPASS_COMMIT_HOOK=1`) from block scripts

### Phase 8: High-Resilience Syncing & Native TTY Feedback Prompts

- [x] Refactor `git-sync.sh` to implement automatic stash-on-sync and safe stash restoration on exit
- [x] Remove `--no-sync` and `--auto-confirm` options from `commit-push.sh`
- [x] Design and implement stylized, POSIX-compliant TTY prompt script `.agent/hooks/tty-prompt.js`

### Phase 9: Proactive Review Anti-Bypass Guardrails

- [x] Refactor `enforce-planning.js` to deny direct tool edits/writes to `review-approval.json`
- [x] Refactor `block-rancher-git.js` to intercept and deny shell command manipulations or spoofing of `review-approval.json`
