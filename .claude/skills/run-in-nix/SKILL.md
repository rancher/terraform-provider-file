---
name: run-in-nix
description: Run a command inside the repo's hermetic Nix development shell, or list the tools it provides. Use when a command needs a tool only available in the Nix shell.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/run-in-nix.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/run-in-nix.sh "<command>"` (e.g. `.gemini/skills/run-in-nix.sh "terraform validate"`), or `.gemini/skills/run-in-nix.sh --list-tools`.
