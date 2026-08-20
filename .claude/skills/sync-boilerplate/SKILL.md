---
name: sync-boilerplate
description: Compare, pull, or push shared boilerplate/configuration files against a centralized template repository, per .boilerplate-sync.json. Use when linters, CI scripts, or shared configs need to be checked against or synced with the master template.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/sync-boilerplate.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/sync-boilerplate.sh --diff|--pull|--push|--status`. See `docs/development/AgenticFramework/BoilerplateSync.md` for the full manifest format and semantics.
