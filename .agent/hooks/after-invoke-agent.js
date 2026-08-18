#!/usr/bin/env node
//
// Hook: after-invoke-agent.js
// Description: Securely captures sub-agent execution reports, writes them to disk for developer review,
//              and automatically/securely generates review-approval.json or test-approval.json
//              upon verified success, enforcing the sequential cryptographic pipeline.
//

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const HOME_DIR = process.env.HOME || '/tmp';
const TARGET_DIR = path.resolve(HOME_DIR, '.gemini/tmp/terraform-provider-file');
const LOGS_DIR = path.join(TARGET_DIR, 'logs');

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

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input, tool_response } = inputData;

  // We only inspect invoke_agent tool executions
  if (tool_name !== 'invoke_agent' || !tool_input || !tool_response || !tool_response.llmContent) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const agentName = tool_input.agent_name;
  if (agentName !== 'review_agent' && agentName !== 'testing_agent') {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  let report = '';
  if (Array.isArray(tool_response.llmContent)) {
    report = tool_response.llmContent.map((item) => item.text || '').join('\n');
  } else if (typeof tool_response.llmContent === 'string') {
    report = tool_response.llmContent;
  }

  // 1. Always write the unedited markdown report to disk for developer review
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const reportFile = path.join(LOGS_DIR, `${agentName}_report.md`);
    try {
      fs.unlinkSync(reportFile);
    } catch (e) {}
    fs.writeFileSync(reportFile, report, { mode: 0o600 });
  } catch (err) {
    console.error(`🔒 Hook Error: Failed to write sub-agent report for ${agentName}:`, err.message);
  }

  // 2. Chained Gate Validation: Verify Gate 1 exists and is unmodified
  const planHash = verifyPlanGate();
  if (!planHash) {
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: `🔒 Hook Notification: Sub-agent ${agentName} finished but no signature was written because Gate 1 (Planning Gate) is missing or invalid.`,
      }),
    );
    process.exit(0);
  }

  const diffHash = calculateDiffHash();
  if (!diffHash) {
    console.error('🔒 Hook Error: Failed to compute git diff hash.');
    process.exit(1);
  }

  // 3. Process Sub-Agent Approvals
  if (agentName === 'testing_agent') {
    const isSuccess = report.includes('TEST RUN status: 🟢 SUCCESS');
    const targetFile = TEST_APPROVAL_FILE;

    if (isSuccess) {
      const approvalData = {
        status: 'approved',
        diff_hash: diffHash,
        plan_hash: planHash,
        timestamp: new Date().toISOString(),
      };

      try {
        try {
          fs.unlinkSync(targetFile);
        } catch (e) {}
        fs.writeFileSync(targetFile, JSON.stringify(approvalData, null, 2), { mode: 0o600 });
        console.log(
          JSON.stringify({
            decision: 'allow',
            systemMessage:
              '✅ Gate 2 Approved: Testing sub-agent report verified. Gate 2 signature successfully written and chained!',
          }),
        );
        process.exit(0);
      } catch (err) {
        console.error('🔒 Hook Error: Failed to write Gate 2 signature:', err.message);
        process.exit(1);
      }
    } else {
      // Self-Healing: Revoke existing signature if tests failed
      try {
        fs.unlinkSync(targetFile);
      } catch (e) {}
      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage:
            '❌ Gate 2 Rejected: Testing sub-agent reported failures. Gate 2 signature revoked/missing. Report saved to ~/.gemini/tmp/terraform-provider-file/logs/testing_agent_report.md',
        }),
      );
      process.exit(0);
    }
  } else if (agentName === 'review_agent') {
    const isSuccess = report.includes('PR Review status: 🟢 PERFECT - 0 findings.');
    const targetFile = REVIEW_APPROVAL_FILE;

    if (isSuccess) {
      // Hook enforces Gate 2 must also be valid! (Review requires Tests to be passed)
      if (!fs.existsSync(TEST_APPROVAL_FILE)) {
        console.log(
          JSON.stringify({
            decision: 'allow',
            systemMessage:
              '🔒 Hook Notification: Review agent completed with 0 findings, but Gate 3 (Review Gate) cannot be signed because Gate 2 (Testing Gate) is missing!',
          }),
        );
        process.exit(0);
      }

      const testContent = JSON.parse(fs.readFileSync(TEST_APPROVAL_FILE, 'utf-8'));
      if (testContent.diff_hash !== diffHash || testContent.plan_hash !== planHash) {
        console.log(
          JSON.stringify({
            decision: 'allow',
            systemMessage:
              '🔒 Hook Notification: Review agent completed with 0 findings, but Gate 3 cannot be signed because the current diff/plan does not match Gate 2 (Testing Gate).',
          }),
        );
        process.exit(0);
      }

      const approvalData = {
        status: 'approved',
        message: 'PR Review status: 🟢 PERFECT - 0 findings.',
        commit_sha: execSync('git rev-parse HEAD 2>/dev/null || echo "unknown"', {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim(),
        diff_hash: diffHash,
        plan_hash: planHash,
        timestamp: new Date().toISOString(),
      };

      try {
        try {
          fs.unlinkSync(targetFile);
        } catch (e) {}
        fs.writeFileSync(targetFile, JSON.stringify(approvalData, null, 2), { mode: 0o600 });
        console.log(
          JSON.stringify({
            decision: 'allow',
            systemMessage:
              '✅ Gate 3 Approved: Review sub-agent report verified. Gate 3 signature successfully written and chained!',
          }),
        );
        process.exit(0);
      } catch (err) {
        console.error('🔒 Hook Error: Failed to write Gate 3 signature:', err.message);
        process.exit(1);
      }
    } else {
      // Self-Healing: Revoke existing signature if review failed
      try {
        fs.unlinkSync(targetFile);
      } catch (e) {}
      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage:
            '❌ Gate 3 Rejected: Review sub-agent reported violations. Gate 3 signature revoked/missing. Report saved to ~/.gemini/tmp/terraform-provider-file/logs/review_agent_report.md',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
