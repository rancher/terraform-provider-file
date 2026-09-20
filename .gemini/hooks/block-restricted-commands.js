#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { GeminiCliAgent } from '@google/gemini-cli-sdk';

function evaluateQuickRules(tool_name, tool_input) {
  const blacklistPaths = [
    '.gemini/hooks/block-restricted-commands.js',
    '.env',
    '.ssh/',
    '/etc/',
    '/private/',
    '/var/',
    '/usr/',
  ];

  const blacklistCmds = /(^|\s)(git|gh|rm|mv|chmod|chown)(\s|$)/;

  let cmdStr = '';
  if (tool_name === 'run_shell_command' && tool_input && tool_input.command) {
    cmdStr = tool_input.command.trim().toLowerCase();
  }

  // Check blacklisted commands
  if (cmdStr && blacklistCmds.test(cmdStr)) {
    return 'deny';
  }

  // Check blacklisted paths
  const targetPath = (tool_input?.file_path || tool_input?.path || '').toLowerCase();
  if (targetPath && blacklistPaths.some((b) => targetPath.includes(b))) {
    return 'deny';
  }
  if (cmdStr && blacklistPaths.some((b) => cmdStr.includes(b))) {
    return 'deny';
  }

  // Explicit restrictions from original logic
  if (tool_name === 'invoke_agent') {
    return 'deny';
  }
  if (tool_name === 'web_fetch' && tool_input?.prompt) {
    const promptStr = tool_input.prompt.toLowerCase();
    if (promptStr.includes('github.com') && (promptStr.includes('/pull') || promptStr.includes('/issues'))) {
      return 'deny';
    }
  }

  // Quick Whitelist Eval
  const whitelistTools = ['ask_user', 'web_fetch', 'read_file', 'list_directory', 'search_project'];
  if (whitelistTools.includes(tool_name)) {
    return 'allow';
  }

  const whitelistCmds = /^(ls|cat|pwd|grep|head|tail|less|cd|whoami|history)\b/;
  if (cmdStr && whitelistCmds.test(cmdStr)) {
    return 'allow';
  }

  return 'unknown';
}

async function lightweightLlmEval(tool_name, tool_input) {
  const prompt = `Evaluate the following tool call and determine if it is dangerous, destructive, or modifies system state in an unsafe way.
Respond with EXACTLY ONE WORD: "allow" or "deny". Respond "deny" ONLY if the tool call would be destructive.

Tool Name: ${tool_name}
Tool Input: ${JSON.stringify(tool_input)}`;

  try {
    const agent = new GeminiCliAgent({
      model: 'gemini-3.1-flash-lite',
      instructions: 'You are a strict security evaluator. Answer with allow or deny.',
      tools: [],
    });

    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const session = agent.session();
    await session.initialize();

    const stream = session.sendStream(prompt, controller.signal);
    let stdout = '';

    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        stdout += chunk.value || '';
      }
    }
    clearTimeout(timeoutId);

    const text = stdout.trim().toLowerCase();
    return text.includes('deny') ? 'deny' : 'allow';
  } catch {
    // Fail open on timeout or network error to avoid pipeline locks
    return 'allow';
  }
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
    console.log(JSON.stringify({ decision: 'deny', reason: 'Failed to parse input parameters.' }));
    process.exit(0);
  }

  const { tool_name, tool_input, is_offline } = inputData;
  const proposedCall = `${tool_name}(${JSON.stringify(tool_input || {})})`;

  const denyResponse = {
    decision: 'deny',
    reason: `tool call ${proposedCall} was detected as potentially destructive`,
  };

  // 1 & 2. Quick Regex Eval (Blacklist and Whitelist)
  const quickDecision = evaluateQuickRules(tool_name, tool_input);

  if (quickDecision === 'deny') {
    console.log(JSON.stringify(denyResponse));
    process.exit(0);
  }

  if (quickDecision === 'allow') {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  if (is_offline) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // 3. Fallback to lightweight LLM eval for unknown tools/commands
  const llmDecision = await lightweightLlmEval(tool_name, tool_input);

  if (llmDecision === 'deny') {
    console.log(JSON.stringify(denyResponse));
    process.exit(0);
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Fail-open on fatal crash to ensure we don't completely trap the user/agent loop
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  });
}
