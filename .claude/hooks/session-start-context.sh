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
  echo "# 2. NEVER execute commit or push skills or commands. Commits/pushes are      #"
  echo "#    solely managed out-of-band by system hooks upon Developer Gate 4 sign-off.#"
  echo "# 3. SOURCE EDITS require GPG-signed plan approval (plan-approval.json).     #"
  echo "#    ALL ACTIVE TASK CHECKLISTS RESIDE STRICTLY INSIDE THE IMPERATIVE PLAN.   #"
  echo "# 4. WE ENFORCE A GATED 6-PHASE LIFECYCLE (Research, Plan, Implement, Test,   #"
  echo "#    Review, Commit). Phase 1 (Research) is strictly EPHEMERAL.               #"
  echo "#    Exiting Research to enter Plan will trigger an automatic and irreversible #"
  echo "#    'git reset --hard' and 'git clean -fd'. ALL UNCOMMITTED CHANGES ARE LOST. #"
  echo "# 5. YOU ARE STRICTLY FORBIDDEN FROM MANUALLY EXECUTING ANY SYSTEM HOOKS OR   #"
  echo "#    SCRIPTS IN '.gemini/hooks/', '.claude/hooks/', OR '.githooks/'. THEY     #"
  echo "#    MUST ONLY BE AUTOMATICALLY TRIGGERED BY THE SYSTEM LIFECYCLE RUNNER.     #"
  echo "#    MANUAL EXECUTION WILL INSTANTLY TRIGGER SECURITY POLICY BLOCKS.          #"
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
