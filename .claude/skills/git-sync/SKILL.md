---
name: git-sync
description: Safely sync the local fork's default branch (and optionally the current branch) with the upstream repository, auto-stashing uncommitted work to guarantee zero data loss. Use before starting a new branch off main, or when told to sync with upstream.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/git-sync.sh` script (tool-agnostic, shared with the Gemini integration).

Usage:

- `.gemini/skills/git-sync.sh` — sync `main` (and tags) with upstream.
- `.gemini/skills/git-sync.sh stay` — also rebase/sync the current branch on top of the freshly-synced `main`.

Never push directly to a Rancher-owned remote; this script enforces that itself.
