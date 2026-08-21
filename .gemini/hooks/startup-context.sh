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
combined_context+=$'# 2. YOU ARE STRICTLY FORBIDDEN FROM EXECUTING ANY COMMIT OR PUSH SKILLS OR    #\n'
combined_context+=$'#    SHELL COMMANDS. COMMITS AND PUSHES ARE SOLELY MANAGED OUT-OF-BAND BY THE #\n'
combined_context+=$'#    SYSTEM HOOKS UPON DEVELOPER TOUCH ID BIOMETRIC GATE 4 TOUCH-OFF.        #\n'
combined_context+=$'# 3. SOURCE EDITS ARE BLOCKED UNTIL CRYPTOGRAPHIC PLAN APPROVAL IS GRANTED.    #\n'
combined_context+=$'#    ALL ACTIVE TASK CHECKLISTS RESIDE STRICTLY INSIDE THE IMPERATIVE PLAN.   #\n'
combined_context+=$'# 4. WE ENFORCE A GATED 6-PHASE LIFECYCLE (Research, Plan, Implement, Test,   #\n'
combined_context+=$'#    Review, Commit). Phase 1 (Research) is strictly EPHEMERAL.               #\n'
combined_context+=$'#    Exiting Research to enter Plan will trigger an automatic and irreversible #\n'
combined_context+=$'#    \'git reset --hard\' and \'git clean -fd\'. ALL UNCOMMITTED CHANGES ARE LOST. #\n'
combined_context+=$'# 5. YOU ARE STRICTLY FORBIDDEN FROM MANUALLY EXECUTING ANY SYSTEM HOOKS OR   #\n'
combined_context+=$'#    SCRIPTS IN \'.gemini/hooks/\', \'.claude/hooks/\', OR \'.githooks/\'. THEY   #\n'
combined_context+=$'#    MUST ONLY BE AUTOMATICALLY TRIGGERED BY THE SYSTEM LIFECYCLE RUNNER.     #\n'
combined_context+=$'#    MANUAL EXECUTION WILL INSTANTLY TRIGGER SECURITY POLICY BLOCKS.          #\n'
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
