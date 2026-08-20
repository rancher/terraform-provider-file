---
name: get-pr-comments
description: Retrieve and chronologically sort general and inline review comments for a GitHub PR. Use as the first step of the PR-review resolution workflow (docs/development/AgenticFramework/ResolvePRReviews.md).
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/get-pr-comments.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/get-pr-comments.sh [PR_ID] [markdown|json]`. If `PR_ID` is omitted, it auto-detects the open PR for the current branch.
