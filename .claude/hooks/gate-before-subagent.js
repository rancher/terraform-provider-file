#!/usr/bin/env node
//
// Hook: gate-before-subagent.js
// Description: PreToolUse controller for the Task tool. Enforces sequential gate
//              progression before allowing the testing-agent or review-agent
//              subagents to run, mirroring .gemini/hooks/before-invoke-agent.js.
//              Reuses the shared, tool-agnostic agent-scripts/gating.js functions
//              (unmodified), pointed at Claude's own state directory.
//

import fs from 'fs';
import { verifyPlanGate, verifyTestGate, calculateDiffHash } from '../../agent-scripts/gating.js';
import { getStateDir } from './lib/state-dir.js';

const TARGET_DIR = getStateDir();

function deny(message) {
  console.error(message);
  process.exit(2);
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const { tool_name: toolName, tool_input: toolInput } = inputData;

  if (toolName !== 'Task' || !toolInput) {
    process.exit(0);
  }

  const subagentType = toolInput.subagent_type;

  if (subagentType === 'testing-agent') {
    const planHash = verifyPlanGate(TARGET_DIR);
    if (!planHash) {
      deny(
        '🔒 Security Policy Violation: Cannot run the testing-agent because Gate 1 (Planning Gate) is missing or invalid.\n\n' +
          'Enter plan mode, draft your blueprint, and get it approved via ExitPlanMode first — that signs Gate 1.',
      );
    }
  } else if (subagentType === 'review-agent') {
    const planHash = verifyPlanGate(TARGET_DIR);
    if (!planHash) {
      deny(
        '🔒 Security Policy Violation: Cannot run the review-agent because Gate 1 (Planning Gate) is missing or invalid.',
      );
    }

    const diffHash = calculateDiffHash();
    const testPassed = verifyTestGate(TARGET_DIR, planHash, diffHash);
    if (!testPassed) {
      deny(
        '🔒 Security Policy Violation: Cannot run the review-agent because Gate 2 (Testing Gate) is missing or invalid.\n\n' +
          'Run the testing-agent subagent first and ensure it reports success.',
      );
    }
  }

  process.exit(0);
}

main();
