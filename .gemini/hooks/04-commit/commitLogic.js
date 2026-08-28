import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleCommitApproval } from '../../../agent-scripts/after-ask.js';
import {
  calculateDiffHash,
  checkAndRevokeStaleGates,
  verifyPlanGate,
  verifyReviewGate,
} from '../../../agent-scripts/gating.js';
import {
  allow,
  deny,
  getPhase,
  getTomlFrom,
  validateAskUser,
  parseToolResponse,
  hasValidSigningKey,
} from '../shared.js';

function inPlanMode(targetDir) {
  const phaseResult = getPhase(targetDir);
  return phaseResult && phaseResult.success && phaseResult.data === 'plan';
}

export function revokeReviewState(targetDir) {
  const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
  try {
    if (fs.existsSync(reviewApprovalFile)) {
      fs.unlinkSync(reviewApprovalFile);
      console.error('❌ Gate 2 (Review) Revoked: User rejected the commit. Review approval has been deleted.');
    }
  } catch (err) {
    console.warn(`Warning: Failed to revoke review state. Error: ${err.message || err}`);
  }
}

export function preCommitPhaseInterruption(inputData, targetDir) {
  const flagFile = path.join(targetDir, 'require-ask-user.flag');

  if (fs.existsSync(flagFile)) {
    if (inputData.tool_name !== 'ask_user') {
      deny(
        'Gate 3 (Commit Gate) Intercept',
        'The review phase has completed successfully. All tools are strictly blocked until you present the changes to the user for commit approval.',
        'Please call the `ask_user` tool to request commit approval and proceed.',
      );
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
    const reviewContext = `\n\n# ### 🔍 AUTOMATED REVIEW COMPLETE 🔍 ###\n# The review agent has verified the changes and formulated the following commit message:\n# \n# Commit Message: \`${suggestedCommitMessage}\`\n# \n# Please review the code changes in your IDE. Do you approve these changes for commit? (Yes/No)`;

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

export function beforeAskUserCommit(inputData, targetDir) {
  const { tool_name, tool_input } = inputData;
  const hookName = 'beforeAskUserCommit';

  if (tool_name !== 'ask_user' || !tool_input) {
    allow(hookName, tool_name);
  }

  if (inPlanMode(targetDir)) {
    allow(hookName, tool_name);
  }

  // Run central TOML validation
  validateAskUser(hookName, tool_name, tool_input);

  const tomlData = getTomlFrom(tool_input);

  const commitIntent = tomlData.intent.trim().toLowerCase();
  const isCommitAsk = commitIntent === 'commit approval';

  const hasCommitFields =
    Object.prototype.hasOwnProperty.call(tomlData, 'hash') ||
    Object.prototype.hasOwnProperty.call(tomlData, 'commit-message') ||
    Object.prototype.hasOwnProperty.call(tomlData, 'pr-description');
  if (hasCommitFields && !isCommitAsk) {
    deny(
      'Gate 3 (Commit Gate) Intent Validation',
      `The TOML payload contains commit-specific fields, but the intent is set to "${tomlData.intent}".`,
      'To request commit approval, you must set intent = "commit approval" in your TOML payload.',
    );
  }

  if (!isCommitAsk) {
    allow(hookName, tool_name);
  }

  // Validate specific fields
  if (!tomlData.hash || typeof tomlData.hash !== 'string') {
    deny(
      'Gate 3 (Commit Gate) Schema Validation',
      "For commit approval intent, the string 'hash' field containing the review phase diff hash is required.",
      "Include the 'hash' field in your TOML with the exact diff SHA-256 hash calculated from the review phase.",
    );
  }
  if (!tomlData['commit-message'] || typeof tomlData['commit-message'] !== 'string') {
    deny(
      'Gate 3 (Commit Gate) Schema Validation',
      "For commit approval intent, the string 'commit-message' field containing the approved commit message is required.",
      "Include the 'commit-message' field in your TOML with the exact conventional commit message to use for the automated commit.",
    );
  }
  if (!tomlData['pr-description'] || typeof tomlData['pr-description'] !== 'string') {
    deny(
      'Gate 3 (Commit Gate) Schema Validation',
      "For commit approval intent, the string 'pr-description' field containing the pull request description is required.",
      "Include the 'pr-description' field in your TOML with the detailed description/body to use when programmatically opening the Pull Request.",
    );
  }

  const planHash = verifyPlanGate(targetDir);
  if (!planHash) {
    deny(
      'Gate 3 (Commit Gate) Pipeline Verification',
      'You cannot ask for Developer Commit Approval (Gate 3) because Gate 1 (Planning Gate) is missing or invalid!',
      'Please obtain planning approval from the developer first by writing plans/ and calling ask_user with intent = "plan approval".',
    );
  }

  const diffHash = calculateDiffHash();

  checkAndRevokeStaleGates(targetDir, diffHash, planHash);

  const reviewPassed = verifyReviewGate(targetDir, diffHash, planHash);
  if (!reviewPassed) {
    deny(
      'Gate 3 (Commit Gate) Quality Verification',
      'You cannot ask for Developer Commit Approval (Gate 3) because the Review prerequisite (Gate 2) is missing or has been invalidated by recent file changes!',
      'Please run the Review Subagent first to perform a code review and sign the branch: invoke_agent(agent_name="review_agent", prompt="Please review my changes.")',
    );
  }

  allow(hookName, tool_name);
}

export function afterAskUserCommit(inputData, targetDir) {
  const { tool_name, tool_input, tool_response } = inputData;
  const hookName = 'afterAskUserCommit';

  if (tool_name !== 'ask_user' || !tool_input || !tool_response) {
    allow(hookName, tool_name);
  }

  if (inPlanMode(targetDir)) {
    allow(hookName, tool_name);
  }

  const FLAG_FILE = path.join(targetDir, 'require-ask-user.flag');
  if (fs.existsSync(FLAG_FILE)) {
    try {
      fs.unlinkSync(FLAG_FILE);
    } catch (err) {
      console.warn(`Warning: Failed to delete require-ask-user.flag. Error: ${err.message || err}`);
    }
  }

  validateAskUser(hookName, tool_name, tool_input);
  const tomlData = getTomlFrom(tool_input);

  const commitIntent = tomlData && tomlData.intent ? tomlData.intent.trim().toLowerCase() : '';
  const isCommitAsk = commitIntent === 'commit approval';

  if (!isCommitAsk) {
    allow(hookName, tool_name);
  }

  // Use the robust response parser from shared.js
  const answerText = parseToolResponse(tool_response);

  const isApproved =
    String(answerText || '')
      .trim()
      .toLowerCase() === 'yes';

  if (!isApproved) {
    if (isCommitAsk) {
      revokeReviewState(targetDir);
    }
    allow(hookName, tool_name);
  }

  if (tomlData && commitIntent === 'commit approval') {
    const commitMsg = tomlData['commit-message'];
    const prDesc = tomlData['pr-description'];

    if (commitMsg) {
      const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
      if (fs.existsSync(reviewApprovalFile)) {
        try {
          const approvalData = JSON.parse(fs.readFileSync(reviewApprovalFile, 'utf-8'));
          approvalData.suggested_commit_message = commitMsg;
          fs.chmodSync(reviewApprovalFile, 0o600);
          fs.writeFileSync(reviewApprovalFile, JSON.stringify(approvalData, null, 2));
          fs.chmodSync(reviewApprovalFile, 0o400);
          console.error(`🔒 Hook Info: Updated suggested_commit_message in review-approval.json to: "${commitMsg}"`);
        } catch (err) {
          console.error('🔒 Hook Error: Failed to update review-approval.json with commit-message:', err.message);
        }
      }
    }

    if (prDesc) {
      const prBodyFile = path.join(targetDir, 'pr-body.md');
      try {
        fs.mkdirSync(path.dirname(prBodyFile), { recursive: true });
        fs.writeFileSync(prBodyFile, prDesc);
        console.error(`🔒 Hook Info: Wrote PR description to ${prBodyFile}`);
      } catch (err) {
        console.error('🔒 Hook Error: Failed to write pr-body.md:', err.message);
      }
    }
  }

  if (isCommitAsk) {
    if (!hasValidSigningKey()) {
      deny(
        'Gate 3 (Commit Gate) Cryptographic Setup',
        'SSH key signing is not configured properly or your SSH agent is offline.',
        'To resolve this, please perform the following setup steps:\n' +
          '1. Ensure your SSH agent is running: eval "$(ssh-agent -s)"\n' +
          '2. Generate an SSH key if you do not have one under ~/.gemini/:\n' +
          '   ssh-keygen -t ed25519 -f ~/.gemini/ssh-key -C "gemini-signing-key"\n' +
          '3. Add your SSH key to the active ssh-agent:\n' +
          '   ssh-add ~/.gemini/ssh-key\n' +
          '4. Ensure your public key exists and is readable at ~/.gemini/ssh-key.pub.\n\n' +
          'Once configured, re-run the `ask_user` tool with intent = "commit approval".',
      );
    }

    const planHash = verifyPlanGate(targetDir);
    const diffHash = calculateDiffHash();
    checkAndRevokeStaleGates(targetDir, diffHash, planHash);

    const reviewPassed = verifyReviewGate(targetDir, diffHash, planHash);
    if (!reviewPassed) {
      allow(hookName, tool_name);
    }

    const homeDir = os.homedir();
    const sshPubKeyFile = path.resolve(homeDir, '.gemini/ssh-key.pub');
    const promptText = tomlData['commit-message'] || '';
    handleCommitApproval(targetDir, sshPubKeyFile, promptText);
  }

  allow(hookName, tool_name);
}
