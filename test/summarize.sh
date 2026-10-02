#!/usr/bin/env bash
set -euo pipefail

# summarize.sh - reads report.json and prints a summary

show_help() {
  cat <<'EOF'
Usage: summarize.sh [OPTIONS] [REPORT_FILE]

Parses report.json (or the specified REPORT_FILE) and prints a formatted
summary of passed and failed tests.

Options:
  -h, --help    Show this help message and exit
EOF
}

process_tests() {
  local action="${1}"
  local file="${2}"
  # slurp is important here, it reads the objects into an array for further processing
  jq --slurp -r --arg action "$action" \
    '
    # select all objects with a .Test listed that matches $action and store it as $tests
    (map(select(.Test and .Action == $action) | .Test ) | unique) as $tests |
    # iterate through tests and save the test name as $prefix
    $tests[] | . as $prefix |
    # filter out any test names that dont exactly match the current test name, but do have the test name in them followed by a slash
    select(any($tests[]; . != $prefix and startswith($prefix+"/"))|not)
    # this leaves only test names that dont have duplicate prefixes, ie. the actual tests and not the parent blocks
    ' \
    "$file"
}

main() {
  local report_file="report.json"
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    show_help
    exit 0
  fi

  if [[ "${1:-}" == "--" ]]; then
    shift
  elif [[ "${1:-}" =~ ^- ]]; then
    echo "Error: Unknown option '${1}'" >&2
    show_help >&2
    exit 1
  fi

  if [[ $# -gt 1 ]]; then
    echo "Error: Too many arguments (expected at most 1)." >&2
    show_help >&2
    exit 1
  elif [[ -n "${1:-}" ]]; then
    report_file="${1}"
  fi

  # If report file was not generated, exit cleanly if default, or error if explicitly specified
  if [[ ! -f "$report_file" ]]; then
    if [[ -n "${1:-}" ]]; then
      echo "Error: Report file '$report_file' not found." >&2
      exit 1
    fi
    exit 0
  fi

  # Ensure jq is installed
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: 'jq' is not installed. Please install it to generate the summary." >&2
    exit 1
  fi

  local passed_tests failed_tests
  if ! passed_tests=$(process_tests "pass" "$report_file") \
    || ! failed_tests=$(process_tests "fail" "$report_file"); then
    echo "Error: Failed to parse test report in '$report_file' (malformed JSON)." >&2
    exit 1
  fi

  printf "\n==================== TEST SUMMARY ====================\n"

  printf "\nPASSED TESTS:\n"
  if [[ -n "$passed_tests" ]]; then
    printf '%s\n' "$passed_tests"
  else
    echo "  (None)"
  fi

  printf "\nFAILED TESTS:\n"
  if [[ -n "$failed_tests" ]]; then
    printf '%s\n' "$failed_tests"
  else
    echo "  (None)"
  fi

  printf "\n======================================================\n\n"

  # Clean up default report.json upon successful completion
  if [[ "$report_file" == "report.json" || "$report_file" == "./report.json" ]]; then
    rm -f "$report_file"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
