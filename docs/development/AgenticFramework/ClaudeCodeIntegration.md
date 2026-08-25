# Agentic Framework: Claude Code Integration

## Abstract

This component documents how the repository's zero-trust, gated development process
(planning, testing, review, and commit gates — see
**[Standard Development Process](./DevelopmentProcess.md)** and
**[Cryptographic Gating & Approvals](./GatingAndApprovals.md)**) is implemented for
Claude Code. It is a parallel implementation, not a port of `.gemini/`: it expresses
the same policy goals through Claude Code's own primitives (native Plan Mode,
subagents, hooks, skills, permissions) instead of Gemini's tool names and hook
events. The two integrations run side by side without interfering with each other.

---

## Primitive Mapping

| Concern                                       | Gemini CLI                                               | Claude Code                                                                |
| --------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Auto-loaded instructions                      | `GEMINI.md` pointer → `.gemini/system.md`                | `CLAUDE.md` (native, auto-loaded)                                          |
| Session context injection                     | `SessionStart` hook (`.gemini/hooks/01-startup-context.js`) | `SessionStart` hook (`.claude/hooks/session-start-context.sh`)             |
| Plan presentation & approval                  | `ask_user` + a separate `exit_plan_mode` check           | native `ExitPlanMode` (single step; Claude Code blocks on real approval)   |
| Sub-agents                                    | `.gemini/agents/*.md`, invoked via `invoke_agent`        | `.claude/agents/*.md`, invoked via `Task`                                  |
| Sub-agent gating                              | `BeforeTool` on `invoke_agent`                           | `PreToolUse` matcher `Task`                                                |
| Sub-agent report → gate signature             | `AfterTool` on `invoke_agent`                            | `SubagentStop` matcher on the agent name                                   |
| Block direct git commit/push, Rancher remotes | `BeforeTool` on `run_shell_command`                      | `PreToolUse` matcher `Bash`                                                |
| Commit approval ask                           | `ask_user` (Gate 4)                                      | `AskUserQuestion` (Gate 4)                                                 |
| Commit-ask gate pre-check (Gates 1-3)         | `BeforeTool` on `ask_user` (`02-plan-phase.js` / `04-commit-phase.js`) | `PreToolUse` matcher `AskUserQuestion` (`gate-before-commit-ask.js`)       |
| Skills/scripts                                | `.gemini/skills/*.sh`                                    | `.claude/skills/<name>/SKILL.md` — thin wrappers around the _same_ scripts |
| Reusable core logic                           | `agent-scripts/*.js`, `agent-scripts/*.sh`               | Same files, reused unmodified                                              |

## Claude-Specific State

Claude's hooks never read or write Gemini's `~/.gemini/tmp/<repo>/` state directory.
They use their own, parallel `~/.claude/tmp/<repo>/` directory
(`.claude/hooks/lib/state-dir.js`) for `plan-approval.json`, `test-approval.json`,
and `review-approval.json`. Gate 2 and 3 approvals (testing/review) were never
cryptographically signed in the Gemini version either — they're plain JSON markers
tied to a SHA-256 diff hash, written after parsing the subagent's final report for
a standardized success string.

Gate 1 (planning) and Gate 4 (commit) are still Secure Enclave / Touch ID signed via
`age`, matching Gemini's guarantee. Claude's hooks look for the key pair at
`~/.claude/age-key.pub` / `~/.claude/age-key.txt` (a separate copy of the same
enrolled key material described in
**[Cryptographic Gating & Approvals](./GatingAndApprovals.md)**).

The one shared file touched to make this possible is `agent-scripts/verify-gates.sh`,
whose `verify_proactive_review` function resolves its state directory from an
`AGENT_STATE_DIR` environment variable, defaulting to the original
`~/.gemini/tmp/<repo>` path when unset — Gemini's behavior is unchanged.

## Gate 1 Mechanics: Why a Hook Writes the Blueprint File

Claude Code's Plan Mode blocks `Edit`/`Write` tool calls entirely until `ExitPlanMode`
is approved, so the actual blueprint document under `docs/development/` cannot be
created via a normal tool call while still planning. `.claude/hooks/sign-plan-gate.js`
resolves this the same way Gemini's `handlePlanApproval` does: on `PostToolUse` for
`ExitPlanMode`, it locates the plan file Claude wrote (most recently modified file
under `~/.claude/plans/`), writes its content directly to
`docs/development/<Slug>.md` via a privileged filesystem write (bypassing the
`enforce-blueprint.js` gate, not subject to it), and only then signs Gate 1.

## Implementation Checklist

- [x] `CLAUDE.md` — auto-loaded root instructions: persona, planning protocol, and
      the four gates.
- [x] `.claude/settings.json` — wires hooks to Claude Code's native events per the
      Primitive Mapping table above.
- [x] `.claude/hooks/*.js` — adapters translating Claude's hook I/O contract to the
      existing `agent-scripts/security.js`, `gating.js`, `after-ask.js`, and
      `after-invoke.js` helpers (all unmodified, reused from the Gemini integration),
      including `gate-before-commit-ask.js` (fail-fast Gates 1-3 pre-check before the
      Gate 4 commit ask, mirroring `.gemini/hooks/04-commit-phase.js --before-ask`).
- [x] `.claude/agents/testing-agent.md`, `review-agent.md` — native subagent
      definitions mirroring `.gemini/agents/*.md`'s instructions and standardized
      pass/fail report strings that `subagent-report-gate.js` parses.
- [x] `.claude/skills/*/SKILL.md` — thin pointers to the existing `.gemini/skills/*.sh`
      scripts (no duplicated logic).
- [x] `docs/development/AgenticFramework.md` — linked from the component list.
- [x] `.github/workflows/scripts/lint.sh`, `eslint.config.mjs` — extended the existing
      eslint/shellcheck/shfmt globs and exclusions to also cover `.claude/hooks/`.
- [x] `.github/workflows/scripts/tests/claude-hooks.test.js` — parity test coverage
      for all `.claude/hooks/*.js` controllers, including regression tests for the
      anti-spoof guardrail in `enforce-blueprint.js`, the `verifyPlanGate`-backed
      chain validation in `subagent-report-gate.js`, and the `docs/development/`
      allowlist scope in `enforce-blueprint.js`.
- [x] Gate 2 (`testing-agent`) and Gate 3 (`review-agent`) run clean against the full
      diff.

### Known follow-up (not in scope for this change)

`agent-scripts/security.js`'s `verifyGitCommand` blocks any Bash command whose text
merely contains the substring `agent-scripts/` — including harmless read-only
commands like `git diff -- agent-scripts/verify-gates.sh`, not just attempts to
execute those scripts. Worth narrowing to an actual-execution pattern in a follow-up
change; not touched here to keep this change scoped to Claude Code parity.
