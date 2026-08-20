---
name: pull-ci-logs
description: Download GitHub Actions CI logs for a run or specific job, or list recently failed runs/jobs. Use when troubleshooting a pipeline failure (docs/development/AgenticFramework/TroubleshootWorkflows.md).
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/pull-ci-logs.sh` script (tool-agnostic, shared with the Gemini integration).

Usage:

- `.gemini/skills/pull-ci-logs.sh --list-failed` — list recently failed workflow runs.
- `.gemini/skills/pull-ci-logs.sh --list-jobs <run-id>` — list failed jobs in a run.
- `.gemini/skills/pull-ci-logs.sh --job <job-id>` — download logs for one job.
- `.gemini/skills/pull-ci-logs.sh <run-id> --failed-only` — download only failed-step logs for a run.

Prefer downloading a single job's logs over the whole run to avoid flooding context.
