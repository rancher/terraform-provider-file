import fs from 'fs';
import os from 'os';
import path from 'path';
import * as core from '@actions/core';
import { findLatestActivePlan, validatePlanContent } from '../../../agent-scripts/tools/plan.js';
import { handlePlanApproval } from '../../../agent-scripts/tools/approval.js';
import { deleteFileSafe } from '../../../agent-scripts/tools/file.js';
import { allow, deny, getPhase, hasValidSigningKey, parseToolResponse, validateAskUser } from '../shared.js';

async function inPlanPhase(targetDir) {
  const phaseResult = await getPhase(targetDir);
  return phaseResult && phaseResult.success && phaseResult.data === 'plan';
}

export async function beforeAskUserPlan(inputData, targetDir) {
  const { tool_name, tool_input } = inputData;
  const hookName = 'beforeAskUserPlan';

  validateAskUser(hookName, tool_name, tool_input);

  // Attempt to read plan-metadata.json asynchronously and fail-safe
  const metadataPath = path.join(targetDir, 'plan-metadata.json');
  let metadataContent = null;
  try {
    metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      deny(
        'Gate 1 (Planning Gate) File Validation',
        `Failed to read plan-metadata.json: ${err.message}`,
        'Ensure plan-metadata.json is readable.',
      );
    } else {
      core.debug(`[Plan Gate] Optional plan-metadata.json not found: ${err.message}`);
    }
  }

  if (metadataContent === null) {
    // Optional metadata file not present, meaning this is a standard clarification question!
    allow(hookName, tool_name);
  }

  if (metadataContent !== null) {
    let tomlData;
    try {
      tomlData = JSON.parse(metadataContent);
    } catch (err) {
      deny(
        'Gate 1 (Planning Gate) Format Validation',
        `plan-metadata.json is not valid JSON: ${err.message}`,
        'Ensure plan-metadata.json contains a valid, correctly formatted JSON object.',
      );
    }

    if (!tomlData.intent || typeof tomlData.intent !== 'string') {
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        "The 'intent' field inside plan-metadata.json is required.",
        "Include a valid 'intent' string (e.g. 'plan approval') inside plan-metadata.json.",
      );
    }
    if (!tomlData.request || typeof tomlData.request !== 'string') {
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        "The 'request' field inside plan-metadata.json is required.",
        "Include a valid 'request' string inside plan-metadata.json.",
      );
    }

    const intent = tomlData.intent.trim().toLowerCase();

    // If the agent is trying to request plan approval but we aren't in the plan phase, explicitly deny and guide them
    if (intent === 'plan approval' && !(await inPlanPhase(targetDir))) {
      const phaseRes = await getPhase(targetDir);
      const currentPhase = phaseRes && phaseRes.success ? phaseRes.data : 'unknown';
      deny(
        'Gate 1 (Planning Gate) Phase Validation',
        `You are attempting to request plan approval, but the workspace is currently in the "${currentPhase}" phase.`,
        "To request plan approval, the workspace must be in the 'plan' phase.\n" +
          `If you need to re-verify or change your plan, run the state CLI to fix:\n` +
          '`node agent-scripts/tools/state.js set-phase plan`\n' +
          'Once you reset the phase-state, re-run the `ask_user` tool with intent = "plan approval".',
      );
    }

    if (intent !== 'plan approval') {
      allow(hookName, tool_name);
    }

    // Validate specific fields inside plan-metadata.json (enforcing structured tasks schema!)
    if (!tomlData.plan || typeof tomlData.plan !== 'object' || Array.isArray(tomlData.plan)) {
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        "For plan approval intent, the 'plan' field must strictly be a JSON object inside plan-metadata.json.",
        'Ensure your JSON payload has the format: "plan": { "tasks": ["task 1", "task 2"] }',
      );
    }

    const tasks = tomlData.plan.tasks;
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        "The 'plan' object must strictly contain a non-empty 'tasks' array inside plan-metadata.json.",
        'Ensure your JSON payload has the format: "plan": { "tasks": ["task 1", "task 2"] }',
      );
    }

    const allStrings = tasks.every((t) => typeof t === 'string' && t.trim() !== '');
    if (!allStrings) {
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        "All elements inside the 'tasks' array must be non-empty strings.",
        "Ensure your 'tasks' array contains only valid, descriptive task strings.",
      );
    }

    // Verify the plan is valid before allowing ask_user to prompt the user
    const activePlan = await findLatestActivePlan(targetDir);
    if (!activePlan) {
      deny(
        'Gate 1 (Planning Gate) Pipeline Verification',
        'Active plan file not found in session directory!',
        'Please write your plan file as a TOML document under plans/ first before calling `ask_user` with the intent to validate.',
      );
    }

    const validation = await validatePlanContent(activePlan);
    if (!validation.valid) {
      const errorsList = validation.errors.map((err) => `  - ${err}`).join('\n');
      deny(
        'Gate 1 (Planning Gate) Schema Validation',
        'The proposed plan has invalid structure and violates repository standards:\n' + errorsList,
        `You must rewrite the plan file at:\n   ${activePlan}\nto satisfy all repository requirements (include comprehensive tests, quality gates, agentic framework maintenance, and documentation updates) before you can ask the user for approval.`,
      );
    }

    // Programmatically reformat the JSON payload into a beautiful human-readable presentation!
    const planTasksLines = tasks.map((t) => `- [ ] ${t.trim()}`);
    const planContent = `# Plan\n\n${planTasksLines.join('\n')}`;

    const formattedQuestion = `### 🚀 Developer Plan Approval Request (Gate 1)

I have drafted a plan for our implementation. Do you cryptographically approve this plan so that I can exit Plan Mode and begin writing the code?

**Proposed Plan:**
\`\`\`toml
${planContent}
\`\`\`

Do you cryptographically approve this plan?`;

    const modifiedInput = { ...tool_input };
    if (modifiedInput.questions && Array.isArray(modifiedInput.questions) && modifiedInput.questions.length > 0) {
      modifiedInput.questions[0].question = formattedQuestion;
    } else if (modifiedInput.question !== undefined) {
      modifiedInput.question = formattedQuestion;
    } else if (modifiedInput.prompt !== undefined) {
      modifiedInput.prompt = formattedQuestion;
    }

    console.error('\n' + formattedQuestion + '\n');

    console.log(
      JSON.stringify({
        decision: 'allow',
        tool_input: modifiedInput,
        systemMessage:
          '🟢 Pre-Planning Phase: Programmatically reformatted the strict JSON payload into a beautiful human-readable presentation.',
      }),
    );
    process.exit(0);
  }
}

