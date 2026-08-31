import fs from 'fs';
import path from 'path';
import { verifyPlanGate } from '../../../agent-scripts/gating.js';
import { allow, deny } from '../shared.js';

export function clearPrePlanFlag(targetDir) {
  const hookName = 'clearPrePlanFlag';
  const requirePlanModeFile = path.join(targetDir, 'require-plan-mode.flag');
  if (fs.existsSync(requirePlanModeFile)) {
    try {
      fs.unlinkSync(requirePlanModeFile);
    } catch (err) {
      console.warn(`Warning: Failed to delete require-plan-mode.flag. Error: ${err.message || err}`);
    }
  }

  // Force Plan phase by setting the active planning flag inside phase-state.json
  const stateFile = path.join(targetDir, 'phase-state.json');
  let state = { currentPhase: 'plan' };
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch (err) {
      console.warn(`Warning: Failed to parse ${stateFile}. Error: ${err.message || err}`);
    }
  }
  state.currentPhase = 'plan';
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  allow(
    hookName,
    '✨ You have successfully entered Plan Phase. All tools are now unlocked for planning. 👉 ACTION REQUIRED: Draft your plan and then use `ask_user` to request approval.',
  );
}

export function beforeExitPlanMode(inputData, targetDir) {
  // BeforeTool hook for exit_plan_mode
  const hookName = 'beforeExitPlanMode';
  const tool_name = 'exit_plan_mode';

  if (inputData.tool_name !== 'exit_plan_mode') {
    allow(hookName, inputData.tool_name, inputData.tool_input);
  }

  const planHash = verifyPlanGate(targetDir);
  if (!planHash) {
    deny(
      'Gate 1 (Planning Gate) Exit',
      'You cannot exit Plan Mode until the user has cryptographically approved the plan.',
      'Present your plan file under plans/ to the user using the `ask_user` tool with intent = "plan approval" and plan = "markdown contents..." to obtain cryptographic plan approval. Only after the user approves will you be permitted to exit Plan Mode.',
    );
  }

  allow(hookName, tool_name, inputData.tool_input);
}

export function afterExitPlanMode(inputData, targetDir) {
  // AfterTool hook for exit_plan_mode
  if (inputData.tool_name !== 'exit_plan_mode') {
    allow('afterExitPlanMode', inputData.tool_name);
  }

  // Update phase state to implement inside phase-state.json
  const stateFile = path.join(targetDir, 'phase-state.json');
  let state = { currentPhase: 'implement' };
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch (err) {
      console.error(`🔒 Hook Error: Failed to parse phase-state.json: ${err.message}`);
    }
  }
  state.currentPhase = 'implement';
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  allow(
    'afterExitPlanMode',
    '✅ Exited Plan Mode. Implementation phase successfully unlocked! 👉 ACTION REQUIRED: Proceed immediately to Implement your plan, then move to the Review Phase by invoking the project_manager.',
  );
}
