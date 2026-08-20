#!/usr/bin/env node
//
// Hook: enforce-blueprint.js
// Description: PreToolUse controller for Edit/Write. Gate-1 backstop: blocks source
//              file edits until an active blueprint document exists under
//              docs/development/. Reuses the shared, tool-agnostic
//              agent-scripts/planning.js#checkActivePlan (unmodified).
//

import fs from 'fs';
import path from 'path';
import { checkActivePlan } from '../../agent-scripts/planning.js';

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const { tool_name: toolName, tool_input: toolInput, cwd } = inputData;

  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
  }

  const filePath = toolInput && (toolInput.file_path || toolInput.path);
  if (!filePath) {
    process.exit(0);
  }

  // Anti-Bypass Guardrail: Unconditionally deny any manual writing, editing, or spoofing
  // of any gate signature/challenge files, regardless of location (matches .gemini/hooks/enforce-planning.js).
  if (/(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age)$/.test(filePath)) {
    console.error(
      'Security Policy Violation: Manually writing, editing, or spoofing gate approval/challenge files is strictly prohibited.\n\n' +
        'Gating files must ONLY be generated automatically and securely by our pipeline hooks and sub-agents.',
    );
    process.exit(2);
  }

  const resolvedPath = path.resolve(cwd || process.cwd(), filePath);
  const relativePath = path.relative(cwd || process.cwd(), resolvedPath).replace(/\\/g, '/');
  const homeDir = process.env.HOME || '/tmp';

  const isAllowlisted =
    relativePath.startsWith('.claude/') ||
    relativePath.startsWith('.gemini/') ||
    relativePath === 'CLAUDE.md' ||
    relativePath === 'AGENTS.md' ||
    relativePath === 'GEMINI.md' ||
    resolvedPath.startsWith(path.join(homeDir, '.claude')) ||
    resolvedPath.startsWith(path.join(homeDir, '.gemini'));

  if (isAllowlisted) {
    process.exit(0);
  }

  if (!checkActivePlan(cwd)) {
    console.error(
      'Security Policy Violation: Modifying source code is strictly prohibited without an active plan.\n\n' +
        "In accordance with Phase 2 of 'docs/development/AgenticFramework/DevelopmentProcess.md', you MUST " +
        'first create or update a blueprint under docs/development/ before editing source files.\n\n' +
        'To proceed:\n' +
        '1. Enter plan mode, draft the blueprint, and get it approved via ExitPlanMode (this writes the ' +
        'blueprint to docs/development/ and signs Gate 1 automatically).\n' +
        '2. Once the blueprint file is visible in git status, you will be authorized to modify source files.',
    );
    process.exit(2);
  }

  process.exit(0);
}

main();
