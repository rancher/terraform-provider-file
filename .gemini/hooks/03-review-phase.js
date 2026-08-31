#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { afterInvoke, verifyPlanning, preReviewTesting } from './03-review/reviewLogic.js';

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
    process.stdout.write(
      JSON.stringify({
        decision: 'deny',
        systemMessage: `${introLog}\n${exitMsg}`,
      }) + '\n',
    );
    hasLogged = true;
  }
});

process.on('uncaughtException', (err) => {
  const errMsg = `🔒 Hook Error (${hookName}): Unhandled exception - ${err.message || err}`;
  console.error(errMsg);
  if (!hasLogged) {
    process.stdout.write(
      JSON.stringify({
        decision: 'deny',
        systemMessage: `${introLog}\n${errMsg}`,
      }) + '\n',
    );
    hasLogged = true;
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const errMsg = `🔒 Hook Error (${hookName}): Unhandled promise rejection - ${reason.message || reason}`;
  console.error(errMsg);
  if (!hasLogged) {
    process.stdout.write(
      JSON.stringify({
        decision: 'deny',
        systemMessage: `${introLog}\n${errMsg}`,
      }) + '\n',
    );
    hasLogged = true;
  }
  process.exit(1);
});

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON in 03-review-phase:', err.message || err);
    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage: '🔒 Hook Notification: Failed to parse input, allowing execution by default.',
      }),
    );
    process.exit(0);
  }

  const args = process.argv.slice(2);

  if (args.includes('--after-invoke') || args.includes('--after-subagent')) {
    afterInvoke(inputData);
  } else {
    const { tool_name, tool_input } = inputData;

    // Proceed only if the target is the project_manager being invoked
    if (tool_name !== 'invoke_agent' || !tool_input || tool_input.agent_name !== 'project_manager') {
      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage:
            '🔒 Hook Notification: Execution allowed, tool is not invoke_agent or agent is not project_manager.',
        }),
      );
      process.exit(0);
    }

    verifyPlanning();
    preReviewTesting(tool_input);
  }
}

main();
