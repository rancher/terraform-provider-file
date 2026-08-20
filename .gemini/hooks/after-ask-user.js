#!/usr/bin/env node
//
// Hook: after-ask-user.js
// Description: Securely captures the user's manual/Touch ID approvals from ask_user and automatically
//              writes the corresponding cryptographic signature JSON file (plan-approval.json or user-approval.json)
//              anchored to the active diff/plan hash. Then automates git commit, push and draft PR creation.
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { handlePlanApproval, handleCommitApproval } from '../../agent-scripts/after-ask.js';

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

const PUB_KEY_FILE = path.resolve(HOME_DIR, '.gemini/age-key.pub');
const PRIV_KEY_FILE = path.resolve(HOME_DIR, '.gemini/age-key.txt');

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

  // We only inspect ask_user tool executions with valid responses
  if (tool_name !== 'ask_user' || !tool_input || !tool_response || !tool_response.llmContent) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Parse response answerText
  let answerText = '';
  try {
    const parsed = JSON.parse(tool_response.llmContent);
    if (parsed && parsed.answers) {
      answerText = Object.values(parsed.answers)[0] || '';
    } else {
      answerText = Object.values(parsed)[0] || '';
    }
  } catch {
    answerText = tool_response.llmContent;
  }

  const safeAnswerText = String(answerText || '');
  const isApproved =
    safeAnswerText.toLowerCase() === 'yes' ||
    safeAnswerText.toLowerCase() === 'y' ||
    safeAnswerText.toLowerCase() === 'approve' ||
    safeAnswerText.toLowerCase() === 'approve plan' ||
    safeAnswerText.toLowerCase() === 'approve commit' ||
    safeAnswerText.toLowerCase() === 'looks good';

  if (!isApproved) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const safeToolInput = JSON.stringify(tool_input);
  const isPlanAsk =
    /\bplan\b/i.test(safeToolInput) || safeToolInput.includes('blueprint') || safeToolInput.includes('Planning');

  const isCommitAsk =
    /\bcommit\b/i.test(safeToolInput) || safeToolInput.includes('GPG') || safeToolInput.includes('Push');

  if (!fs.existsSync(PUB_KEY_FILE) || !fs.existsSync(PRIV_KEY_FILE)) {
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage:
          '🔒 Hook Notification: Cryptographic signing skipped because age public/private key-pair files are not set up at standard paths (~/.gemini/age-key.pub and ~/.gemini/age-key.txt). Please refer to docs/development/AgenticFramework/GatingAndApprovals.md setup guide.',
      }),
    );
    process.exit(0);
  }

  const promptText = tool_input.questions && tool_input.questions[0] ? tool_input.questions[0].question : '';

  if (isPlanAsk) {
    const result = handlePlanApproval(TARGET_DIR, PUB_KEY_FILE, PRIV_KEY_FILE, promptText);
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: result.systemMessage,
      }),
    );
    process.exit(0);
  } else if (isCommitAsk) {
    handleCommitApproval(TARGET_DIR, PUB_KEY_FILE, PRIV_KEY_FILE, promptText);
    // handleCommitApproval automatically calls process.exit(0) upon success or process.exit(1) on failure
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
