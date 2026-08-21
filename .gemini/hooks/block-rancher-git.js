#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
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
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = inputData;

  // We only inspect run_shell_command execution
  if (tool_name !== 'run_shell_command' || !tool_input || !tool_input.command) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const command = tool_input.command;

  // Real-Time Signature Invalidation Guard
  const homeDir = os.homedir();
  const targetDir = resolveTargetDir(cwd, homeDir);
  const planHash = verifyPlanGate(targetDir);
  const diffHash = calculateDiffHash();
  if (planHash && diffHash) {
    checkAndRevokeStaleGates(targetDir, diffHash, planHash);
  }

  // Unconditional block on direct manual git commit or push or calling the commit-push helper script by the agent
  const isCommitOrPush =
    /\bgit\s+(commit|push)\b/.test(command) || /commit-push-helper\.sh|commit-push-helper/i.test(command);
  if (isCommitOrPush) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          '🔒 Security Policy Violation: Direct manual git commit/push commands or direct execution of the commit-push helper scripts are strictly prohibited in the agent workspace.\n\n' +
          'All commits and pushes must only be triggered automatically and securely by the system hooks after complete cryptographic verification of the 6-phase gated pipeline.',
        systemMessage: '🔒 Security Block: Commit/push operations are prohibited.',
      }),
    );
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

  // If in research phase, block any mutating git commands (like reset, checkout, branch creation, merge, etc.)
  // We only allow git status, git diff, git log, git show, etc. (read-only git operations)
  const isMutatingGit = /\bgit\s+(checkout|switch|reset|clean|merge|rebase|branch|rm)\b/.test(command);
  if (currentPhase === 'research' && isMutatingGit) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          '🔒 Security Policy Violation: Mutating git operations are strictly prohibited during the RESEARCH phase.\n\n' +
          'All research modifications must be ephemeral. Git tree mutations are only permitted starting in the PLAN phase.',
        systemMessage: '🔒 Security Block: Git mutations are blocked in Research phase.',
      }),
    );
    process.exit(0);
  }

  // Verify command using the shared security check
  const result = verifyGitCommand(command, cwd);
  console.log(JSON.stringify(result));
  process.exit(0);
}

main();
