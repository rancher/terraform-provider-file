---
name: github-ci
description: Inspect, troubleshoot, and resolve GitHub Action workflow failures. Use this skill whenever a CI check fails, when you need to list workflow runs, check failed runs, download job/step logs, or search/grep through downloaded log files to identify compilation or testing errors.
---

# GitHub CI / Actions Troubleshooting

## Overview

The `github-ci` skill provides tools to investigate and resolve failed GitHub Action workflow runs using pure JavaScript and the Octokit SDK. It helps you quickly list workflow statuses, isolate failures, parse failed step logs directly, download run logs locally, and search through them for compiler errors, test failures, or syntax issues without leaving the CLI. All scripts automatically provide fallback authentication (`GITHUB_TOKEN` -> default `gh` auth).

**Rule:** You should always use the scripts in this skill instead of running direct `gh` CLI commands when investigating CI failures or fetching workflow logs.

## Core Tasks

### 1. List Actions / Workflow Runs

To view the status of recent workflow runs on the current branch:

```bash
node ./scripts/list_runs.js
```

To check runs on a specific branch or see more results, pass them as arguments:

```bash
node ./scripts/list_runs.js <branch_name> [limit]
```

### 2. Isolate Failed Runs

To list only failed workflow runs on the current branch (to find their run IDs):

```bash
node ./scripts/find_failed_runs.js
```

### 3. Fetch and Parse Failed Step Logs

To quickly extract and parse the exact failure details and error messages from a failed run without downloading and wading through full logs:

```bash
node ./scripts/get_failed_log.js [run_id]
```

If `run_id` is omitted, it automatically targets the most recent failed workflow run on the current branch.

### 4. Download Job and Step Logs

For in-depth analysis when full log dumps are required, download and extract all job and step logs into `/tmp/ci-logs-<run_id>`:

```bash
node ./scripts/download_logs.js [run_id]
```

If `run_id` is omitted or set to `current`, it automatically targets the most recent failed workflow run on the current branch. You can also specify a custom output directory:

```bash
node ./scripts/download_logs.js [run_id] /path/to/directory
```

### 5. Search and Grep Logs for Errors

Use the search tool to scan through a downloaded logs folder for error messages, test failures, or exceptions. It uses regex patterns to catch common failure keywords (e.g., error, fail, exit status, panic, exception):

```bash
node ./scripts/search_logs.js <logs_directory>
```

To search for a specific error message or component failure, pass a custom pattern:

```bash
node ./scripts/search_logs.js <logs_directory> "cannot find package"
```
