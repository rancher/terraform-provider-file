#!/usr/bin/env bash
#
# Script: log-trigger.sh
# Description: Logs the trigger conditions and environment variables for the pull request review trigger.

set -euo pipefail

show_help() {
  cat <<EOF
Usage: log-trigger.sh [options]

Logs the trigger conditions and environment variables.

Options:
  -h, --help           Show this help message and exit.
EOF
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        show_help
        exit 0
        ;;
      *)
        echo "Error: Unexpected argument: $1" >&2
        show_help
        exit 1
        ;;
    esac
  done

  echo "==> Trigger conditions met successfully!"
  echo "    Comment Author: @${COMMENT_AUTHOR:-unknown}"
  echo "    Author Association: ${AUTHOR_ASSOCIATION:-unknown}"
  echo "    Event Name: ${EVENT_NAME:-unknown}"
}

main "$@"
