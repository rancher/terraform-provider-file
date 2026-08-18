#!/usr/bin/env node
import fs from 'fs';

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input } = inputData;

  // Intercept any tool usage targeting the TOTP secret file
  let contentToInspect = '';

  if (tool_name === 'run_shell_command' && tool_input.command) {
    contentToInspect = tool_input.command;
  } else if (
    (tool_name === 'write_file' || tool_name === 'read_file' || tool_name === 'replace') &&
    tool_input.file_path
  ) {
    contentToInspect = tool_input.file_path;
  }

  // Strictly block any attempt to read, write, grep, or reference the totp_secret key
  if (contentToInspect.includes('totp_secret') || contentToInspect.includes('totp_secret.key')) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          '🔒 Security Policy Violation: Direct access, reading, or modification of the TOTP secret key is strictly prohibited.\n\n' +
          'The TOTP secret must remain completely isolated from the AI agent to prevent automated signature spoofing.',
        systemMessage: '🔒 Security Block: TOTP secret key access is denied.',
      }),
    );
    process.exit(0);
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
