#!/usr/bin/env node

import fs from 'fs';
import TOML from '@iarna/toml';

const hookName = 'ask-user-toml-validator.js';
const introLog = `🔒 Hook: ${hookName} - Validating ask_user tool TOML payload...`;
console.error(introLog);

// Intercept console.log to ensure output is clean JSON
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
    const exitLog = `🔒 Hook: ${hookName} - Done.`;
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
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      systemMessage: `${introLog}\n${exitMsg}`
    }) + '\n');
    hasLogged = true;
  }
});

process.on('uncaughtException', (err) => {
  const errMsg = `🔒 Hook Error (${hookName}): Unhandled exception - ${err.message || err}`;
  console.error(errMsg);
  if (!hasLogged) {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      systemMessage: `${introLog}\n${errMsg}`
    }) + '\n');
    hasLogged = true;
  }
  process.exit(1);
});

function deny(reason) {
  console.log(JSON.stringify({
    decision: 'deny',
    reason: `❌ ask_user Validation Failure!\n\n${reason}\n\nFor more details, please refer to the documentation: docs/development/AgenticFramework/AskUserComponent.md`,
    systemMessage: '🔒 Security Block: ask_user TOML validation failed.'
  }));
  process.exit(0);
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow', systemMessage: '🔒 Hook Notification: Failed to parse input, allowing execution by default.' }));
    process.exit(0);
  }

  const { tool_name, tool_input } = inputData;
  if (tool_name !== 'ask_user' || !tool_input) {
    console.log(JSON.stringify({ decision: 'allow', systemMessage: '🔒 Hook Notification: Execution allowed, tool is not ask_user.' }));
    process.exit(0);
  }

  // Extract the text of the first question
  let promptText = '';
  if (tool_input.questions && Array.isArray(tool_input.questions) && tool_input.questions.length > 0) {
    promptText = tool_input.questions[0].question || '';
  } else if (tool_input.question) {
    promptText = tool_input.question;
  } else if (tool_input.prompt) {
    promptText = tool_input.prompt;
  }

  if (!promptText) {
    deny("The ask_user tool call was invoked without any question text/prompt.");
  }

  // Parse TOML
  let tomlData;
  try {
    tomlData = TOML.parse(promptText);
  } catch (err) {
    deny(`Failed to parse prompt as valid TOML. Error: ${err.message}\n\nYour prompt must be well-formed TOML. Ensure multiline strings use triple-quotes (""").`);
  }

  // Validate generic fields
  if (!tomlData.intent || typeof tomlData.intent !== 'string') {
    deny("The TOML payload is missing the required 'intent' string field.");
  }
  if (!tomlData.request || typeof tomlData.request !== 'string') {
    deny("The TOML payload is missing the required 'request' string field.");
  }

  const intent = tomlData.intent.trim();

  // Validate specific intents
  if (intent === 'plan approval') {
    if (!tomlData.plan || typeof tomlData.plan !== 'string') {
      deny("For 'plan approval' intent, a string 'plan' field containing the markdown plan is required.");
    }
  } else if (intent === 'commit approval') {
    if (!tomlData.hash || typeof tomlData.hash !== 'string') {
      deny("For 'commit approval' intent, a string 'hash' field containing the review phase diff hash is required.");
    }
    if (!tomlData['commit-message'] || typeof tomlData['commit-message'] !== 'string') {
      deny("For 'commit approval' intent, a string 'commit-message' field containing the approved commit message is required.");
    }
    if (!tomlData['pr-description'] || typeof tomlData['pr-description'] !== 'string') {
      deny("For 'commit approval' intent, a string 'pr-description' field containing the pull request description is required.");
    }
  }

  // If valid, allow execution
  console.log(JSON.stringify({
    decision: 'allow',
    systemMessage: `✅ ask_user TOML validation passed for intent '${intent}'.`
  }));
  process.exit(0);
}

main();
