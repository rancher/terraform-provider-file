import fs from 'fs';
import path from 'path';
import { verifyPlanGate, healApprovalState } from '../../../agent-scripts/tools/approval.js';
import { setLock, setPhase, getLock } from '../../../agent-scripts/tools/state.js';
import { allow, deny } from '../shared.js';
import { gitBranchShowCurrent, executeGit } from '../../../agent-scripts/tools/git.js';

export async function clearPrePlanFlag(targetDir) {
  const hookName = 'clearPrePlanFlag';
  await setPhase(targetDir, 'plan');
  await setLock(targetDir, false);
  await healApprovalState(targetDir, 'all');

  allow(
    hookName,
    '✨ You have successfully entered Plan Phase. All tools are now unlocked for planning. 👉 ACTION REQUIRED: Draft your plan and then use `ask_user` to request approval.',
  );
}

export async function beforeExitPlanMode(inputData, targetDir) {
  // BeforeTool hook for exit_plan_mode
  const hookName = 'beforeExitPlanMode';
  const tool_name = 'exit_plan_mode';

  if (inputData.tool_name !== 'exit_plan_mode') {
    allow(hookName, inputData.tool_name, inputData.tool_input);
  }

  // 1. Validate that plan-metadata.json exists and is valid
  const metadataPath = path.join(targetDir, 'plan-metadata.json');
  let metadataContent = null;
  try {
    metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (err) {
    deny(
      'Gate 1 (Planning Gate) Exit Validation',
      `plan-metadata.json is missing or could not be read: ${err.message}`,
      'You must write plan-metadata.json using write-plan.js before exiting Plan Mode.',
    );
  }

  let jsonData;
  try {
    jsonData = JSON.parse(metadataContent);
  } catch (err) {
    deny(
      'Gate 1 (Planning Gate) Exit Validation',
      `plan-metadata.json is not valid JSON: ${err.message}`,
      'Ensure plan-metadata.json contains a valid JSON payload.',
    );
  }

  if (
    !jsonData.plan ||
    !jsonData.plan.tasks ||
    !Array.isArray(jsonData.plan.tasks) ||
    jsonData.plan.tasks.length === 0
  ) {
    deny(
      'Gate 1 (Planning Gate) Exit Validation',
      "The 'plan' object inside plan-metadata.json must strictly contain a non-empty 'tasks' array.",
      'Ensure your plan contains at least one task before requesting approval.',
    );
  }

  // 2. Validate that the plan was presented to and approved by the user (cryptographically verified)
  const planHash = await verifyPlanGate(targetDir);
  if (!planHash) {
    deny(
      'Gate 1 (Planning Gate) Exit',
      'You cannot exit Plan Mode until the user has cryptographically approved the plan.',
      'Present your plan file under plans/ to the user using the `ask_user` tool with intent = "plan approval" and plan = "markdown contents..." to obtain cryptographic plan approval. Only after the user approves will you be permitted to exit Plan Mode.',
    );
  }

  allow(hookName, tool_name, inputData.tool_input);
}

export async function afterExitPlanMode(inputData, targetDir) {
  // AfterTool hook for exit_plan_mode
  if (inputData.tool_name !== 'exit_plan_mode') {
    allow('afterExitPlanMode', inputData.tool_name);
  }

  try {
    const isLocked = await getLock(targetDir);
    if (isLocked) {
      console.error('::warning::Git operations are currently locked by another process.');
    } else {
      await setLock(targetDir, true);
      (async () => {
        try {
          const branchName = await gitBranchShowCurrent(targetDir);
          if (branchName === 'main') {
            console.error('::notice::Currently on main branch. Syncing main and creating a new branch...');
            await executeGit(['pull', 'origin', 'main'], targetDir);
            const newBranch = `wip-feature-${Date.now()}`;
            const safeBranch = newBranch.replace(/[^a-zA-Z0-9-]/g, '');
            await executeGit(['checkout', '-b', safeBranch], targetDir);
            console.error(`::notice::🟢 Successfully branched from main to new branch: ${safeBranch}`);
          }
        } catch (err) {
          console.error(`::warning::Failed to automatically branch from main: ${err.message}`);
        } finally {
          await setLock(targetDir, false);
        }
      })();
    }
  } catch (err) {
    console.error(`::warning::Failed to initiate background branching: ${err.message}`);
  }

  await setPhase(targetDir, 'implement');

  // Clean up plan-metadata.json after exit_plan_mode succeeds
  const metadataPath = path.join(targetDir, 'plan-metadata.json');
  try {
    const fs = await import('fs');
    if (fs.existsSync(metadataPath)) {
      await fs.promises.unlink(metadataPath);
    }
  } catch (cleanErr) {
    console.error('Failed to clean up plan-metadata.json after exit_plan_mode:', cleanErr.message);
  }

  allow(
    'afterExitPlanMode',
    '✅ Exited Plan Mode. Implementation phase successfully unlocked! 👉 ACTION REQUIRED: Proceed immediately to Implement your plan, then move to the Review Phase by running the code-review.js script.',
  );
}
