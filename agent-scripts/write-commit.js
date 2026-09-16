#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as core from '@actions/core';
import crypto from 'crypto';
import { resolveTargetDir } from './tools/file.js';
import { findLatestActivePlan } from './tools/plan.js';

const execFileAsync = promisify(execFile);

// Helper to execute git securely
async function executeGit(args, cwd = process.cwd()) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

// Calculate active local diff hash programmatically
async function calculateDiffHash(cwd = process.cwd()) {
  const unstagedDiff = await executeGit(['diff', '-U10'], cwd);
  if (unstagedDiff.trim() !== '') {
    throw new Error('❌ Unstaged changes detected! Stage all changes using "git add" before running write-commit.js.');
  }

  const untrackedFilesOutput = await executeGit(['ls-files', '--others', '--exclude-standard'], cwd);
  const untrackedFiles = untrackedFilesOutput.split('\n').filter(Boolean);
  if (untrackedFiles.length > 0) {
    throw new Error(
      `❌ Untracked files detected in the workspace: ${untrackedFiles.join(', ')}. Stage or remove them before running write-commit.js.`,
    );
  }

  const hash = crypto.createHash('sha256');
  const activeDiff = await executeGit(['diff', '--staged', '-U10', 'HEAD'], cwd);
  hash.update(activeDiff);
  return hash.digest('hex');
}

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

  // Validate basic schema fields provided by the agent
  if (!payload.intent || typeof payload.intent !== 'string') {
    core.error("Payload is missing required string field: 'intent'");
    process.exit(1);
  }
  if (!payload.request || typeof payload.request !== 'string') {
    core.error("Payload is missing required string field: 'request'");
    process.exit(1);
  }
  if (!payload['commit-message'] || typeof payload['commit-message'] !== 'string') {
    core.error("Commit metadata is missing required string field: 'commit-message'");
    process.exit(1);
  }

  const targetDir = await resolveTargetDir();

  // 1. Programmatically calculate the active staged diff hash
  let activeDiffHash;
  try {
    activeDiffHash = await calculateDiffHash();
  } catch (err) {
    core.error(`Diff hash calculation failed: ${err.message}`);
    process.exit(1);
  }

  // 2. Programmatically read the active plan markdown file for PR description
  const activePlanPath = await findLatestActivePlan(targetDir);
  if (!activePlanPath) {
    core.error('Fatal Error: No active plan markdown file found to compile PR description.');
    process.exit(1);
  }

  let planMarkdown;
  try {
    planMarkdown = await fs.promises.readFile(activePlanPath, 'utf8');
  } catch (err) {
    core.error(`Failed to read active plan at ${activePlanPath}: ${err.message}`);
    process.exit(1);
  }

  // 3. Programmatically generate the PR Title and PR Description
  const commitTitle = payload['commit-message'].split('\n')[0].trim();
  const prTitle = commitTitle;
  const prDescription = planMarkdown;

  // 4. Validate PR Title length (max 70 characters)
  if (prTitle.length > 70) {
    core.error(
      `PR title derived from commit message is ${prTitle.length} characters, which exceeds the 70 character limit.`,
    );
    process.exit(1);
  }

  // 5. Validate the commit message using the repo validate-commit-message script
  const validateScriptPath = path.resolve(process.cwd(), '.github/workflows/scripts/validate-commit-message.js');
  const { validateCommitTitle } = await import(`file://${validateScriptPath}`);

  // Determine if modified files affect the product (inside 'internal/')
  let affectsProduct = false;
  try {
    const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    const lines = statusOutput.split('\n');
    for (const line of lines) {
      if (line.length > 3) {
        const cleanLine = line.substring(3).trim();
        if (cleanLine.startsWith('internal/')) {
          affectsProduct = true;
          break;
        }
      }
    }
  } catch (err) {
    core.warning(`Failed to determine if commit affects product: ${err.message}`);
  }

  const commitValidation = validateCommitTitle(commitTitle, affectsProduct, false);
  if (!commitValidation.valid) {
    core.error(`Commit message title validation failed: ${commitValidation.reason}`);
    process.exit(1);
  }

  // 6. Assemble the complete enriched commit metadata
  const enrichedPayload = {
    intent: payload.intent,
    request: payload.request,
    hash: activeDiffHash,
    'commit-message': payload['commit-message'],
    'pr-title': prTitle,
    'pr-description': prDescription,
  };

  // 7. Write commit-metadata.json asynchronously to the target session directory
  const filePath = path.join(targetDir, 'commit-metadata.json');
  await fs.promises.writeFile(filePath, JSON.stringify(enrichedPayload, null, 2), { mode: 0o600 });
  core.info(`Successfully wrote enriched and validated commit metadata to ${filePath}`);

  // 8. Write the commit markdown document plans/commit.md
  const plansDir = path.dirname(activePlanPath);
  const commitMarkdownPath = path.join(plansDir, 'commit.md');
  const commitMarkdownLines = [];
  commitMarkdownLines.push('# Commit Details');
  commitMarkdownLines.push('');
  commitMarkdownLines.push('### Commit Message');
  commitMarkdownLines.push('```');
  commitMarkdownLines.push(payload['commit-message']);
  commitMarkdownLines.push('```');
  commitMarkdownLines.push('');
  commitMarkdownLines.push('### PR Title');
  commitMarkdownLines.push(prTitle);
  commitMarkdownLines.push('');
  commitMarkdownLines.push('### PR Description');
  commitMarkdownLines.push(prDescription);
  commitMarkdownLines.push('');

  await fs.promises.writeFile(commitMarkdownPath, commitMarkdownLines.join('\n'), 'utf8');
  core.info(`Successfully wrote commit markdown to ${commitMarkdownPath}`);
}

main().catch((err) => {
  core.error(`Fatal Error in write-commit.js: ${err.message || err}`);
  process.exit(1);
});
