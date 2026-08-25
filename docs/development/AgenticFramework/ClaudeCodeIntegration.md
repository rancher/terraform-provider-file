# Agentic Framework: Claude Code Integration

## Abstract

This component documents how the repository's zero-trust, gated development process (planning, testing, review, and commit gates — see **[Standard Development Process](./DevelopmentProcess.md)** and **[Cryptographic Gating & Approvals](./GatingAndApprovals.md)**) is implemented for Claude Code. It is a parallel implementation, not a port of `.gemini/`: it expresses the same policy goals through Claude Code's own primitives (native Plan Mode, subagents, hooks, skills, permissions) instead of Gemini's tool names and hook events. The two integrations run side by side without interfering with each other.

---

## Primitive Mapping

| Concern                                       | Gemini CLI                                                             | Claude Code                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Auto-loaded instructions                      | `GEMINI.md` pointer → `.gemini/system.md`                              | `CLAUDE.md` (native, auto-loaded)                                          |
| Session context injection                     | `SessionStart` hook (`.gemini/hooks/01-startup-context.js`)            | `SessionStart` hook (`.claude/hooks/session-start-context.sh`)             |
| Plan presentation & approval                  | `ask_user` + a separate `exit_plan_mode` check                         | native `ExitPlanMode` (single step; Claude Code blocks on real approval)   |
| Sub-agents                                    | `.gemini/agents/*.md`, invoked via `invoke_agent`                      | `.claude/agents/*.md`, invoked via `Task`                                  |
| Sub-agent gating                              | `BeforeTool` on `invoke_agent`                                         | `PreToolUse` matcher `Task`                                                |
| Sub-agent report → gate signature             | `AfterTool` on `invoke_agent`                                          | `SubagentStop` matcher on the agent name                                   |
| Block direct git commit/push, Rancher remotes | `BeforeTool` on `run_shell_command`                                    | `PreToolUse` matcher `Bash`                                                |
| Commit approval ask                           | `ask_user` (Gate 3)                                                    | `AskUserQuestion` (Gate 3)                                                 |
| Commit-ask gate pre-check (Gates 1-2)         | `BeforeTool` on `ask_user` (`02-plan-phase.js` / `04-commit-phase.js`) | `PreToolUse` matcher `AskUserQuestion` (`gate-before-commit-ask.js`)       |
| Skills/scripts                                | `.gemini/skills/*.sh`                                                  | `.claude/skills/<name>/SKILL.md` — thin wrappers around the _same_ scripts |
| Reusable core logic                           | `agent-scripts/*.js`, `agent-scripts/*.sh`                             | Same files, reused unmodified                                              |

## Claude-Specific State

Claude's hooks never read or write Gemini's `~/.gemini/tmp/<repo>/` state directory. They use their own, parallel `~/.claude/tmp/<repo>/` directory (`.claude/hooks/lib/state-dir.js`) for `plan-approval.json`, `test-approval.json`, and `review-approval.json`. Gate 2 approvals (testing/review) are plain JSON markers tied to a SHA-256 diff hash, written after parsing the subagent's final report for a standardized success string.

Gate 1 (planning) and Gate 3 (commit) are still Secure Enclave / Touch ID signed via `age`, matching Gemini's guarantee. Claude's hooks look for the key pair at `~/.claude/age-key.pub` / `~/.claude/age-key.txt` (a separate copy of the same enrolled key material described in **[Cryptographic Gating & Approvals](./GatingAndApprovals.md)**).

The one shared file touched to make this possible is `agent-scripts/verify-gates.sh`, whose `verify_proactive_review` function resolves its state directory from an `AGENT_STATE_DIR` environment variable, defaulting to the original `~/.gemini/tmp/<repo>` path when unset — Gemini's behavior is unchanged.

## Gate 1 Mechanics: Why a Hook Writes the Plan File

Claude Code's Plan Mode blocks `Edit`/`Write` tool calls entirely until `ExitPlanMode` is approved, so the actual plan checklist under `plans/` cannot be created via a normal tool call while still planning. `.claude/hooks/sign-plan-gate.js` resolves this the same way Gemini's `handlePlanApproval` does: on `PostToolUse` for `ExitPlanMode`, it locates the plan file Claude wrote (most recently modified file under `~/.claude/plans/`), writes its content directly to `plans/<Slug>.md` via a privileged filesystem write, and only then signs Gate 1.
