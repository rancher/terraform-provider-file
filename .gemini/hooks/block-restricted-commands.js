#!/usr/bin/env node

import { GeminiCliAgent } from '@google/gemini-cli-sdk';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookName = path.basename(process.argv[1]);
const introLog = `🔒 Hook: ${hookName} - Loading hook context...`;
console.error(introLog);

const originalLog = console.log;
let hasLogged = false;

console.log = function (msg) {
  if (hasLogged) {
    return;
  }
  try {
    const parsed = JSON.parse(msg);
    if (parsed.systemMessage) {
      console.error(parsed.systemMessage);
    }
    const exitLog = `🔒 Hook: ${hookName} - Hook successfully loaded.`;
    console.error(exitLog);

    const msgs = [introLog];
    if (parsed.systemMessage) {
      msgs.push(parsed.systemMessage);
    }
    msgs.push(exitLog);
    parsed.systemMessage = msgs.join('\n');

    if (!parsed.decision) {
      parsed.decision = 'allow';
    }

    originalLog(JSON.stringify(parsed, null, 2));
    hasLogged = true;
  } catch (err) {
    console.error(err.message || err);
    originalLog(msg);
  }
};

process.on('exit', (code) => {
  if (!hasLogged) {
    const exitMsg = `🔒 Hook Error (${hookName}): Silent early exit detected with code ${code}.`;
    console.error(exitMsg);
    process.stdout.write(
      JSON.stringify({
        decision: 'deny',
        systemMessage: `${introLog}\n${exitMsg}`,
      }) + '\n',
    );
    hasLogged = true;
  }
});

