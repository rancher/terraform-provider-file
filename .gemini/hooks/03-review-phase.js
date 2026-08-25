#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { saveReport } from '../../agent-scripts/after-invoke.js';
import { calculateDiffHash, findLatestActivePlan, verifyPlanGate } from '../../agent-scripts/gating.js';
import { runPreReviewTests } from '../../agent-scripts/testing.js';
import { resolveTargetDir } from '../../agent-scripts/workspace.js';

const TARGET_DIR = resolveTargetDir();
const LOGS_DIR = path.join(TARGET_DIR, 'logs');
const REVIEW_APPROVAL_FILE = path.join(TARGET_DIR, 'review-approval.json');

function verifyPlanning() {
  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          '🔒 Security Policy Violation: You cannot execute pre-review testing because Gate 1 (Planning Gate) is missing or invalid!\n\n' +
          'Please obtain planning approval from the developer first by executing `exit_plan_mode`.',
        systemMessage: '🔒 Security Block: Gate 1 must be approved before testing/review.',
      }),
    );
    process.exit(0);
  }
}

function preReviewTesting(tool_input) {
  const result = runPreReviewTests();
  if (result.success) {
    const modifiedToolInput = tool_input;
    const activePlan = findLatestActivePlan(TARGET_DIR);
    let planHash = '';
    if (activePlan && fs.existsSync(activePlan)) {
      const planContent = fs.readFileSync(activePlan, 'utf-8');
      modifiedToolInput.prompt = (modifiedToolInput.prompt || '') + '\n\n### ACTIVE PLAN CONTEXT ###\n' + planContent;
      planHash = verifyPlanGate(TARGET_DIR) || '';
    }

    const diffHash = calculateDiffHash();
    if (planHash && diffHash) {
      const testApprovalFile = path.join(TARGET_DIR, 'test-approval.json');
      try {
        fs.unlinkSync(testApprovalFile);
      } catch {
        // Ignored
      }
      fs.writeFileSync(
        testApprovalFile,
        JSON.stringify(
          {
            status: 'approved',
            plan_hash: planHash,
            diff_hash: diffHash,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o400 },
      );
    }

    console.log(
      JSON.stringify({
        decision: 'allow',
        tool_input: modifiedToolInput,
        systemMessage: '🟢 Pre-Review Testing Passed. Starting review agent with active plan context.',
      }),
    );
    process.exit(0);
  } else {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason: `Pre-review testing failed. Please fix the following issues before invoking the review agent:\n\n${result.failureOutput}`,
        systemMessage: '🔒 Review blocked: Automated tests failed.',
      }),
    );
    process.exit(0);
  }
}

function revokeReviewState() {
  try {
    if (fs.existsSync(REVIEW_APPROVAL_FILE)) {
      fs.unlinkSync(REVIEW_APPROVAL_FILE);
      console.error('🔒 Security Action: Revoked review approval due to invalid subagent output.');
    }
  } catch (err) {
    console.warn(`Warning: Failed to unlink review approval file. Error: ${err.message || err}`);
  }

  const flagFile = path.join(TARGET_DIR, 'require-ask-user.flag');
  try {
    if (fs.existsSync(flagFile)) {
      fs.unlinkSync(flagFile);
      console.error('🔒 Security Action: Deleted require-ask-user.flag due to invalid subagent output.');
    }
  } catch (err) {
    console.warn(`Warning: Failed to delete require-ask-user.flag. Error: ${err.message || err}`);
  }
}

function afterInvoke(inputData) {
  const { tool_name, tool_input, tool_response } = inputData;

  if (tool_name !== 'invoke_agent' || !tool_input || tool_input.agent_name !== 'review_agent') {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  if (!tool_response || !tool_response.llmContent) {
    console.error('🔒 Hook Error: Sub-agent response is missing, empty, or unparsable.');
    revokeReviewState();
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
    console.error('🔒 Hook Error: Sub-agent report is empty or unparsable.');
    revokeReviewState();
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  saveReport('review_agent', report, LOGS_DIR);

  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: `🔒 Hook Notification: Sub-agent review_agent finished but no signature was written because Gate 1 (Planning Gate) is missing or invalid.`,
      }),
    );
    process.exit(0);
  }

  const reportLower = report.toLowerCase();
  const requiredTopics = [
    'pass 1',
    'pass 2',
    'pass 3',
    'security',
    'standard',
    'performance',
    'logic',
    'error handling',
    'concurrency',
    'edge cases',
    'maintainability',
    'testability',
    'commit title',
    'commit message',
  ];
  const missingTopics = requiredTopics.filter((topic) => !reportLower.includes(topic));

  if (missingTopics.length > 0) {
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: `⚠️ Review Verification Failed: The review agent's report is incomplete. It is missing explicit checks for: ${missingTopics.join(', ')}.\n\nPlease explicitly instruct the review agent to perform these checks to proceed.`,
      }),
    );
    process.exit(0);
  }

  const diffHash = calculateDiffHash();
  if (planHash && diffHash) {
    try {
      fs.unlinkSync(REVIEW_APPROVAL_FILE);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Warning: Failed to unlink review approval file. Error: ${err.message || err}`);
      }
    }

    fs.writeFileSync(
      REVIEW_APPROVAL_FILE,
      JSON.stringify(
        {
          status: 'approved',
          plan_hash: planHash,
          diff_hash: diffHash,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o400 },
    );

    fs.writeFileSync(path.join(TARGET_DIR, 'require-ask-user.flag'), 'true', 'utf-8');
  }

  console.log(
    JSON.stringify({
      decision: 'allow',
      systemMessage: '🟢 Gate 3 (Review) Cryptographically Signed. Multi-pass review successful.',
    }),
  );
  process.exit(0);
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON in 03-review-phase:', err.message || err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const args = process.argv.slice(2);

  if (args.includes('--after-invoke')) {
    afterInvoke(inputData);
  } else {
    const { tool_name, tool_input } = inputData;

    // Proceed only if the target is the review agent being invoked
    if (tool_name !== 'invoke_agent' || !tool_input || tool_input.agent_name !== 'review_agent') {
      console.log(JSON.stringify({ decision: 'allow' }));
      process.exit(0);
    }

    verifyPlanning();
    preReviewTesting(tool_input);
  }
}

main();
