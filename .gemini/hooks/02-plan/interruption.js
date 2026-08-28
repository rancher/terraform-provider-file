import fs from 'fs';
import path from 'path';
import { allow, deny } from '../shared.js';

export function prePlanPhaseInterruption(inputData, targetDir) {
  const requirePlanModeFile = path.join(targetDir, 'require-plan-mode.flag');
  if (fs.existsSync(requirePlanModeFile)) {
    if (inputData.tool_name !== 'enter_plan_mode') {
      deny(
        'Gate 1 (Planning Gate) Intercept',
        'A plan has not been accepted yet. All tools are strictly blocked until you enter the Plan Phase.',
        'Please call the `enter_plan_mode` tool first to formally transition the workflow into the Plan Phase before utilizing other tools.',
      );
    }
  }

  allow('prePlanPhaseInterruption', 'prePlanPhaseInterruption check complete, execution allowed.');
}

export function verifyGateArtifactProtection(inputData) {
  const { tool_name, tool_input } = inputData;

  if (
    tool_name === 'write_file' ||
    tool_name === 'replace' ||
    tool_name === 'edit_file' ||
    tool_name === 'create_file'
  ) {
    if (tool_input) {
      const filePath = tool_input.file_path || tool_input.path || '';
      const fileName = path.basename(filePath);

      const isApprovalFile =
        /^(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age|sig)$/.test(fileName) ||
        fileName.endsWith('-approval.json') ||
        fileName.endsWith('.sig');

      if (isApprovalFile) {
        deny(
          'Gate Tamper Intercept',
          'Direct creation or modification of gate approvals or signature files is strictly prohibited. Bypassing enforcer checks violates security policies.',
          'Gating approval and signature files must ONLY be generated automatically and securely by our pipeline hooks and sub-agents. Never attempt to manually create or edit signature files.',
        );
      }
    }
  }
}
