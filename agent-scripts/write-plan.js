#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as core from '@actions/core';
import { resolveTargetDir } from './tools/file.js';
import { findLatestActivePlan } from './tools/plan.js';

async function main() {
  const rawJsonStr = process.argv[2];

  if (!rawJsonStr) {
    core.error('Usage: write-plan.js <json_string>');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(rawJsonStr);
  } catch (err) {
    core.error(`Invalid JSON payload: ${err.message}`);
    process.exit(1);
  }

  // Validate plan-metadata JSON schema strictly
  if (!payload.intent || typeof payload.intent !== 'string') {
    core.error("Payload is missing required string field: 'intent'");
    process.exit(1);
  }
  if (!payload.request || typeof payload.request !== 'string') {
    core.error("Payload is missing required string field: 'request'");
    process.exit(1);
  }
  if (!payload.plan || typeof payload.plan !== 'object' || Array.isArray(payload.plan)) {
    core.error("Payload is missing required object field: 'plan'");
    process.exit(1);
  }

  const planTitle =
    payload.plan.title !== undefined && typeof payload.plan.title === 'string'
      ? payload.plan.title.trim()
      : 'Active Implementation Plan';

  const planDesc =
    payload.plan.description !== undefined && typeof payload.plan.description === 'string'
      ? payload.plan.description.trim()
      : '';

  const tasks = payload.plan.tasks;
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    core.error("Plan object must contain a non-empty 'tasks' array");
    process.exit(1);
  }

  const allStrings = tasks.every((t) => typeof t === 'string' && t.trim() !== '');
  if (!allStrings) {
    core.error("All elements inside the 'tasks' array must be non-empty strings");
    process.exit(1);
  }

  const targetDir = await resolveTargetDir();
  const metadataPath = path.join(targetDir, 'plan-metadata.json');

  // 1. Write plan-metadata.json asynchronously to the target session directory
  await fs.promises.writeFile(metadataPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  core.info(`Successfully wrote validated plan metadata to ${metadataPath}`);

  // 2. Programmatically compile and overwrite the user-facing Markdown plan file
  const activePlanPath = await findLatestActivePlan(targetDir);
  if (activePlanPath) {
    const markdownLines = [];
    markdownLines.push(`# ${planTitle}`);
    if (planDesc) {
      markdownLines.push('');
      markdownLines.push(planDesc);
    }
    markdownLines.push('');
    markdownLines.push('### Tasks');
    for (const task of tasks) {
      markdownLines.push(`- [ ] ${task.trim()}`);
    }
    markdownLines.push('');

    await fs.promises.writeFile(activePlanPath, markdownLines.join('\n'), 'utf8');
    core.info(`Programmatically compiled and synchronized plan file at: ${activePlanPath}`);
  } else {
    core.warning('No active plan markdown file found to synchronize.');
  }
}

main().catch((err) => {
  core.error(`Fatal Error in write-plan.js: ${err.message || err}`);
  process.exit(1);
});
