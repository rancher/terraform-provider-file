---
name: github-ci
description: Inspect, troubleshoot, and resolve GitHub Action workflow failures. Use this skill whenever a CI check fails, when you need to list workflow runs, check failed runs, download job/step logs, or search/grep through downloaded log files to identify compilation or testing errors.
---

# GitHub CI / Actions Troubleshooting

## Overview

The `github-ci` skill provides tools to investigate and resolve failed GitHub Action workflow runs. It helps you quickly list workflow statuses, isolate failures, download entire run logs locally, and search through them for compiler errors, test failures, or syntax issues without leaving the CLI.

## Core Tasks

### 1. List Actions / Workflow Runs

To view the status of recent workflow runs on the current branch, run:

```bash
./scripts/list_runs.sh
```

To check runs on a specific branch or see more results, pass them as arguments:

```bash
./scripts/list_runs.sh <branch_name> [limit]
```

### 2. Isolate Failed Runs

To list only failed workflow runs on the current branch (to find their run IDs), run:

```bash
./scripts/find_failed_runs.sh
```

### 3. Download Job and Step Logs

Once you have identified a failed `run_id`, download the entire run's logs locally for in-depth analysis. This downloads and extracts the logs of all jobs and steps into `/tmp/ci-logs-<run_id>` by default:

```bash
./scripts/download_logs.sh <run_id>
```

You can also specify a custom output directory:

```bash
./scripts/download_logs.sh <run_id> /path/to/directory
```

### 4. Search and Grep Logs for Errors

Use the search tool to scan through the downloaded logs folder for error messages, test failures, or exceptions. It uses a robust set of regex patterns to catch common failure keywords (e.g., error, fail, exit status, panic, exception).

```bash
./scripts/search_logs.sh <logs_directory>
```

To search for a specific error message or component failure, pass a custom pattern:

```bash
./scripts/search_logs.sh <logs_directory> "cannot find package"
```

Once you find the exact failure, navigate to the relevant files in your workspace, apply the fix, and push!
