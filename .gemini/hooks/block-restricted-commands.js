#!/usr/bin/env node

import fs from 'fs';
import { verifyGitCommand } from '../../agent-scripts/security.js';

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON in block-restricted-commands:', err.message || err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = inputData;

  if (tool_name === 'run_shell_command' && tool_input && tool_input.command) {
    const result = verifyGitCommand(tool_input.command, cwd || process.cwd());
    if (result && result.decision === 'deny') {
      console.log(
        JSON.stringify({
          decision: 'deny',
          reason: result.reason || 'Command execution blocked by security policy.',
          systemMessage: '🔒 Security Block: Restricted shell command denied.',
        }),
      );
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
