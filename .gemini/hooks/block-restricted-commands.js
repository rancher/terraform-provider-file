#!/usr/bin/env node

import { GeminiCliAgent } from '@google/gemini-cli-sdk';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

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

const AUDITOR_INSTRUCTIONS = `You are a security auditor. Evaluate the proposed tool call and determine if it is dangerous, destructive, or violates safety policy.

Reply with EXACTLY one of the following JSON objects (and absolutely nothing else):

If the action is safe and non-destructive:
{
  "decision": "allow"
}

If the action is dangerous, destructive, or modifies system state in an unsafe way:
{
  "decision": "block"
}

Do not include any conversational text, markdown formatting (like \`\`\`json), or explanations.`;

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
    // If we fail to parse stdin, fail safe (deny)
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason: 'Failed to parse input parameters.',
      }),
    );
    console.error(`Failed to parse input parameters: ${err.message}`);
    process.exit(0);
  }

  const { tool_name, tool_input, is_offline } = inputData;

  // Block any attempt to invoke other agents
  if (tool_name === 'invoke_agent') {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason: 'Subagent invocation is disabled. Agents are not permitted to invoke other agents.',
      }),
    );
    process.exit(0);
  }

  // 1. Run ultra-fast local checks first
  const isViolated = runOfflineChecks(tool_name, tool_input);
  if (isViolated) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          'Attempting to use a destructive command, instead use the appropriate skill for what you are attempting to do.',
      }),
    );
    process.exit(0);
  }

  // 2. If offline audit requested, we are done
  if (is_offline === true) {
    console.log(
      JSON.stringify({
        decision: 'allow',
      }),
    );
    process.exit(0);
  }

  // 3. Run Option 2: Stripped-down, fast, 1-shot LLM audit using the authenticated agent
  const controller = new globalThis.AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 5000); // 5-second timeout

  try {
    const auditor = new GeminiCliAgent({
      model: 'gemini-3.1-flash-lite',
      instructions: AUDITOR_INSTRUCTIONS,
      tools: [], // Explicitly registers 0 tools to prevent overhead
      skills: [], // Explicitly registers 0 skills to prevent scan overhead
      maxTurns: 1, // Hard lock of 1 turn (strictly 1-shot)
      debug: false, // Ensure verbose logs are disabled
    });

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
    clearTimeout(timeoutId);

    const decision = parseJSONFromText(accumulatedText);
    if (decision && decision.decision === 'block') {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason:
            'Attempting to use a destructive command, instead use the appropriate skill for what you are attempting to do.',
        }),
      );
      process.exit(0);
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    clearTimeout(timeoutId);
    // On any timeout or LLM error, fail-safe to allow (since offline checks already passed)
  }

  // Approved and silent on success
  console.log(
    JSON.stringify({
      decision: 'allow',
    }),
  );
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    // Fail safe
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason: 'An unexpected internal error occurred in the safety check hook.',
      }),
    );
    process.exit(0);
  });
}
