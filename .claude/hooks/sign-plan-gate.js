#!/usr/bin/env node
//
// Hook: sign-plan-gate.js
// Description: PostToolUse controller for ExitPlanMode. Once the harness has exited
//              plan mode (which only happens after the developer approves the plan),
//              this hook:
//                1. Locates the plan file Claude wrote (most recently modified file
//                   under ~/.claude/plans/, the same mtime-based heuristic
//                   agent-scripts/gating.js#findLatestActivePlan already uses for
//                   Gemini's own plan cache).
//                2. Persists it as the real repository blueprint under
//                   docs/development/<Slug>.md, bypassing the Edit/Write gate via a
//                   direct filesystem write (the same technique
//                   agent-scripts/after-ask.js#handlePlanApproval already uses).
//                3. Delegates to the shared, tool-agnostic
//                   agent-scripts/after-ask.js#handlePlanApproval (unmodified) to
//                   trigger the real Touch ID / Secure Enclave signature and write
//                   plan-approval.json.
//

import fs from 'fs';
import path from 'path';
import os from 'os';
import { handlePlanApproval } from '../../agent-scripts/after-ask.js';
import { getStateDir } from './lib/state-dir.js';

const TARGET_DIR = getStateDir();
const PLANS_DIR = path.resolve(os.homedir(), '.claude/plans');
const PUB_KEY_FILE = path.resolve(os.homedir(), '.claude/age-key.pub');
const PRIV_KEY_FILE = path.resolve(os.homedir(), '.claude/age-key.txt');

function findLatestPlanFile() {
  try {
    const files = fs
      .readdirSync(PLANS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const filePath = path.join(PLANS_DIR, f);
        return { path: filePath, mtime: fs.statSync(filePath).mtimeMs };
      });
    if (files.length === 0) {
      return null;
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return files[0].path;
  } catch (err) {
    console.error('🔒 Hook Debug: Failed to scan ~/.claude/plans:', err.message || err);
    return null;
  }
}

function slugify(title) {
  return (
    title
      .trim()
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'Plan'
  );
}

function persistBlueprint(planContent, cwd) {
  const titleMatch = planContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Plan';
  const slug = slugify(title);
  const targetPath = path.resolve(cwd || process.cwd(), 'docs/development', `${slug}.md`);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, planContent);
  return targetPath;
}

function ensurePlansScaffold() {
  const sessionPlansDir = path.join(TARGET_DIR, 'session', 'plans');
  fs.mkdirSync(sessionPlansDir, { recursive: true });
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const { tool_name: toolName, cwd } = inputData;

  if (toolName !== 'ExitPlanMode') {
    process.exit(0);
  }

  if (!fs.existsSync(PUB_KEY_FILE) || !fs.existsSync(PRIV_KEY_FILE)) {
    console.error(
      '🔒 Hook Notification: Cryptographic plan signing skipped — age key pair not found at ' +
        '~/.claude/age-key.pub / ~/.claude/age-key.txt. See docs/development/AgenticFramework/GatingAndApprovals.md.',
    );
    process.exit(0);
  }

  const planFile = findLatestPlanFile();
  if (!planFile) {
    console.error('🔒 Hook Debug: No plan file found under ~/.claude/plans; skipping Gate 1 signature.');
    process.exit(0);
  }

  let planContent;
  try {
    planContent = fs.readFileSync(planFile, 'utf-8');
  } catch (err) {
    console.error('🔒 Hook Error: Failed to read plan file:', err.message || err);
    process.exit(0);
  }

  const blueprintPath = persistBlueprint(planContent, cwd);
  console.error(`✅ Blueprint persisted to ${blueprintPath}`);

  ensurePlansScaffold();

  const result = handlePlanApproval(TARGET_DIR, PUB_KEY_FILE, PRIV_KEY_FILE, planContent);
  if (result && result.systemMessage) {
    console.error(result.systemMessage);
  }

  process.exit(0);
}

main();
