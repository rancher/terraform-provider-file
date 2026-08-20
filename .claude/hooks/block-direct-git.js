#!/usr/bin/env node
//
// Hook: block-direct-git.js
// Description: PreToolUse controller for the Bash tool. Adapts Claude Code's hook
//              I/O contract to the shared, tool-agnostic `verifyGitCommand` check
//              in agent-scripts/security.js (unmodified, reused by both the Gemini
//              and Claude integrations).
//

import fs from 'fs';
import { verifyGitCommand } from '../../agent-scripts/security.js';

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const { tool_name: toolName, tool_input: toolInput, cwd } = inputData;

  if (toolName !== 'Bash' || !toolInput || !toolInput.command) {
    process.exit(0);
  }

  const result = verifyGitCommand(toolInput.command, cwd);

  if (result.decision === 'deny') {
    console.error(result.reason || 'Security Policy Violation: command blocked.');
    process.exit(2);
  }

  process.exit(0);
}

main();
