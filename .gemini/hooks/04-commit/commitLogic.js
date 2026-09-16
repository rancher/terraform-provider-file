import fs from 'fs';
import os from 'os';
import path from 'path';
import * as core from '@actions/core';
import { writeFileSafe, deleteFileSafe } from '../../../agent-scripts/tools/file.js';
import { calculateDiffHash } from '../../../agent-scripts/tools/git.js';
import { readState, setLock } from '../../../agent-scripts/tools/state.js';
import {
  checkAndRevokeStaleGates,
  handleCommitApproval,
  readApprovalData,
  revokeSignature,
  verifyPlanGate,
  verifyReviewGate,
} from '../../../agent-scripts/tools/approval.js';
import { allow, deny, getPhase, hasValidSigningKey, parseToolResponse, validateAskUser } from '../shared.js';

async function inPlanMode(targetDir) {
  const phaseResult = await getPhase(targetDir);
  return phaseResult && phaseResult.success && phaseResult.data === 'plan';
}

export async function revokeReviewState(targetDir) {
  await revokeSignature(targetDir, 'review-approval.json');
  console.error('❌ Gate 2 (Review) Revoked: User rejected the commit. Review approval has been deleted.');
}

export async function preCommitPhaseInterruption(inputData, targetDir) {
  const state = (await readState(targetDir)) || {};
  const locked = state.locked || false;
  const keyTool = state.keyTool || '';

  if (locked && keyTool === 'ask_user') {
    if (inputData.tool_name !== 'ask_user') {
      deny(
        'Gate 3 (Commit Gate) Intercept',
        'The review phase has completed successfully. All tools are strictly blocked until you present the changes to the user for commit approval.',
        'Please call the `ask_user` tool to request commit approval and proceed.',
      );
    }

    // Present the suggested commit message from the review agent
    let suggestedCommitMessage = 'chore: automated development commit';
    const reviewMsg = await readApprovalData(targetDir, 'review-approval.json', 'suggested_commit_message');
    if (reviewMsg) {
      suggestedCommitMessage = reviewMsg;
    }

    const modifiedInput = inputData.tool_input || {};
    const reviewContext = `\n\n# ### 🔍 AUTOMATED REVIEW COMPLETE 🔍 ###\n# The review agent has verified the changes and formulated the following commit message:\n# \n# Commit Message: \`${suggestedCommitMessage}\`\n# \n# Please review the code changes in your IDE. Do you approve these changes for commit? (Yes/No)`;

    // Strip any raw "Commit Message:" directives the main agent might have formulated to avoid collision/parse issues
    const replaceCommitMsg = (str) =>
      typeof str === 'string' ? str.replace(/Commit Message/gi, 'Proposed Message') : str;

    if (modifiedInput.questions && Array.isArray(modifiedInput.questions) && modifiedInput.questions.length > 0) {
      modifiedInput.questions[0].question = replaceCommitMsg(modifiedInput.questions[0].question) + reviewContext;
    } else if (modifiedInput.question !== void 0) {
      modifiedInput.question = replaceCommitMsg(modifiedInput.question) + reviewContext;
    } else if (modifiedInput.prompt !== void 0) {
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

export async function beforeAskUserCommit(inputData, targetDir) {
  const { tool_name, tool_input } = inputData;
  const hookName = 'beforeAskUserCommit';

  if (tool_name !== 'ask_user' || !tool_input) {
    allow(hookName, tool_name);
  }

  if (await inPlanMode(targetDir)) {
    allow(hookName, tool_name);
  }

  // Attempt to read commit-metadata.json asynchronously and fail-safe
  const metadataPath = path.join(targetDir, 'commit-metadata.json');
  let metadataContent = null;
  try {
    metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      deny(
        'Gate 3 (Commit Gate) File Validation',
        `Failed to read commit-metadata.json: ${err.message}`,
        'Ensure commit-metadata.json is readable.',
      );
    } else {
      core.debug(`[Commit Gate] Optional commit-metadata.json not found: ${err.message}`);
    }
  }

  if (metadataContent !== null) {
    let metadata;
    try {
      metadata = JSON.parse(metadataContent);
    } catch (err) {
      deny(
        'Gate 3 (Commit Gate) Format Validation',
        `commit-metadata.json is not valid JSON: ${err.message}`,
        'Ensure commit-metadata.json is formatted as a valid JSON object.',
      );
    }

    if (!metadata.intent || typeof metadata.intent !== 'string') {
      deny(
        'Gate 3 (Commit Gate) Schema Validation',
        "The 'intent' field inside commit-metadata.json is required.",
        "Include a valid 'intent' string (e.g. 'commit approval') inside commit-metadata.json.",
      );
    }
    if (!metadata.request || typeof metadata.request !== 'string') {
      deny(
        'Gate 3 (Commit Gate) Schema Validation',
        "The 'request' field inside commit-metadata.json is required.",
        "Include a valid 'request' string inside commit-metadata.json.",
      );
    }

    const intent = metadata.intent.trim().toLowerCase();
    if (intent === 'commit approval') {
      // Validate specific fields inside commit-metadata.json
      if (!metadata.hash || typeof metadata.hash !== 'string') {
        deny(
          'Gate 3 (Commit Gate) Schema Validation',
          "The 'hash' field inside commit-metadata.json is required.",
          "Include a valid 'hash' string in commit-metadata.json.",
        );
      }
      if (!metadata['commit-message'] || typeof metadata['commit-message'] !== 'string') {
        deny(
          'Gate 3 (Commit Gate) Schema Validation',
          "The 'commit-message' field inside commit-metadata.json is required.",
          "Include a valid 'commit-message' string in commit-metadata.json.",
        );
      }
      if (!metadata['pr-description'] || typeof metadata['pr-description'] !== 'string') {
        deny(
          'Gate 3 (Commit Gate) Schema Validation',
          "The 'pr-description' field inside commit-metadata.json is required.",
          "Include a valid 'pr-description' string in commit-metadata.json.",
        );
      }

      const planHash = await verifyPlanGate(targetDir);
      if (!planHash) {
        deny(
          'Gate 3 (Commit Gate) Pipeline Verification',
          'You cannot ask for Developer Commit Approval (Gate 3) because Gate 1 (Planning Gate) is missing or invalid!',
          'Please obtain planning approval from the developer first by writing plans/ and calling ask_user with intent = "plan approval".',
        );
      }

      const diffHash = await calculateDiffHash();

      // Enforce Cryptographic Binding check!
      if (metadata.hash !== diffHash) {
        deny(
          'Gate 3 (Commit Gate) Cryptographic Binding Violation',
          `The hash inside commit-metadata.json ("${metadata.hash}") does not match the active staged diff hash ("${diffHash}")!`,
          'This means the approved metadata is not bound to your current staged changes. Please re-run our QA review to sign the latest diff first: node agent-scripts/quality-assurance.js',
        );
      }

      await checkAndRevokeStaleGates(targetDir, diffHash, planHash);

      const reviewPassed = await verifyReviewGate(targetDir, diffHash, planHash);
      if (!reviewPassed) {
        deny(
          'Gate 3 (Commit Gate) Quality Verification',
          'You cannot ask for Developer Commit Approval (Gate 3) because the Review prerequisite (Gate 2) is missing or has been invalidated by recent file changes!',
          'Please run the review script first to perform a code review and sign the branch: node agent-scripts/quality-assurance.js',
        );
      }
    }
  }

  // All filters passed, allow the standard human-readable ask_user tool call
  allow(hookName, tool_name);
}

export async function afterAskUserCommit(inputData, targetDir) {
  const { tool_name, tool_input, tool_response } = inputData;
  const hookName = 'afterAskUserCommit';

  if (!tool_name || tool_name !== 'ask_user') {
    allow(hookName, tool_name || 'no-tool-called');
    return;
  }

  if (!tool_input || !tool_response) {
    deny(
      hookName,
      'Incomplete ask_user hook payload (missing input or response)',
      'Ensure tool_input and tool_response are supplied.',
    );
  }

  if (await inPlanMode(targetDir)) {
    allow(hookName, tool_name);
  }

  validateAskUser(hookName, tool_name, tool_input);

  // Attempt to read commit-metadata.json asynchronously and fail-safe
  const metadataPath = path.join(targetDir, 'commit-metadata.json');
  let metadataContent = null;
  try {
    metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      deny(
        'Gate 3 (Commit Gate) File Validation',
        `Failed to read commit-metadata.json: ${err.message}`,
        'Ensure commit-metadata.json is present in the session directory and fully readable before requesting commit approval.',
      );
    } else {
      core.debug(`[Commit Gate] Optional commit-metadata.json not found on afterAskUser: ${err.message}`);
    }
  }

  if (metadataContent === null) {
    // Optional metadata file not present, meaning this is a standard clarification question!
    allow(hookName, tool_name);
  }

  let tomlData;
  try {
    tomlData = JSON.parse(metadataContent);
  } catch (err) {
    deny(
      'Gate 3 (Commit Gate) Format Validation',
      `commit-metadata.json is not valid JSON: ${err.message}`,
      'Ensure commit-metadata.json contains a valid, correctly formatted JSON object.',
    );
  }

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
      console.error(
        '🔒 Hook Info: Commit approval declined, but Gate 2 (Review) remains intact as the workspace was not modified.',
      );
    }
    allow(hookName, tool_name);
  }

  if (tomlData && commitIntent === 'commit approval') {
    const commitMsg = tomlData['commit-message'];
    const prDesc = tomlData['pr-description'];

    if (commitMsg) {
      const approvalData = await readApprovalData(targetDir, 'review-approval.json');
      if (approvalData) {
        try {
          approvalData.suggested_commit_message = commitMsg;
          await revokeSignature(targetDir, 'review-approval.json'); // Ensures fresh rewrite over restrictive perms
          const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
          await writeFileSafe(reviewApprovalFile, JSON.stringify(approvalData, null, 2), { mode: 0o400 });
          console.error(`🔒 Hook Info: Updated suggested_commit_message in review-approval.json to: "${commitMsg}"`);
        } catch (err) {
          console.error('🔒 Hook Error: Failed to update review-approval.json with commit-message:', err.message);
        }
      }
    }

    if (prDesc) {
      const prBodyFile = path.join(targetDir, 'pr-body.md');
      try {
        await writeFileSafe(prBodyFile, prDesc);
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

    const planHash = await verifyPlanGate(targetDir);
    const diffHash = await calculateDiffHash();

    // Enforce Cryptographic Binding check!
    if (tomlData.hash !== diffHash) {
      deny(
        'Gate 3 (Commit Gate) Cryptographic Binding Violation',
        `The hash inside commit-metadata.json ("${tomlData.hash}") does not match the active staged diff hash ("${diffHash}")!`,
        'This means the approved metadata is not bound to your current staged changes. Please re-run our QA review to sign the latest diff first: node agent-scripts/quality-assurance.js',
      );
    }

    await checkAndRevokeStaleGates(targetDir, diffHash, planHash);

    const reviewPassed = await verifyReviewGate(targetDir, diffHash, planHash);
    if (!reviewPassed) {
      deny(
        'Gate 3 (Commit Gate) Quality Verification',
        'Your Gate 2 (Review) cryptographic signature is missing, invalid, or has been invalidated by recent file changes!',
        'To resolve this, please re-run our single-pass Quality Assurance script to sign the latest staged changes:\n' +
          '  node agent-scripts/quality-assurance.js\n\n' +
          'Once signed, run your commit approval tool call again.',
      );
    }

    const homeDir = os.homedir();
    const sshPubKeyFile = path.resolve(homeDir, '.gemini/ssh-key.pub');
    try {
      console.error('🔒 Hook Info: Executing cryptographic commit signing and automatic push pipeline...');
      const result = await handleCommitApproval(targetDir, sshPubKeyFile);
      console.error(
        `🔒 Hook Info: Commit successfully signed and pushed. PR URL: ${result ? result.prUrl : 'unknown'}`,
      );
      // Clean up metadata file on successful commit approval to prevent stale reuse!
      try {
        await deleteFileSafe(metadataPath);
      } catch (cleanErr) {
        console.error('🔒 Hook Error: Failed to clean up commit-metadata.json:', cleanErr.message);
      }
      try {
        const state = await readState(targetDir);
        if (state && state.locked && state.keyTool === 'ask_user') {
          await setLock(targetDir, false);
        }
      } catch (lockErr) {
        console.error('🔒 Hook Error: Failed to unlock workspace:', lockErr.message);
      }
      allow(hookName, tool_name, tool_input, '', '\n\n' + (result ? result.systemMessage : ''));
    } catch (err) {
      console.error('🔒 Hook Error: Gate 3 commit/push pipeline failed!');
      console.error(`🔒 Hook Error Message: ${err.message}`);
      if (err.stack) {
        console.error(`🔒 Hook Error Stack: ${err.stack}`);
      }
      deny('Gate 3 (Commit Gate) Execution', err.message, 'Please address the error and run ask_user again.');
    }
  }

  allow(hookName, tool_name);
}
