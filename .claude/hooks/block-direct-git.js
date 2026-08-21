#!/usr/bin/env node
//
// Hook: block-direct-git.js
// Description: PreToolUse controller for the Bash tool. Adapts Claude Code's hook
//              I/O contract to the shared, tool-agnostic `verifyGitCommand` check
//              in agent-scripts/security.js (unmodified, reused by both the Gemini
//              and Claude integrations).
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { verifyGitCommand } from '../../agent-scripts/security.js';
import { verifyPlanGate, calculateDiffHash, checkAndRevokeStaleGates } from '../../agent-scripts/gating.js';

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

  if (toolName !== 'Bash' || !toolInput || !toolInput.command) {
    process.exit(0);
  }

  const command = toolInput.command;

  // Real-Time Signature Invalidation Guard
  const homeDir = os.homedir();
  const targetDir = resolveTargetDir(cwd, homeDir);
  const planHash = verifyPlanGate(targetDir);
  const diffHash = calculateDiffHash();
  if (planHash && diffHash) {
    checkAndRevokeStaleGates(targetDir, diffHash, planHash);
  }

  const result = verifyGitCommand(command, cwd);

  if (result.decision === 'deny') {
    console.error(result.reason || 'Security Policy Violation: command blocked.');
    process.exit(2);
  }

  process.exit(0);
}

main();
