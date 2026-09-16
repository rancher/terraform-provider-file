#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { resolveTargetDir } from './tools/file.js';

async function main() {
  const type = process.argv[2];
  const rawJsonStr = process.argv[3];

  if (!['plan', 'commit'].includes(type) || !rawJsonStr) {
    console.error('Usage: write-metadata.js <plan|commit> <json_string>');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(rawJsonStr);
  } catch (err) {
    console.error(`::error::Invalid JSON payload: ${err.message}`);
    process.exit(1);
  }

  // Validate basic schema fields
  if (!payload.intent || typeof payload.intent !== 'string') {
    console.error("::error::Payload is missing required string field: 'intent'");
    process.exit(1);
  }
  if (!payload.request || typeof payload.request !== 'string') {
    console.error("::error::Payload is missing required string field: 'request'");
    process.exit(1);
  }

  if (type === 'plan') {
    if (!payload.plan || typeof payload.plan !== 'object' || Array.isArray(payload.plan)) {
      console.error("::error::Plan metadata must be a JSON object: 'plan'");
      process.exit(1);
    }
    const tasks = payload.plan.tasks;
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      console.error("::error::Plan object must contain a non-empty 'tasks' array");
      process.exit(1);
    }
    const allStrings = tasks.every((t) => typeof t === 'string' && t.trim() !== '');
    if (!allStrings) {
      console.error("::error::All elements inside the 'tasks' array must be non-empty strings");
      process.exit(1);
    }
  } else if (type === 'commit') {
    if (!payload.hash || typeof payload.hash !== 'string') {
      console.error("::error::Commit metadata is missing required string field: 'hash'");
      process.exit(1);
    }
    if (!payload['commit-message'] || typeof payload['commit-message'] !== 'string') {
      console.error("::error::Commit metadata is missing required string field: 'commit-message'");
      process.exit(1);
    }
    if (!payload['pr-description'] || typeof payload['pr-description'] !== 'string') {
      console.error("::error::Commit metadata is missing required string field: 'pr-description'");
      process.exit(1);
    }
  }

  const targetDir = await resolveTargetDir();
  const fileName = `${type}-metadata.json`;
  const filePath = path.join(targetDir, fileName);

  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  console.log(`🟢 Successfully wrote validated ${type} metadata to ${filePath}`);
}

main().catch((err) => {
  console.error('::error::Fatal Error in write-metadata.js:', err.message || err);
  process.exit(1);
});
