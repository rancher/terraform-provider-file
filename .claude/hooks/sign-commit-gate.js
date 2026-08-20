#!/usr/bin/env node
//
// Hook: sign-commit-gate.js
// Description: PostToolUse controller for AskUserQuestion. When the question is a
//              Gate 4 commit approval ask and the developer answered affirmatively,
//              this hook delegates to the shared, tool-agnostic
//              agent-scripts/after-ask.js#handleCommitApproval (unmodified) to
//              trigger the real Touch ID / Secure Enclave signature and then
//              automatically run the existing commit-push.sh / create-pr.sh skills.
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { handleCommitApproval } from '../../agent-scripts/after-ask.js';
import { getStateDir } from './lib/state-dir.js';

const TARGET_DIR = getStateDir();
const PUB_KEY_FILE = path.resolve(os.homedir(), '.claude/age-key.pub');
const PRIV_KEY_FILE = path.resolve(os.homedir(), '.claude/age-key.txt');

function extractAnswerText(toolResponse) {
  if (!toolResponse) {
    return '';
  }
  try {
    if (toolResponse.answers) {
      return String(Object.values(toolResponse.answers)[0] || '');
    }
    const values = Object.values(toolResponse);
    return String(values[0] || '');
  } catch {
    return String(toolResponse);
  }
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const { tool_name: toolName, tool_input: toolInput, tool_response: toolResponse } = inputData;

  if (toolName !== 'AskUserQuestion' || !toolInput) {
    process.exit(0);
  }

  const rawInput = JSON.stringify(toolInput);
  const isCommitAsk = /Commit Message:\s*(?:"[^"]+"|`[^`]+`)/i.test(rawInput);
  if (!isCommitAsk) {
    process.exit(0);
  }

  const answerText = extractAnswerText(toolResponse).trim().toLowerCase();
  const isApproved = /^(y|yes|approve|looks good)(\b|[!.])/i.test(answerText);
  if (!isApproved) {
    process.exit(0);
  }

  if (!fs.existsSync(PUB_KEY_FILE) || !fs.existsSync(PRIV_KEY_FILE)) {
    console.error(
      '🔒 Hook Notification: Cryptographic commit signing skipped — age key pair not found at ' +
        '~/.claude/age-key.pub / ~/.claude/age-key.txt.',
    );
    process.exit(0);
  }

  let promptText = '';
  try {
    const question = toolInput.questions && toolInput.questions[0];
    promptText = (question && question.question) || rawInput;
  } catch {
    promptText = rawInput;
  }

  process.env.AGENT_STATE_DIR = TARGET_DIR;

  // handleCommitApproval prints its own decision JSON, signs the commit, and then
  // runs commit-push.sh / create-pr.sh directly — it always calls process.exit()
  // itself on both the success and failure paths.
  handleCommitApproval(TARGET_DIR, PUB_KEY_FILE, PRIV_KEY_FILE, promptText);
}

main();
