#!/usr/bin/env node
//
// Hook: before-ask-user.js
// Description: Executes BeforeTool on ask_user. Programmatically enforces sequential gate checks
//              before allowing the main agent to ask for developer commit/push approval (Gate 4).
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
const REVIEW_APPROVAL_FILE = path.join(TARGET_DIR, 'review-approval.json');

// Calculate SHA-256 hash of a file's content
function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

// Calculate active local diff hash securely (staged + unstaged combined)
function calculateDiffHash() {
  try {
    const diff = execSync('git diff HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return crypto.createHash('sha256').update(diff).digest('hex');
  } catch (err) {
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

    if (planFiles.length === 0) return null;

    planFiles.sort((a, b) => b.mtime - a.mtime);
    return planFiles[0].path;
  } catch (err) {
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

    if (content.status !== 'approved') return null;

    const token = content.challenge_token;
    if (!token) return null;

    const calculatedHash = crypto.createHash('sha256').update(token).digest('hex');
    if (calculatedHash !== challenge.challenge_hash) return null;

    const activePlan = findLatestActivePlan();
    if (!activePlan) return null;

    const currentPlanHash = calculateFileHash(activePlan);
    if (content.plan_hash !== currentPlanHash) return null;

    return content.plan_hash;
  } catch (err) {
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
    if (content.status !== 'approved') return false;

    if (content.plan_hash !== expectedPlanHash) return false;

    const activeDiffHash = calculateDiffHash();
    if (content.diff_hash !== activeDiffHash) return false;

    return true;
  } catch (err) {
    return false;
  }
}

// Verify Gate 3: Review Gate
function verifyReviewGate(expectedDiffHash, expectedPlanHash) {
  if (!fs.existsSync(REVIEW_APPROVAL_FILE)) {
    return false;
  }

  try {
    const content = JSON.parse(fs.readFileSync(REVIEW_APPROVAL_FILE, 'utf-8'));
    if (content.status !== 'approved') return false;

    if (content.plan_hash !== expectedPlanHash) return false;
    if (content.diff_hash !== expectedDiffHash) return false;

    return true;
  } catch (err) {
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

  // We only inspect ask_user tool executions
  if (tool_name !== 'ask_user' || !tool_input) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const isCommitAsk =
    JSON.stringify(tool_input).includes('commit') ||
    JSON.stringify(tool_input).includes('GPG') ||
    JSON.stringify(tool_input).includes('Push') ||
    JSON.stringify(tool_input).includes('Gate 4');

  if (isCommitAsk) {
    // --- Enforce Gates 1, 2, and 3 sequentially ---
    const planHash = verifyPlanGate();
    if (!planHash) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 4) because Gate 1 (Planning Gate) is missing or invalid!\n\n' +
            'Please obtain planning approval from the developer first.',
          systemMessage: '🔒 Security Block: Gate 1 must be approved before commit.',
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
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 4) because Gate 2 (Testing Gate) is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run the Testing Subagent first:\n' +
            '   `invoke_agent(agent_name="testing_agent", prompt="Please run all tests and linters.")`',
          systemMessage: '🔒 Security Block: Gate 2 must be approved before commit.',
        }),
      );
      process.exit(0);
    }

    const reviewPassed = verifyReviewGate(calculateDiffHash(), planHash);
    if (!reviewPassed) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot ask for Developer Commit Approval (Gate 4) because Gate 3 (Review Gate) is missing or invalid!\n\n' +
            'In accordance with our zero-trust pipeline, you MUST successfully run the Review Subagent first:\n' +
            '   `invoke_agent(agent_name="review_agent", prompt="Please review my current changes.")`',
          systemMessage: '🔒 Security Block: Gate 3 must be approved before commit.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
