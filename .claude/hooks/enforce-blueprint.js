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
import { execSync } from 'child_process';
import { checkActivePlan } from '../../agent-scripts/planning.js';
import { verifyPlanGate } from '../../agent-scripts/gating.js';

function resolveTargetDir(cwd, homeDir) {
  let repoName = 'generic-repo';
  try {
    const topLevel = execSync('git rev-parse --show-toplevel', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    repoName = path.basename(topLevel);
  } catch {
    repoName = path.basename(cwd || process.cwd()) || 'generic-repo';
  }
  return path.resolve(homeDir, '.gemini/tmp', repoName);
}

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
  const targetDir = resolveTargetDir(cwd, homeDir);

  const isAllowlisted =
    relativePath.startsWith('.claude/') ||
    relativePath.startsWith('.gemini/') ||
    relativePath === 'CLAUDE.md' ||
    relativePath === 'AGENTS.md' ||
    relativePath === 'GEMINI.md' ||
    resolvedPath.startsWith(path.join(homeDir, '.claude')) ||
    resolvedPath.startsWith(path.join(homeDir, '.gemini'));

  if (isAllowlisted) {
    if (/\.(js|mjs|sh|py|bash|ts)$/i.test(filePath)) {
      // Load phase state to check if we are authorized under implement phase
      const stateFile = path.join(targetDir, 'phase-state.json');
      let currentPhase = 'research';
      if (fs.existsSync(stateFile)) {
        try {
          currentPhase = JSON.parse(fs.readFileSync(stateFile, 'utf-8')).currentPhase || 'research';
        } catch {}
      }
      const planHash = verifyPlanGate(targetDir);
      if (currentPhase !== 'implement' || !planHash) {
        console.error(
          '🔒 Security Policy Violation: Creating or modifying execution scripts (.js, .sh, etc.) inside configuration directories without planning approval is strictly prohibited.\n\n' +
            'You are only authorized to write declarative configurations (.json) or blueprints (.md) via bypass.',
        );
        process.exit(2);
      }
    }
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
