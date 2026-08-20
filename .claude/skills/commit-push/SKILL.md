---
name: commit-push
description: Securely commit and push local changes with GPG/SSH signature, sign-off, staging-limit checks, and fork synchronization. Use this instead of running `git commit`/`git push` directly — direct invocations are blocked by a PreToolUse hook.
allowed-tools: Bash
---

This wraps the existing, tool-agnostic `.gemini/skills/commit-push.sh` script (also used by the Gemini integration) — do not duplicate its logic, just invoke it.

Usage: `.gemini/skills/commit-push.sh -m "<conventional commit message>"` (add `-f`/`--force` only if you need a safe force-push with lease after rebasing).

Normally you should not need to call this yourself — after Gate 4 (commit) approval via `AskUserQuestion`, the `sign-commit-gate` hook runs this automatically with `AGENT_STATE_DIR` pointed at Claude's own gate-state directory.
