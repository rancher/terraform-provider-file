#!/usr/bin/env bash
#
# Hook: session-start-context.sh
# Description: SessionStart hook. Consumes and discards hook input from stdin, then
#              prints the AgenticFramework overview and DevelopmentProcess spec to
#              stdout so Claude Code injects them as session context.
#
set -euo pipefail

# Print a beautifully formatted help manual and exit cleanly
show_help() {
  cat <<EOF
Usage: session-start-context.sh [options]

SessionStart hook for Claude Code. Consumes stdin and prints session context.

Options:
  -h, --help      Show this help message and exit.
EOF
}

# Print the AgenticFramework and DevelopmentProcess context
print_context() {
  echo "###############################################################################"
  echo "#                           CRITICAL AGENT MANDATES                         #"
  echo "#                                                                             #"
  echo "# 1. FOLLOW docs/development/AgenticFramework/DevelopmentProcess.md.         #"
  echo "# 2. NEVER commit or push directly. Use .gemini/skills/commit-push.sh.       #"
  echo "# 3. SOURCE EDITS require an active blueprint under docs/development/.       #"
  echo "#                                                                             #"
  echo "# FAILURE TO COMPLY WILL TRIGGER SECURITY BLOCKS AND TOOL DENIALS.           #"
  echo "###############################################################################"
  echo ""

  if [[ -f "docs/development/AgenticFramework.md" ]]; then
    echo "# Context from docs/development/AgenticFramework.md"
    echo ""
    cat "docs/development/AgenticFramework.md"
    echo ""
  fi

  if [[ -f "docs/development/AgenticFramework/DevelopmentProcess.md" ]]; then
    echo "# Context from docs/development/AgenticFramework/DevelopmentProcess.md"
    echo ""
    cat "docs/development/AgenticFramework/DevelopmentProcess.md"
    echo ""
  fi
}

# Orchestrate the entire execution flow
main() {
  # Parse options
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        show_help >&2
        exit 1
        ;;
    esac
  done

  # Consume and discard hook input from stdin
  cat >/dev/null

  print_context
}

main "$@"
