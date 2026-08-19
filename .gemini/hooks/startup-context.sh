#!/usr/bin/env bash
set -euo pipefail

# Consume and discard hook input from stdin to prevent broken pipes
cat > /dev/null

# Log diagnostics to stderr to comply with the silence rule on stdout
echo "Loading session-start workspace context..." >&2

combined_context=""
combined_context+=$'###############################################################################\n'
combined_context+=$'#                           CRITICAL AGENT MANDATES                           #\n'
combined_context+=$'#                                                                             #\n'
combined_context+=$'# 1. YOU MUST FOLLOW THE DEVELOPMENT PROCESS IN \'docs/development/AgenticFramework/DevelopmentProcess.md\'. #\n'
combined_context+=$'# 2. YOU MUST NEVER COMMIT OR PUSH DIRECTLY. YOU MUST ALWAYS USE THE CUSTOM   #\n'
combined_context+=$'#    COMMIT-PUSH SKILL: \'.gemini/skills/commit-push.sh -m "message"\'.          #\n'
combined_context+=$'# 3. FOR ALL TASKS, YOU MUST DEFINE A SEQUENTIAL IMPLEMENTATION CHECKLIST AT  #\n'
combined_context+=$'#    THE BOTTOM OF YOUR SPECIFICATION IN \'docs/development/<Topic>/<Component>.md\'. #\n'
combined_context+=$'#                                                                             #\n'
combined_context+=$'# FAILURE TO COMPLY WILL TRIGGER SECURITY BLOCKS AND PROCESS TERMINATION.     #\n'
combined_context+=$'###############################################################################\n\n'

if [[ -f "docs/development/AgenticFramework.md" ]]; then
  combined_context+=$'# Context from docs/development/AgenticFramework.md\n\n'
  combined_context+=$(cat docs/development/AgenticFramework.md)
  combined_context+=$'\n\n'
  echo "Loaded docs/development/AgenticFramework.md" >&2
else
  echo "Warning: docs/development/AgenticFramework.md not found" >&2
fi

if [[ -f "docs/development/AgenticFramework/DevelopmentProcess.md" ]]; then
  combined_context+=$'# Context from docs/development/AgenticFramework/DevelopmentProcess.md\n\n'
  combined_context+=$(cat docs/development/AgenticFramework/DevelopmentProcess.md)
  combined_context+=$'\n\n'
  echo "Loaded docs/development/AgenticFramework/DevelopmentProcess.md" >&2
else
  echo "Warning: docs/development/AgenticFramework/DevelopmentProcess.md not found" >&2
fi

# Output clean JSON structure to stdout
jq -n --arg ctx "$combined_context" '{
  "hookSpecificOutput": {
    "additionalContext": $ctx
  },
  "systemMessage": "✨ AgenticFramework.md and DevelopmentProcess.md context injected successfully."
}'
