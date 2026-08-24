#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleCommitApproval } from '../../agent-scripts/after-ask.js';
import {
    calculateDiffHash,
    checkAndRevokeStaleGates,
    verifyPlanGate,
    verifyReviewGate,
} from '../../agent-scripts/gating.js';
import { resolveTargetDir } from '../../agent-scripts/workspace.js';

function preCommitPhaseInterruption(inputData, targetDir) {
  const flagFile = path.join(targetDir, 'require-ask-user.flag');

  if (fs.existsSync(flagFile)) {
    if (inputData.tool_name !== 'ask_user') {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: The review phase has completed successfully. All tools are blocked until you present the changes to the user for commit approval.\n\n' +
            'Please call the `ask_user` tool to request commit approval.',
          systemMessage: '🔒 Security Block: Call the `ask_user` tool to proceed to the Commit Phase.',
        }),
      );
      process.exit(0);
    }

    // Present the suggested commit message from the review agent
    let suggestedCommitMessage = 'chore: automated development commit';
    try {
      const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
      if (fs.existsSync(reviewApprovalFile)) {
        const approvalData = JSON.parse(fs.readFileSync(reviewApprovalFile, 'utf-8'));
        if (approvalData.suggested_commit_message) {
          suggestedCommitMessage = approvalData.suggested_commit_message;
        }
      }
    } catch (err) {
      console.warn('Failed to retrieve suggested commit message from review approval:', err.message);
    }

    const modifiedInput = inputData.tool_input || {};
    const reviewContext = `\n\n### 🔍 AUTOMATED REVIEW COMPLETE 🔍 ###\nThe review agent has verified the changes and formulated the following commit message:\n\nCommit Message: \`${suggestedCommitMessage}\`\n\nPlease review the code changes in your IDE. Do you approve these changes for commit? (Yes/No)`;

    // Strip any raw "Commit Message:" directives the main agent might have formulated to avoid collision/parse issues
    const replaceCommitMsg = (str) =>
      typeof str === 'string' ? str.replace(/Commit Message/gi, 'Proposed Message') : str;

    if (modifiedInput.questions && Array.isArray(modifiedInput.questions) && modifiedInput.questions.length > 0) {
      modifiedInput.questions[0].question = replaceCommitMsg(modifiedInput.questions[0].question) + reviewContext;
    } else if (modifiedInput.question !== undefined) {
      modifiedInput.question = replaceCommitMsg(modifiedInput.question) + reviewContext;
    } else if (modifiedInput.prompt !== undefined) {
      modifiedInput.prompt = replaceCommitMsg(modifiedInput.prompt) + reviewContext;
    } else {
      modifiedInput.question = reviewContext;
    }

    console.log(
      JSON.stringify({
        decision: 'allow',
        tool_input: modifiedInput,
        systemMessage: '🟢 Pre-Commit Phase: Appended review agent commit message to the user prompt.',
      }),
    );
    process.exit(0);
  }
}

function beforeAskUser(inputData, targetDir) {
  const { tool_name, tool_input } = inputData;

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
    const planHash = verifyPlanGate(targetDir);
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

    checkAndRevokeStaleGates(targetDir, diffHash, planHash);

    const reviewPassed = verifyReviewGate(targetDir, diffHash, planHash);
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

function afterAskUser(inputData, targetDir) {
  const { tool_name, tool_input, tool_response } = inputData;

  if (tool_name !== 'ask_user' || !tool_input || !tool_response) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const FLAG_FILE = path.join(targetDir, 'require-ask-user.flag');
  if (fs.existsSync(FLAG_FILE)) {
    try {
      fs.unlinkSync(FLAG_FILE);
    } catch (err) {
      console.warn(`Warning: Failed to delete require-ask-user.flag. Error: ${err.message || err}`);
    }
  }

  let answerText = '';
  try {
    if (tool_response.answers) {
      answerText = Object.values(tool_response.answers)[0] || '';
    } else if (tool_response.llmContent) {
      const parsed = JSON.parse(tool_response.llmContent);
      if (parsed && parsed.answers) {
        answerText = Object.values(parsed.answers)[0] || '';
      } else {
        answerText = Object.values(parsed)[0] || '';
      }
    } else {
      answerText = Object.values(tool_response)[0] || '';
    }
  } catch {
    answerText = tool_response.llmContent || JSON.stringify(tool_response);
  }

  const safeAnswerText = String(answerText || '');
  const isApproved =
    safeAnswerText.toLowerCase() === 'yes' ||
    safeAnswerText.toLowerCase() === 'y' ||
    safeAnswerText.toLowerCase() === 'approve' ||
    safeAnswerText.toLowerCase() === 'approve plan' ||
    safeAnswerText.toLowerCase() === 'approve commit' ||
    safeAnswerText.toLowerCase() === 'looks good';

  const safeToolInput = JSON.stringify(tool_input);
  const isCommitAsk =
    /\bcommit\b/i.test(safeToolInput) || safeToolInput.includes('GPG') || safeToolInput.includes('Push');

  if (!isApproved) {
    if (isCommitAsk) {
      const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
      if (fs.existsSync(reviewApprovalFile)) {
        try {
          fs.unlinkSync(reviewApprovalFile);
          console.error('❌ Gate 3 Revoked: User rejected the commit. Review approval has been deleted.');
        } catch (err) {
          console.warn(`Warning: Failed to unlink review approval file. Error: ${err.message || err}`);
        }
      }
    }
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const homeDir = os.homedir();
  const sshPubKeyFile = path.resolve(homeDir, '.gemini/ssh-key.pub');

  if (!fs.existsSync(sshPubKeyFile)) {
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage:
          '🔒 Hook Notification: Cryptographic signing skipped because your SSH public key is not found at ~/.gemini/ssh-key.pub. Please copy or link your Touch ID SSH public key to this location.',
      }),
    );
    process.exit(0);
  }

  const promptText = tool_input.questions && tool_input.questions[0] ? tool_input.questions[0].question : '';

  if (isCommitAsk) {
    handleCommitApproval(targetDir, sshPubKeyFile, promptText);
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
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

  const targetDir = resolveTargetDir();
  const args = process.argv.slice(2);

  if (args.includes('--before-ask')) {
    beforeAskUser(inputData, targetDir);
  } else if (args.includes('--after-ask')) {
    afterAskUser(inputData, targetDir);
  } else {
    preCommitPhaseInterruption(inputData, targetDir);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }
}

main();
