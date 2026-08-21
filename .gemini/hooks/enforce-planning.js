#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
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
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = inputData;

  // We only inspect write_file and replace
  if (tool_name !== 'write_file' && tool_name !== 'replace') {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const filePath = tool_input.file_path;
  if (!filePath) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Anti-Bypass Guardrail: Unconditionally deny any manual writing, editing, or spoofing of all gate signature/challenge files
  if (/(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age)$/.test(filePath)) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          'Security Policy Violation: Manually writing, editing, or spoofing gate approval/challenge files is strictly prohibited.\n\n' +
          'Gating files must ONLY be generated automatically and securely by our pipeline hooks and sub-agents.',
        systemMessage: '🔒 Security Block: Direct modification of approval files is prohibited.',
      }),
    );
    process.exit(0);
  }

  // Resolve absolute path to check if it's within .gemini/ or .claude/
  const resolvedPath = path.resolve(cwd || process.cwd(), filePath);
  const relativePath = path.relative(cwd || process.cwd(), resolvedPath);
  const relativePathNormalized = relativePath.replace(/\\/g, '/');
  const homeDir = os.homedir();
  const targetDir = resolveTargetDir(cwd, homeDir);

  // If the file is inside the .gemini or .claude directories, we allow writing configurations and plans (.md, .json, .yaml, etc.)
  if (
    relativePathNormalized.startsWith('.gemini/') ||
    relativePathNormalized.startsWith('.claude/') ||
    resolvedPath.startsWith(path.join(homeDir, '.gemini')) ||
    resolvedPath.startsWith(path.join(homeDir, '.claude')) ||
    relativePathNormalized === 'AGENTS.md' ||
    relativePathNormalized === 'GEMINI.md'
  ) {
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
        console.log(
          JSON.stringify({
            decision: 'deny',
            reason:
              '🔒 Security Policy Violation: Creating or modifying execution scripts (.js, .sh, etc.) inside configuration directories without planning approval is strictly prohibited.\n\n' +
              'You are only authorized to write declarative configurations (.json) or blueprints (.md) via bypass.',
            systemMessage: '🔒 Security Block: Script creation blocked in config directories.',
          }),
        );
        process.exit(0);
      }
    }
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Load phase state
  const stateFile = path.join(targetDir, 'phase-state.json');
  let currentPhase = 'research';
  if (fs.existsSync(stateFile)) {
    try {
      currentPhase = JSON.parse(fs.readFileSync(stateFile, 'utf-8')).currentPhase || 'research';
    } catch {}
  }

  // If phase is research, deny editing entirely
  if (currentPhase === 'research') {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          '🔒 Security Policy Violation: Code modifications are strictly blocked during the RESEARCH phase.\n\n' +
          'All research changes must be ephemeral. Please advance to the PLAN phase to begin planning changes.',
        systemMessage: '🔒 Security Block: Source edits are blocked in Research phase.',
      }),
    );
    process.exit(0);
  }

  // If phase is plan, allow editing ONLY under docs/development/ (which contains declarative blueprints)
  if (currentPhase === 'plan') {
    if (!relativePathNormalized.startsWith('docs/development/')) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: Source code modifications are blocked during the PLAN phase.\n\n' +
            'You are only authorized to write declarative blueprints inside `docs/development/`.',
          systemMessage: '🔒 Security Block: Source edits blocked in Plan phase.',
        }),
      );
      process.exit(0);
    }
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // If phase is implement, we check if plan is approved
  if (currentPhase === 'implement') {
    const planHash = verifyPlanGate(targetDir);
    if (!planHash) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            '🔒 Security Policy Violation: You cannot modify source files because the plan cryptographic seal (Gate 1) is missing or invalid!\n\n' +
            'Please request plan approval first.',
          systemMessage: '🔒 Security Block: Gate 1 approval required.',
        }),
      );
      process.exit(0);
    }

    // Continuous Invalidation: delete downstream approvals because we are changing the workspace code!
    const testApproval = path.join(targetDir, 'test-approval.json');
    const reviewApproval = path.join(targetDir, 'review-approval.json');
    const userApproval = path.join(targetDir, 'user-approval.json');

    try {
      if (fs.existsSync(testApproval)) {
        fs.unlinkSync(testApproval);
        console.error('🧹 Invalidation Hook: Stale testing approval deleted because files were modified.');
      }
      if (fs.existsSync(reviewApproval)) {
        fs.unlinkSync(reviewApproval);
        console.error('🧹 Invalidation Hook: Stale review approval deleted because files were modified.');
      }
      if (fs.existsSync(userApproval)) {
        fs.unlinkSync(userApproval);
        console.error('🧹 Invalidation Hook: Stale commit approval deleted because files were modified.');
      }
    } catch (err) {
      console.error('🧹 Invalidation Hook Warning: Failed to clean stale approvals:', err.message);
    }

    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Any other phase (test, review, commit) denies edits
  console.log(
    JSON.stringify({
      decision: 'deny',
      reason: '🔒 Security Policy Violation: Code modifications are strictly blocked in this phase.',
      systemMessage: '🔒 Security Block: Source edits blocked.',
    }),
  );
  process.exit(0);
}

main();
