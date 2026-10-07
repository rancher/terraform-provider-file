#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const originalWrite = process.stdout.write;
console.log = () => {};
console.info = () => {};
console.debug = () => {};
console.warn = () => {};
process.stdout.write = function (chunk, encoding, callback) {
  const cb = typeof encoding === 'function' ? encoding : callback;
  if (typeof cb === 'function') {
    cb();
  }
  return true;
};

function outputResult(obj) {
  originalWrite.call(process.stdout, JSON.stringify(obj) + '\n');
}

/**
 * Checks whether a tool call is safe or should be blocked.
 * Fast, 100% deterministic, zero-network evaluation.
 */
function evaluateRules(tool_name, tool_input) {
  const blacklistPaths = ['.env', '.ssh/', 'id_rsa', '/etc/', '/private/', '/var/', '/usr/'];

  // Dangerous / destructive shell commands
  const destructiveCmds = /(^|\s|;|&&|\|\|)(rm|mv|chmod|chown)(\s|$)/i;

  // Mutating or state-altering git commands (push, commit, reset, checkout, rebase, clean, restore)
  const mutatingGitCmds =
    /(^|\s|;|&&|\|\|)(git|gh)\s+(push|commit|reset|checkout|rebase|clean|restore|tag\s+-[dD]|branch\s+-[dD])(\s|$)/i;

  let cmdStr = '';
  if (tool_name === 'run_shell_command' && tool_input && tool_input.command) {
    cmdStr = tool_input.command.trim();
  }

  // 1. Check destructive shell commands
  if (cmdStr && destructiveCmds.test(cmdStr)) {
    return 'deny';
  }

  // 2. Check mutating git commands
  if (cmdStr && mutatingGitCmds.test(cmdStr)) {
    return 'deny';
  }

  // 3. Check sensitive file paths
  const targetPath = (tool_input?.file_path || tool_input?.path || '').toLowerCase();
  if (targetPath && blacklistPaths.some((b) => targetPath.includes(b))) {
    return 'deny';
  }
  if (cmdStr && blacklistPaths.some((b) => cmdStr.toLowerCase().includes(b))) {
    return 'deny';
  }

  // 4. Block unauthorized subagent spawning via hook
  if (tool_name === 'invoke_agent') {
    return 'deny';
  }

  // 5. Block external GitHub PR/issue web fetches
  if (tool_name === 'web_fetch' && tool_input?.prompt) {
    const promptStr = tool_input.prompt.toLowerCase();
    if (promptStr.includes('github.com') && (promptStr.includes('/pull') || promptStr.includes('/issues'))) {
      return 'deny';
    }
  }

  return 'allow';
}

async function main() {
  let inputData;
  try {
    const buffers = [];
    for await (const chunk of process.stdin) {
      buffers.push(chunk);
    }
    const rawData = Buffer.concat(buffers).toString('utf-8');
    inputData = JSON.parse(rawData);
  } catch {
    outputResult({ decision: 'deny', reason: 'Failed to parse input parameters.' });
    process.exit(0);
  }

  const { tool_name, tool_input } = inputData;
  const decision = evaluateRules(tool_name, tool_input);

  if (decision === 'deny') {
    const proposedCall = `${tool_name}(${JSON.stringify(tool_input || {})})`;
    outputResult({
      decision: 'deny',
      reason: `tool call ${proposedCall} was detected as potentially destructive`,
    });
    process.exit(0);
  }

  outputResult({ decision: 'allow' });
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Fail-open on unexpected crash to avoid locking developer workflow
    outputResult({ decision: 'allow' });
    process.exit(0);
  });
}
