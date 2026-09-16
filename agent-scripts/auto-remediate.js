#!/usr/bin/env node
import { fileURLToPath } from 'url';
import * as core from '@actions/core';
import { runAutoRemediate } from './lib/remediate.js';

export default async function runRemediation() {
  return await runAutoRemediate();
}

async function main() {
  core.info('🚀 Starting automatic remediation engine...');
  try {
    const success = await runAutoRemediate();
    if (success) {
      core.info('✅ Automatic remediation completed successfully!');
    } else {
      core.error('❌ Automatic remediation failed.');
      process.exit(1);
    }
  } catch (err) {
    core.error(`❌ Fatal error in automatic remediation: ${err.message || err}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    core.error(`Fatal entrypoint error: ${err.message || err}`);
    process.exit(1);
  });
}
