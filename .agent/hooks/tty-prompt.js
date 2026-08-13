#!/usr/bin/env node
//
// Hook Tool: tty-prompt.js
// Description: Reusable native TTY-based developer approval prompt for secure hooks.
//              Allows programmatically injecting confirmation gates inside other hooks.
// Usage: node .agent/hooks/tty-prompt.js "Approval Message Here" [defaultOption=N]

import fs from 'fs';

function main() {
  const message = process.argv[2] || "Do you approve this action?";
  const defaultOption = process.argv[3] || "N"; // Default is deny (fail-safe)

  try {
    // Open TTY for direct read and write streams
    const ttyRead = fs.openSync('/dev/tty', 'r');
    const ttyWrite = fs.openSync('/dev/tty', 'w');

    // Print stylized interactive card
    fs.writeSync(ttyWrite, `\n\x1b[1;33m============================================================\x1b[0m\n`);
    fs.writeSync(ttyWrite, `\x1b[1;35m🚨 HOOK GATEWAY: DEVELOPER CONFIRMATION REQUIRED\x1b[0m\n`);
    fs.writeSync(ttyWrite, `\x1b[1;33m============================================================\x1b[0m\n`);
    fs.writeSync(ttyWrite, `${message}\n`);
    fs.writeSync(ttyWrite, `\x1b[1;33m------------------------------------------------------------\x1b[0m\n`);
    const isDefaultYes = defaultOption.toLowerCase() === 'y' || defaultOption.toLowerCase() === 'yes';
    const optionPrompt = isDefaultYes ? "[Y/n]" : "[y/N]";
    fs.writeSync(ttyWrite, `Confirm ${optionPrompt}: `);

    // Read single-line response from TTY
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(ttyRead, buffer, 0, 1024, null);
    
    fs.closeSync(ttyRead);
    fs.closeSync(ttyWrite);

    const response = buffer.toString('utf8', 0, bytesRead).trim().toLowerCase();
    if (response === 'y' || response === 'yes') {
      process.exit(0); // Approved
    } else {
      process.exit(1); // Denied
    }
  } catch (err) {
    // Fallback if TTY is not available (e.g. non-interactive environments)
    console.error("Non-interactive terminal detected. Fallback to default:", defaultOption);
    if (defaultOption.toLowerCase() === 'y' || defaultOption.toLowerCase() === 'yes') {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

main();