export async function afterAskUserPlan(inputData, targetDir) {
  const { tool_name, tool_input, tool_response } = inputData;
  const hookName = 'afterAskUserPlan';

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

  validateAskUser(hookName, tool_name, tool_input);

  // Attempt to read plan-metadata.json asynchronously and fail-safe
  const metadataPath = path.join(targetDir, 'plan-metadata.json');
  let metadataContent = null;
  try {
    metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      deny(
        'Gate 1 (Planning Gate) File Validation',
        `Failed to read plan-metadata.json: ${err.message}`,
        'Ensure plan-metadata.json is present in the session directory and fully readable before requesting plan approval.',
      );
    } else {
      core.debug(`[Plan Gate] Optional plan-metadata.json not found on afterAskUser: ${err.message}`);
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
      'Gate 1 (Planning Gate) Format Validation',
      `plan-metadata.json is not valid JSON: ${err.message}`,
      'Ensure plan-metadata.json contains a valid, correctly formatted JSON object.',
    );
  }

  const intent = tomlData && tomlData.intent ? tomlData.intent.trim().toLowerCase() : '';

  // If the agent is trying to approve plan but we aren't in the plan phase, explicitly deny and guide them
  if (intent === 'plan approval' && !(await inPlanPhase(targetDir))) {
    const phaseRes = await getPhase(targetDir);
    const currentPhase = phaseRes && phaseRes.success ? phaseRes.data : 'unknown';
    deny(
      'Gate 1 (Planning Gate) Phase Validation',
      `You are attempting to approve the plan, but the workspace is currently in the "${currentPhase}" phase.`,
      "To approve the plan, the workspace must be in the 'plan' phase. Run the state CLI to fix: `node agent-scripts/tools/state.js set-phase plan`",
    );
  }

  if (intent !== 'plan approval') {
    allow(hookName, tool_name);
  }

  // Use the robust response parser from shared.js
  const answerText = parseToolResponse(tool_response);
  const isApproved =
    String(answerText || '')
      .trim()
      .toLowerCase() === 'yes';

  if (!isApproved) {
    deny(
      hookName,
      "User did not approve plan, they must select the 'yes' response.",
      "Ask the user what they would like to change or inform them that they must choose the 'Yes' option when asked to validate the plan and try again.",
    );
  }

  if (!hasValidSigningKey()) {
    deny(
      'Gate 1 (Planning Gate) Cryptographic Setup',
      'SSH key signing is not configured properly or your SSH agent is offline.',
      'To fail-forward and fix this instantly, run the following troubleshooting commands in your local shell:\n\n' +
        '  eval "$(ssh-agent -s)"\n' +
        '  ssh-add ~/.gemini/ssh-key\n\n' +
        'For detailed setup guidance, please see the developer setup documentation: docs/development/tutorials/GettingStarted.toml',
    );
  }

  const homeDir = os.homedir();
  const sshPubKeyFile = path.resolve(homeDir, '.gemini/ssh-key.pub');
  const tasks = tomlData.plan && tomlData.plan.tasks;
  if (!tasks || !Array.isArray(tasks)) {
    deny(
      'Gate 1 (Planning Gate) Schema Validation',
      "The 'plan' object must strictly contain a 'tasks' array inside plan-metadata.json.",
      'Ensure your JSON payload has the format: "plan": { "tasks": ["task 1", "task 2"] }',
    );
  }
  const planTasksLines = tasks.map((t) => `- [ ] ${t.trim()}`);
  const planContent = `# Plan\n\n${planTasksLines.join('\n')}`;
  try {
    const result = await handlePlanApproval(targetDir, sshPubKeyFile, planContent);
    try {
      await deleteFileSafe(metadataPath);
    } catch (cleanErr) {
      core.debug(`[Plan Gate] Failed to clean up plan-metadata.json: ${cleanErr.message}`);
    }
    allow(
      hookName,
      tool_name,
      tool_input,
      '',
      '\n\n' + (result ? result.systemMessage : '') + ' You may now call exit_plan_mode.',
    );
  } catch (err) {
    deny('Gate 1 (Planning Gate) Execution', err.message, 'Please address the error and run ask_user again.');
  }
}
