#!/usr/bin/env node
import fs from 'fs';
import { verifyGitCommand } from '../../agent-scripts/security.js';

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

  const result = verifyGitCommand(tool_input.command, cwd);
  console.log(JSON.stringify(result));
  process.exit(0);
}

main();
