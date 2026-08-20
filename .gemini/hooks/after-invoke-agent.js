#!/usr/bin/env node
//
// Hook: after-invoke-agent.js
// Description: Securely captures sub-agent execution reports, writes them to disk for developer review,
//              and automatically/securely generates review-approval.json or test-approval.json
//              upon verified success, enforcing the sequential cryptographic pipeline.
//

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifyPlanGate, calculateDiffHash } from '../../agent-scripts/gating.js';
import { saveReport, verifyTestReport, verifyReviewReport } from '../../agent-scripts/after-invoke.js';

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
const LOGS_DIR = path.join(TARGET_DIR, 'logs');

const TEST_APPROVAL_FILE = path.join(TARGET_DIR, 'test-approval.json');
const REVIEW_APPROVAL_FILE = path.join(TARGET_DIR, 'review-approval.json');

function revokeGate(agentName) {
  try {
    if (agentName === 'testing_agent') {
      fs.unlinkSync(TEST_APPROVAL_FILE);
      console.error(
        '❌ Gate 2 Revoked: Stale testing signature deleted because the subagent run failed or was unparsable.',
      );
    } else if (agentName === 'review_agent') {
      fs.unlinkSync(REVIEW_APPROVAL_FILE);
      console.error(
        '❌ Gate 3 Revoked: Stale review signature deleted because the subagent run failed or was unparsable.',
      );
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('🔒 Hook Error: Failed to revoke gate signature:', err.message || err);
    }
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
  if (tool_name !== 'invoke_agent' || !tool_input) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const agentName = tool_input.agent_name;
  const isTargetAgent = agentName === 'review_agent' || agentName === 'testing_agent';

  // If the target subagent finished but returned no response or empty report, actively revoke stale gates!
  if (isTargetAgent && (!tool_response || !tool_response.llmContent)) {
    console.error('🔒 Hook Error: Sub-agent response is missing, empty, or unparsable; revoking stale approvals.');
    revokeGate(agentName);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  if (!isTargetAgent) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  let report = '';
  if (Array.isArray(tool_response.llmContent)) {
    report = tool_response.llmContent.map((item) => item.text || '').join('\n');
  } else if (typeof tool_response.llmContent === 'string') {
    report = tool_response.llmContent;
  }

  if (!report || report.trim() === '') {
    console.error('🔒 Hook Error: Sub-agent report is empty or unparsable; revoking stale approvals.');
    revokeGate(agentName);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // 1. Always save the unedited report using generic modular utility
  saveReport(agentName, report, LOGS_DIR);

  // 2. Chained Gate Validation: Verify Gate 1 exists and is unmodified
  const planHash = verifyPlanGate(TARGET_DIR);
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
    const result = verifyTestReport(report, diffHash, planHash, TEST_APPROVAL_FILE);
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: result.systemMessage,
      }),
    );
    process.exit(0);
  } else if (agentName === 'review_agent') {
    const result = verifyReviewReport(report, diffHash, planHash, REVIEW_APPROVAL_FILE, TEST_APPROVAL_FILE);
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: result.systemMessage,
      }),
    );
    process.exit(0);
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
