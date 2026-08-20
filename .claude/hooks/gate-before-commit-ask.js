#!/usr/bin/env node
//
// Hook: gate-before-commit-ask.js
// Description: PreToolUse controller for AskUserQuestion. Fails fast — before the
//              developer is ever prompted, and before any Touch ID / Secure Enclave
//              signature is consumed — if Gates 1-3 aren't valid for a commit ask.
//              Mirrors .gemini/hooks/before-ask-user.js's gate sequencing, reusing the
//              shared, tool-agnostic agent-scripts/gating.js functions (unmodified).
//

import fs from 'fs';
import { verifyPlanGate, verifyTestGate, verifyReviewGate, calculateDiffHash } from '../../agent-scripts/gating.js';
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

  if (toolName !== 'AskUserQuestion' || !toolInput) {
    process.exit(0);
  }

  const rawInput = JSON.stringify(toolInput);
  const isCommitAsk = /\bcommit\b/i.test(rawInput) || rawInput.includes('GPG') || /\bpush\b/i.test(rawInput);
  if (!isCommitAsk) {
    process.exit(0);
  }

  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    deny(
      '🔒 Security Policy Violation: Cannot ask for Developer Commit Approval (Gate 4) because Gate 1 ' +
        '(Planning Gate) is missing or invalid.\n\nEnter plan mode, draft your blueprint, and get it approved ' +
        'via ExitPlanMode first — that signs Gate 1.',
    );
  }

  const diffHash = calculateDiffHash();

  if (!verifyTestGate(TARGET_DIR, planHash, diffHash)) {
    deny(
      '🔒 Security Policy Violation: Cannot ask for Developer Commit Approval (Gate 4) because Gate 2 ' +
        '(Testing Gate) is missing or invalid.\n\nRun the testing-agent subagent first and ensure it reports success.',
    );
  }

  if (!verifyReviewGate(TARGET_DIR, diffHash, planHash)) {
    deny(
      '🔒 Security Policy Violation: Cannot ask for Developer Commit Approval (Gate 4) because Gate 3 ' +
        '(Review Gate) is missing or invalid.\n\nRun the review-agent subagent first and ensure it reports 0 findings.',
    );
  }

  process.exit(0);
}

main();
