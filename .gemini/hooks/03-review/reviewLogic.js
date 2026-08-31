import fs from 'fs';
import path from 'path';
import { saveReport } from '../../../agent-scripts/after-invoke.js';
import { calculateDiffHash, findLatestActivePlan, verifyPlanGate } from '../../../agent-scripts/gating.js';
import { runPreReviewTests } from '../../../agent-scripts/testing.js';
import { resolveTargetDir } from '../../../agent-scripts/workspace.js';
import { allow, deny } from '../shared.js';

const TARGET_DIR = resolveTargetDir();
const LOGS_DIR = path.join(TARGET_DIR, 'logs');
const REVIEW_APPROVAL_FILE = path.join(TARGET_DIR, 'review-approval.json');

export function revokeReviewState() {
  try {
    if (fs.existsSync(REVIEW_APPROVAL_FILE)) {
      fs.unlinkSync(REVIEW_APPROVAL_FILE);
    }
  } catch (err) {
    console.warn(`Warning: Failed to revoke review state. Error: ${err.message || err}`);
  }
  const flagFile = path.join(TARGET_DIR, 'require-ask-user.flag');
  try {
    if (fs.existsSync(flagFile)) {
      fs.unlinkSync(flagFile);
    }
  } catch (err) {
    console.warn(`Warning: Failed to delete require-ask-user.flag. Error: ${err.message || err}`);
  }
}

export function verifyPlanning() {
  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    deny(
      'Gate 2 (Review Gate) Pre-Review Test Intercept',
      'You cannot execute pre-review testing because Gate 1 (Planning Gate) is missing or invalid!',
      'Please obtain planning approval from the developer first by calling the `ask_user` tool with intent = "plan approval" containing your TOML payload.',
    );
  }
}

export function preReviewTesting(tool_input) {
  const result = runPreReviewTests();
  if (result.success) {
    const modifiedToolInput = tool_input;
    const activePlan = findLatestActivePlan(TARGET_DIR);
    if (activePlan && fs.existsSync(activePlan)) {
      const planContent = fs.readFileSync(activePlan, 'utf-8');
      modifiedToolInput.prompt = (modifiedToolInput.prompt || '') + '\n\n### ACTIVE PLAN CONTEXT ###\n' + planContent;
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
    revokeReviewState();
    deny(
      'Gate 2 (Review Gate) Pre-Review Testing Intercept',
      `Pre-review testing failed. Issues detected:\n\n${result.failureOutput}`,
      'Please fix the failing tests in your IDE, verify they pass locally, and then re-run pre-review testing to invoke the review agent.',
    );
  }
}

export function afterInvoke(inputData) {
  const { tool_name, tool_input, tool_response } = inputData;

  if (tool_name !== 'invoke_agent' || !tool_input || tool_input.agent_name !== 'project_manager') {
    allow('afterInvoke', 'Execution allowed, tool is not invoke_agent or agent is not project_manager.');
  }

  if (!tool_response || !tool_response.llmContent) {
    console.error('🔒 Hook Error: Sub-agent response is missing, empty, or unparsable.');
    revokeReviewState();
    deny(
      'Gate 2 (Review Gate) Verification',
      'The project_manager returned an empty response or did not output report content.',
      'Please re-run the project_manager to perform the code review.',
    );
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
    deny(
      'Gate 2 (Review Gate) Verification',
      'The project_manager returned an empty or unparsable report.',
      'Please re-run the project_manager to perform the code review.',
    );
  }

  saveReport('project_manager', report, LOGS_DIR);

  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    revokeReviewState();
    deny(
      'Gate 2 (Review Gate) Verification',
      'Gate 1 (Planning Gate) is missing or invalid! You cannot verify a review without an active planning approval.',
      'Please obtain plan approval from the developer first by executing exit_plan_mode.',
    );
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
    revokeReviewState();
    deny(
      'Gate 2 (Review Gate) Verification',
      `The project manager's report is incomplete. It is missing explicit checks for: ${missingTopics.join(', ')}.`,
      'Please explicitly instruct the project manager to perform these checks and re-run the project_manager to proceed.',
    );
  }

  const hasCheckedPasses =
    /- \[[xX]\] Pass 1/i.test(report) &&
    /- \[[xX]\] Pass 2/i.test(report) &&
    /- \[[xX]\] Pass 3/i.test(report) &&
    /- \[[xX]\] Pass 4/i.test(report);

  if (!hasCheckedPasses) {
    revokeReviewState();
    deny(
      'Gate 2 (Review Gate) Verification',
      "The project manager's passes are incomplete or unchecked.",
      'All 4 sequential passes must be checked as complete (e.g. - [x] Pass 1, - [x] Pass 2, etc.) in the report checklist to proceed.',
    );
  }

  const hasCleanMarker = /0 comments\/findings|0 findings/i.test(report);
  const hasPerfectMarker = /PR Review Status:\s*🟢\s*PERFECT|STATUS:\s*APPROVED/i.test(report);
  const isPerfect = hasCleanMarker || hasPerfectMarker;
  const hasComments =
    reportLower.includes('finding') ||
    reportLower.includes('issue') ||
    reportLower.includes('suggestion') ||
    reportLower.includes('comment');

  if (!isPerfect) {
    revokeReviewState();
    let sysMsg = 'The project manager did not approve the changes but provided no explicit comments.';
    let nextSteps = 'Please re-run the project_manager.';
    if (hasComments) {
      sysMsg = 'The project manager found issues and did not approve the changes.';
      nextSteps =
        'Please review the comments and findings from the project_manager, implement the necessary fixes, and then re-run the project_manager.';
    }
    deny('Gate 2 (Review Gate) Verification', sysMsg, nextSteps);
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

    // Extract suggested commit message from the report using a backreference to match quotes resiliently
    const commitMsgMatch = report.match(/Commit Message:\s*(["'`])(.*?)\1/i) || report.match(/Commit Message:\s*(.*)/i);
    const suggestedCommitMessage = commitMsgMatch
      ? (commitMsgMatch[2] !== undefined ? commitMsgMatch[2] : commitMsgMatch[1]).trim()
      : '';

    fs.writeFileSync(
      REVIEW_APPROVAL_FILE,
      JSON.stringify(
        {
          status: 'approved',
          plan_hash: planHash,
          diff_hash: diffHash,
          suggested_commit_message: suggestedCommitMessage,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o400 },
    );

    const stateFile = path.join(TARGET_DIR, 'phase-state.json');
    let state = { currentPhase: 'commit' };
    try {
      if (fs.existsSync(stateFile)) {
        const fileContent = fs.readFileSync(stateFile, 'utf-8').trim();
        if (fileContent) {
          try {
            const parsed = JSON.parse(fileContent);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              state = parsed;
            }
          } catch (parseErr) {
            console.warn(
              `Warning: phase-state.json was corrupted or invalid JSON. Resetting to default. Error: ${parseErr.message}`,
            );
          }
        }
      }
      state.currentPhase = 'commit';
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`Warning: Failed to update phase state to commit. Error: ${err.message || err}`);
    }

    fs.writeFileSync(path.join(TARGET_DIR, 'require-ask-user.flag'), 'true', 'utf-8');
  }

  allow(
    'afterInvoke',
    'Gate 2 (Review) Cryptographically Signed. Multi-pass review successful. 👉 ACTION REQUIRED: You must now move to the Commit Phase by calling the ask_user tool to request commit approval.',
  );
}
