---
name: resolve-pr-reviews
description: Programmatically list and resolve GitHub PR review comment threads via GraphQL and the GitHub CLI. Use during the PR-review resolution workflow (docs/development/AgenticFramework/ResolvePRReviews.md), after posting responses and pushing fixes.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/resolve-pr-reviews.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/resolve-pr-reviews.sh [PR_ID] [options/file_pattern]`, e.g. `.gemini/skills/resolve-pr-reviews.sh 390 --bypass-token --all`.

Run `get-pr-comments` first to see the full comment timeline before deciding what to resolve.