function parseJSONFromText(text) {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function runOfflineChecks(tool_name, tool_input) {
  const blacklist = [
    '.githooks/',
    '.gemini/hooks/',
    '.gemini/settings.json',
    '.env',
    '.ssh/',
    '/etc/',
    '/private/',
    '/var/',
    '/usr/',
    'id_rsa',
    'id_ed25519',
  ];

  if (tool_name === 'run_shell_command' && tool_input && tool_input.command) {
    const cmdStr = tool_input.command.trim().toLowerCase();

    // Strictly forbid all raw Git and GitHub CLI commands
    if (cmdStr.match(/(^|\s)(git|gh)(\s|$)/)) {
      return true;
    }

    // Check blacklist files access in shell command
    if (blacklist.some((file) => cmdStr.includes(file))) {
      return true;
    }
  }

  // Strictly forbid scraping GitHub issues or pull requests
  if (tool_name === 'web_fetch' && tool_input && tool_input.prompt) {
    const promptStr = tool_input.prompt.toLowerCase();
    if (promptStr.includes('github.com') && (promptStr.includes('/pull') || promptStr.includes('/issues'))) {
      return true;
    }
  }

  const fileModificationTools = ['write_file', 'replace', 'edit_file', 'create_file', 'read_file'];
  if (fileModificationTools.includes(tool_name) && tool_input) {
    const targetPath = (tool_input.file_path || tool_input.path || '').toLowerCase();
    if (blacklist.some((file) => targetPath.includes(file.replace(/^\.|\/$/g, '')))) {
      return true;
    }
  }

  return false;
}

const AUDITOR_INSTRUCTIONS = `You are a strict security auditor. Evaluate the proposed tool call and determine if it violates our safety policies.

SAFETY POLICIES:
1. NO RAW GIT OR GH COMMANDS: All direct Git and GitHub CLI shell commands are strictly FORBIDDEN. Sub-agents must use the installed skills ('git-readonly', 'github-ci', 'github-pr') instead of executing raw "git" or "gh" commands.
2. NO SCRAPING GITHUB PRs/ISSUES: Web fetching (web_fetch) any github.com URLs that contain "/pull" or "/issues" is strictly FORBIDDEN. Sub-agents must use the "github-pr" skill.
3. NO BLACKLIST FILE ACCESS: Any tool call (including reading/writing via read_file, write_file, replace, or shell commands like cat, echo, grep, redirection) that attempts to alter, read, list, delete, or use any files on the Blacklist is strictly FORBIDDEN.
   - BLACKLIST FILES:
     - .gemini/hooks/
     - .gemini/settings.json
     - .env
     - any SSH configuration or private/public keys (~/.ssh, id_rsa, id_ed25519)
     - system configurations (/etc, /var, /private, /usr)

If the request is ALLOWED, return a JSON object with:
{
  "allowed": true
}

If the request is FORBIDDEN, return a JSON object with:
{
  "allowed": false,
  "reason": "A professional explanation of the policy violation, instructing the agent to use the installed custom skills (git-readonly, github-pr, github-ci) for the desired operation instead of direct raw commands or web fetching."
}

You MUST return ONLY a raw JSON block. Do not include markdown code block formatting, conversational text, or preambles.`;

async function main() {
  let inputData;
  try {
    const buffers = [];
    for await (const chunk of process.stdin) {
      buffers.push(chunk);
    }
    const rawData = Buffer.concat(buffers).toString('utf-8');
    inputData = JSON.parse(rawData);
  } catch (err) {
    console.error('Failed to parse stdin JSON in block-restricted-commands:', err.message || err);
    console.log(
      JSON.stringify({
        decision: 'deny',
        systemMessage: '🔒 Hook Notification: Failed to parse input, denying execution by default.',
      }),
    );
    process.exit(1);
  }

  const { tool_name, tool_input, is_offline } = inputData;

  console.error(`🔒 Auditing tool call: ${tool_name} with real-time safety agent...`);

  if (is_offline === true) {
    console.error(`🔒 Offline audit requested. Falling back to standard regex safety checks.`);
    const isViolated = runOfflineChecks(tool_name, tool_input);
    if (isViolated) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason: `🔒 Security Policy Violation: This action is restricted.\n\nPlease STOP what you are doing and call the 'ask_user' tool to request that the human developer perform this action manually on your behalf.`,
          systemMessage: '🔒 Security Block: Action denied by fallback safety check.',
        }),
      );
      process.exit(0);
    }
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: '🔒 Hook Notification: Execution approved (offline fallback checks passed).',
      }),
    );
    process.exit(0);
  }

  try {
    const auditor = new GeminiCliAgent({
      model: 'gemini-3.5-flash',
      instructions: AUDITOR_INSTRUCTIONS,
    });

    const controller = new globalThis.AbortController();
    const prompt = `Evaluate this tool call:
Tool Name: ${tool_name}
Tool Input: ${JSON.stringify(tool_input, null, 2)}`;

    const session = auditor.session();
    await session.initialize();
    const stream = session.sendStream(prompt, controller.signal);
    let accumulatedText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        accumulatedText += chunk.value || '';
      }
    }

    const decision = parseJSONFromText(accumulatedText);
    if (!decision || decision.allowed !== true) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason: decision.reason || 'Restricted action blocked by security policy.',
          systemMessage: '🔒 Security Block: Action denied by real-time safety audit.',
        }),
      );
      process.exit(0);
    }
  } catch (err) {
    console.error(
      `⚠️ Real-time safety audit skipped or failed: ${err.message}. Falling back to standard regex safety checks.`,
    );
    const isViolated = runOfflineChecks(tool_name, tool_input);
    if (isViolated) {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason: `🔒 Security Policy Violation: This action is restricted.\n\nPlease STOP what you are doing and call the 'ask_user' tool to request that the human developer perform this action manually on your behalf.`,
          systemMessage: '🔒 Security Block: Action denied by fallback safety check.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow', systemMessage: `🔒 Hook Notification: Execution approved.` }));
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('::error::Fatal Block Restricted Commands Hook Error:', err.stack || err.message);
    process.exit(1);
  });
}
