#!/usr/bin/env node
//
// Hook: before-invoke-agent.js
// Description: Executes BeforeTool on invoke_agent. Programmatically enforces sequential gate checks
//              before allowing the main agent to execute sub-agents, preventing out-of-order execution.
//

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const HOME_DIR = process.env.HOME || '/tmp';
const TARGET_DIR = path.resolve(HOME_DIR, '.gemini/tmp/terraform-provider-file');

const PLAN_APPROVAL_FILE = path.join(TARGET_DIR, 'plan-approval.json');
const PLAN_CHALLENGE_FILE = path.join(TARGET_DIR, 'plan-approval.challenge');

const TEST_APPROVAL_FILE = path.join(TARGET_DIR, 'test-approval.json');

// Calculate SHA-256 hash of a file's content
function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateFileHash failed:', err.message || err);
    return null;
  }
}

// Calculate active local diff hash securely (staged + unstaged combined)
function calculateDiffHash() {
  try {
    const diff = execSync('git diff HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return crypto.createHash('sha256').update(diff).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateDiffHash failed:', err.message || err);
    return null;
  }
}

// Automatically scans the Gemini tmp directories to find the latest active plan file
function findLatestActivePlan() {
  try {
    const activeSessions = fs.readdirSync(TARGET_DIR);
    const planFiles = [];

    for (const session of activeSessions) {
      const plansPath = path.join(TARGET_DIR, session, 'plans');
      if (fs.existsSync(plansPath) && fs.statSync(plansPath).isDirectory()) {
        const files = fs.readdirSync(plansPath);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(plansPath, file);
            planFiles.push({
              path: filePath,
              mtime: fs.statSync(filePath).mtimeMs,
            });
          }
        }
      }
    }

    if (planFiles.length === 0) {
      return null;
    }

    planFiles.sort((a, b) => b.mtime - a.mtime);
    return planFiles[0].path;
  } catch (err) {
    console.error('🔒 Hook Debug: findLatestActivePlan failed:', err.message || err);
    return null;
  }
}

// Verify Gate 1: Plan Gate and return plan_hash
function verifyPlanGate() {
  if (!fs.existsSync(PLAN_APPROVAL_FILE) || !fs.existsSync(PLAN_CHALLENGE_FILE)) {
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(PLAN_APPROVAL_FILE, 'utf-8'));
    const challenge = JSON.parse(fs.readFileSync(PLAN_CHALLENGE_FILE, 'utf-8'));

    if (content.status !== 'approved') {
      return null;
    }

    const token = content.challenge_token;
    if (!token) {
      return null;
    }

    const calculatedHash = crypto.createHash('sha256').update(token).digest('hex');
    if (calculatedHash !== challenge.challenge_hash) {
      return null;
    }

    const activePlan = findLatestActivePlan();
    if (!activePlan) {
      return null;
    }

    const currentPlanHash = calculateFileHash(activePlan);
    if (content.plan_hash !== currentPlanHash) {
      return null;
    }

    return content.plan_hash;
  } catch (err) {
    console.error('🔒 Hook Debug: verifyPlanGate failed:', err.message || err);
    return null;
  }
}

// Verify Gate 2: Test Gate
function verifyTestGate(expectedPlanHash) {
  if (!fs.existsSync(TEST_APPROVAL_FILE)) {
    return false;
  }

  try {
    const content = JSON.parse(fs.readFileSync(TEST_APPROVAL_FILE, 'utf-8'));
    if (content.status !== 'approved') {
      return false;
    }

    if (content.plan_hash !== expectedPlanHash) {
      return false;
    }

    const activeDiffHash = calculateDiffHash();
    if (content.diff_hash !== activeDiffHash) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('🔒 Hook Debug: verifyTestGate failed:', err.message || err);
    return false;
  }
}

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
    const planHash = verifyPlanGate();
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
    // --- Enforce Gates 1 & 2: Plan and Test Approved before Review ---
    const planHash = verifyPlanGate();
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

    const testPassed = verifyTestGate(planHash);
    if (!testPassed) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot execute the Review Subagent because Gate 2 (Testing Gate) is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run all linters and tests via the Testing Subagent first.\n\n' +
            'To proceed:\n' +
            '1. Invoke the Testing Subagent: `invoke_agent(agent_name="testing_agent", prompt="Please run all tests and linters.")`\n' +
            '2. The testing agent must complete successfully and conclude with the standard success marker to generate `test-approval.json`.\n' +
            '3. Once testing is verified, you will be authorized to execute the Review Subagent.',
          systemMessage: '🔒 Security Block: Gate 2 (Testing Gate) must be approved before review.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
