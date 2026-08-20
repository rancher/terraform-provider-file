---
name: create-pr
description: Create a draft pull request from the current branch, or graduate an existing draft PR to ready-for-review. Use for Phase 6 (Draft PR & Ready Conversion) of the development process.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/create-pr.sh` script (tool-agnostic, shared with the Gemini integration).

Usage:

- `.gemini/skills/create-pr.sh --title "<title>" --body "<body>" [--base main] [--draft]` — create a PR.
- `.gemini/skills/create-pr.sh --ready [target]` — convert a draft PR to ready-for-review (defaults to the current branch).

Draft PR creation normally happens automatically after Gate 4 commit approval, right after `commit-push`.
