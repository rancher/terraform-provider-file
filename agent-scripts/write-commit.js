#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as core from '@actions/core';
import { resolveTargetDir } from './tools/file.js';

async function main() {
  const rawJsonStr = process.argv[2];

  if (!rawJsonStr) {
    core.error('Usage: write-commit.js <json_string>');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(rawJsonStr);
  } catch (err) {
    core.error(`Invalid JSON payload: ${err.message}`);
    process.exit(1);
  }

  // Validate commit-metadata JSON schema strictly
  if (!payload.intent || typeof payload.intent !== 'string') {
    core.error("Payload is missing required string field: 'intent'");
    process.exit(1);
  }
  if (!payload.request || typeof payload.request !== 'string') {
    core.error("Payload is missing required string field: 'request'");
    process.exit(1);
  }
  if (!payload.hash || typeof payload.hash !== 'string') {
    core.error("Commit metadata is missing required string field: 'hash'");
    process.exit(1);
  }
  if (!payload['commit-message'] || typeof payload['commit-message'] !== 'string') {
    core.error("Commit metadata is missing required string field: 'commit-message'");
    process.exit(1);
  }
  if (!payload['pr-description'] || typeof payload['pr-description'] !== 'string') {
    core.error("Commit metadata is missing required string field: 'pr-description'");
    process.exit(1);
  }

  const targetDir = await resolveTargetDir();
  const filePath = path.join(targetDir, 'commit-metadata.json');

  // Write commit-metadata.json asynchronously to the target session directory
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  core.info(`Successfully wrote validated commit metadata to ${filePath}`);
}

main().catch((err) => {
  core.error(`Fatal Error in write-commit.js: ${err.message || err}`);
  process.exit(1);
});
