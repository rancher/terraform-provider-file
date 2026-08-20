#!/usr/bin/env node
//
// Hook: before-invoke-agent.js
// Description: Executes BeforeTool on invoke_agent. Programmatically enforces sequential gate checks
//              before allowing the main agent to execute sub-agents, preventing out-of-order execution.
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { verifyPlanGate, verifyTestGate, calculateDiffHash } from '../../agent-scripts/gating.js';

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

  // We only inspect invoke_agent tool executions
  if (tool_name !== 'invoke_agent' || !tool_input) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const agentName = tool_input.agent_name;

  if (agentName === 'testing_agent') {
    // --- Enforce Gate 1: Planning Approved before Testing ---
    const planHash = verifyPlanGate(TARGET_DIR);
    if (!planHash) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot execute the Testing Subagent because Gate 1 (Planning Gate) is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST first obtain a valid, cryptographically signed plan approval from the developer.\n\n' +
            'To proceed:\n' +
            '1. Call `ask_user` to present your active plan and obtain developer consent.\n' +
            '2. The system will automatically prompt the developer for biometric approval in the background.\n' +
            '3. Once the planning gate is verified, you will be authorized to execute the Testing Subagent.',
          systemMessage: '🔒 Security Block: Gate 1 (Planning Gate) must be approved before testing.',
        }),
      );
      process.exit(0);
    }
  } else if (agentName === 'review_agent') {
    // --- Enforce Plan and Test Approved before Review ---
    const planHash = verifyPlanGate(TARGET_DIR);
    if (!planHash) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot execute the Review Subagent because Gate 1 (Planning Gate) is missing or invalid!\n\n' +
            'Please obtain planning approval from the developer first.',
          systemMessage: '🔒 Security Block: Gate 1 must be approved before review.',
        }),
      );
      process.exit(0);
    }

    const diffHash = calculateDiffHash();
    const testPassed = verifyTestGate(TARGET_DIR, planHash, diffHash);
    if (!testPassed) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot execute the Review Subagent because the Testing prerequisite is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run all linters and tests via the Testing Subagent first.\n\n' +
            'To proceed:\n' +
            '1. Invoke the Testing Subagent: `invoke_agent(agent_name="testing_agent", prompt="Please run all tests and linters.")`\n' +
            '2. The testing agent must complete successfully and conclude with the standard success marker to generate `test-approval.json`.\n' +
            '3. Once testing is verified, you will be authorized to execute the Review Subagent.',
          systemMessage: '🔒 Security Block: Testing must be approved before review.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
