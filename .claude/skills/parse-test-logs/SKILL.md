---
name: parse-test-logs
description: Parse a gotestsum/`go test -json` log file into a structured pass/fail/timing report, without dumping the raw log into context. Use after redirecting a full test-suite run to a file.
allowed-tools: Bash
---

Wraps the existing `.gemini/skills/parse-test-logs.sh` script (tool-agnostic, shared with the Gemini integration).

Usage: `.gemini/skills/parse-test-logs.sh [-f /path/to/log] [--failed-only] [--no-color]`. If `-f` is omitted, the newest `/tmp/*_test.log` file is used.

The full test suite can take over an hour and generate massive logs — redirect its output to a file and use this instead of reading the raw log.
