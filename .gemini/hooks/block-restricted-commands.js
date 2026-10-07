#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import path from 'node:path';
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

const DESTRUCTIVE_BINS = new Set(['rm', 'mv', 'chmod', 'chown']);
const SHELL_WRAPPERS = new Set(['command', 'builtin', 'exec', 'sudo', 'env', 'nohup', 'xargs']);
const MUTATING_GIT_SUBCOMMANDS = new Set([
  'push',
  'commit',
  'reset',
  'checkout',
  'rebase',
  'clean',
  'restore',
]);

/**
 * Splits a compound command string into individual statements
 * separated by ;, &&, ||, |, &, or newlines, ignoring separators inside quotes.
 */
function splitStatements(cmdStr) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escape = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '\n' || char === ';') {
        if (current.trim()) {
          statements.push(current.trim());
        }
        current = '';
        continue;
      }
      if (char === '&' || char === '|') {
        if (cmdStr[i + 1] === char) {
          if (current.trim()) {
            statements.push(current.trim());
          }
          current = '';
          i++;
          continue;
        } else {
          if (current.trim()) {
            statements.push(current.trim());
          }
          current = '';
          continue;
        }
      }
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

/**
 * Tokenizes a single command statement into words, respecting quotes.
 */
function tokenize(statement) {
  const tokens = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < statement.length; i++) {
    const char = statement[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escape = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Extracts the executable base name and remaining arguments after unwrapping
 * environment variable assignments and command wrappers (command, sudo, env, etc.).
 */
function unwrapCommand(tokens) {
  let idx = 0;

  while (idx < tokens.length) {
    const token = tokens[idx];

    // Skip environment variable assignments like FOO=bar
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      idx++;
      continue;
    }

    const baseName = path.basename(token).toLowerCase();

    // If it's a wrapper like sudo, env, command, exec, etc.
    if (SHELL_WRAPPERS.has(baseName)) {
      idx++;
      while (idx < tokens.length) {
        const flag = tokens[idx];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(flag)) {
          idx++;
          continue;
        }
        if (flag === '-u' || flag === '-a' || flag === '-g') {
          idx += 2;
          continue;
        }
        if (flag.startsWith('-')) {
          idx++;
          continue;
        }
        break;
      }
      continue;
    }

    break;
  }

  if (idx >= tokens.length) {
    return { executable: '', baseName: '', args: [] };
  }

  const executable = tokens[idx];
  const baseName = path.basename(executable).toLowerCase();
  const args = tokens.slice(idx + 1);

  return { executable, baseName, args };
}

function isStatementDestructive(statement) {
  const tokens = tokenize(statement);
  if (tokens.length === 0) {
    return false;
  }
  const { baseName } = unwrapCommand(tokens);
  return DESTRUCTIVE_BINS.has(baseName);
}

function isStatementMutatingGit(statement) {
  const tokens = tokenize(statement);
  if (tokens.length === 0) {
    return false;
  }
  const { baseName, args } = unwrapCommand(tokens);
  if (baseName !== 'git' && baseName !== 'gh') {
    return false;
  }

  let subCmdIdx = 0;
  while (subCmdIdx < args.length) {
    const arg = args[subCmdIdx];
    if (arg === '-C' || arg === '-c' || arg === '--git-dir' || arg === '--work-tree') {
      subCmdIdx += 2;
      continue;
    }
    if (arg.startsWith('-')) {
      subCmdIdx++;
      continue;
    }
    break;
  }

  if (subCmdIdx < args.length) {
    const subCmd = args[subCmdIdx].toLowerCase();
    if (MUTATING_GIT_SUBCOMMANDS.has(subCmd)) {
      return true;
    }
    if (subCmd === 'branch' || subCmd === 'tag') {
      const subArgs = args.slice(subCmdIdx + 1);
      if (
        subArgs.some(
          (a) => a === '-d' || a === '-D' || a === '--delete' || a.startsWith('-d') || a.startsWith('-D'),
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether a tool call is safe or should be blocked.
 * Fast, 100% deterministic, zero-network evaluation.
 */
function evaluateRules(tool_name, tool_input) {
  const blacklistPaths = [
    '.gemini/hooks/block-restricted-commands.js',
    '.gemini/settings.json',
    '.env',
    '.ssh/',
    'id_rsa',
    '/etc/',
    '/private/',
    '/var/',
    '/usr/',
  ];

  // Dangerous / destructive shell commands (matches bare, wrapped, or path-qualified)
  const destructiveCmds =
    /(^|[\s;&|`()$])(?:(?:command|sudo|exec|env|nohup|builtin)\s+(?:-[^\s;&|`()$]+\s+)*)*(?:[^\s;&|`()$]*\/)?(rm|mv|chmod|chown)([\s;&|`()$]|$)/i;

  // Mutating or state-altering git commands (push, commit, reset, checkout, rebase, clean, restore, tag -d, branch -d)
  const mutatingGitCmds =
    /(^|[\s;&|`()$])(?:(?:command|sudo|exec|env|nohup|builtin)\s+(?:-[^\s;&|`()$]+\s+)*)*(?:[^\s;&|`()$]*\/)?(git|gh)(\s+[^\s;&|`()$]+)*\s+(push|commit|reset|checkout|rebase|clean|restore|tag\s+-[dD]|branch\s+-[dD])([\s;&|`()$]|$)/i;

  let cmdStr = '';
  if (tool_name === 'run_shell_command' && tool_input && typeof tool_input.command === 'string') {
    cmdStr = tool_input.command.trim();
  }

  // 1. Check destructive shell commands (regex + parsed statements)
  if (
    cmdStr &&
    (destructiveCmds.test(cmdStr) || splitStatements(cmdStr).some((stmt) => isStatementDestructive(stmt)))
  ) {
    return 'deny';
  }

  // 2. Check mutating git commands (regex + parsed statements)
  if (
    cmdStr &&
    (mutatingGitCmds.test(cmdStr) || splitStatements(cmdStr).some((stmt) => isStatementMutatingGit(stmt)))
  ) {
    return 'deny';
  }

  // 3. Check sensitive file paths
  const rawTargetPath = (tool_input?.file_path || tool_input?.path || tool_input?.dir_path || '').toLowerCase();
  const targetPath = rawTargetPath.replace(/\\/g, '/');
  if (targetPath && blacklistPaths.some((b) => targetPath.includes(b))) {
    return 'deny';
  }
  const normalizedCmd = cmdStr.toLowerCase().replace(/\\/g, '/');
  const normalizedCmdForPaths = normalizedCmd.replace(/\/usr\/(?:local\/)?(?:bin|sbin)\//g, '');
  if (normalizedCmdForPaths && blacklistPaths.some((b) => normalizedCmdForPaths.includes(b))) {
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
