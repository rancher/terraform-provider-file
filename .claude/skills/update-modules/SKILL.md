---
name: update-modules
description: Detect and update all Terraform Registry module references in .tf files to their latest published versions. Use for routine dependency maintenance.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/update-modules.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/update-modules.sh --list-modules` to inspect current versions, or `.gemini/skills/update-modules.sh` to update them.

This still requires the normal planning/testing/review/commit gates before pushing — it's a source change like any other.
