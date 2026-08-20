---
name: update-action-versions
description: Audit and update GitHub Actions workflow references to their latest pinned commit SHAs/version tags. Use for routine CI dependency maintenance.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/update-action-versions.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/update-action-versions.sh --list-actions` to inspect current pins, or `.gemini/skills/update-action-versions.sh` to update them.

This still requires the normal planning/testing/review/commit gates before pushing — it's a source change like any other.
