#!/usr/bin/env node
//
// Hook: before-ask-user.js
// Description: Executes BeforeTool on ask_user. Programmatically enforces sequential gate checks
//              before allowing the main agent to ask for developer commit/push approval (Gate 4).
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  verifyPlanGate,
  verifyTestGate,
  verifyReviewGate,
  calculateDiffHash,
  checkAndRevokeStaleGates,
} from '../../agent-scripts/gating.js';

const HOME_DIR = os.homedir();
let repoName = '';
try {
  const topLevel = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  repoName = path.basename(topLevel);
} catch {
  repoName = path.basename(process.cwd()) || 'generic-repo';
}
const TARGET_DIR = path.resolve(HOME_DIR, '.gemini/tmp', repoName);

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input } = inputData;

  // We only inspect ask_user tool executions
  if (tool_name !== 'ask_user' || !tool_input) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const isCommitAsk =
    JSON.stringify(tool_input).includes('commit') ||
    JSON.stringify(tool_input).includes('GPG') ||
    JSON.stringify(tool_input).includes('Push') ||
    JSON.stringify(tool_input).includes('Gate 2');

  if (isCommitAsk) {
    // --- Enforce Gates 1, 2, and 3 sequentially ---
    const planHash = verifyPlanGate(TARGET_DIR);
    if (!planHash) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 2) because Gate 1 (Planning Gate) is missing or invalid!\n\n' +
            'Please obtain planning approval from the developer first.',
          systemMessage: '🔒 Security Block: Gate 1 must be approved before commit.',
        }),
      );
      process.exit(0);
    }

    const diffHash = calculateDiffHash();

    // Actively verify and revoke stale signatures on diff mismatch before blocking
    checkAndRevokeStaleGates(TARGET_DIR, diffHash, planHash);

    const testPassed = verifyTestGate(TARGET_DIR, planHash, diffHash);
    if (!testPassed) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 2) because the Testing prerequisite is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run the Testing Subagent first:\n' +
            '   `invoke_agent(agent_name="testing_agent", prompt="Please run all tests and linters.")`',
          systemMessage: '🔒 Security Block: Testing must be approved before commit.',
        }),
      );
      process.exit(0);
    }

    const reviewPassed = verifyReviewGate(TARGET_DIR, diffHash, planHash);
    if (!reviewPassed) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 2) because the Review prerequisite is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run the Review Subagent first:\n' +
            '   `invoke_agent(agent_name="review_agent", prompt="Please review my current changes.")`',
          systemMessage: '🔒 Security Block: Review must be approved before commit.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
