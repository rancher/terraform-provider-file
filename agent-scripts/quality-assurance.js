#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { revokeSignature, verifyPlanGate } from './tools/approval.js';
import { executeGit, gitAddAll, getActiveDiff, getActiveChangedFiles } from './tools/git.js';
import { runGeminiWithValidation } from './tools/gemini.js';
import { resolveTargetDir, writeFileSafe, readFileSafe } from './tools/file.js';
import { runPreReviewTests } from './tools/test.js';
import * as core from '@actions/core';
import { readPlan } from './tools/plan.js';
import { setPhase } from './tools/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let activeSandboxDir = null;
let lockAcquired = false;

async function teardown() {
  if (activeSandboxDir) {
    try {
      await fs.promises.rm(activeSandboxDir, { recursive: true, force: true });
    } catch (err) {
      core.warning(`Failed to clean up sandbox: ${err.message}`);
    }
    activeSandboxDir = null;
  }
  if (lockAcquired) {
    const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
    try {
      await fs.promises.unlink(lockPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        core.warning(`Failed to unlink lock file: ${err.message}`);
      }
    }
    lockAcquired = false;
    core.notice('[Teardown] Workspace lock (gemini-reset.lock) safely released.');
  }
}

async function asyncExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.debug(`Access failed for ${filePath}: ${err.message}`);
    }
    return false;
  }
}

export function getStandardsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mappings = {
    '.go': 'docs/development/reference/Go.toml',
    '.tf': 'docs/development/reference/Terraform.toml',
    '.sh': 'docs/development/reference/ShellScripts.toml',
    '.bash': 'docs/development/reference/ShellScripts.toml',
    '.js': 'docs/development/reference/JavaScript.toml',
    '.mjs': 'docs/development/reference/JavaScript.toml',
    '.cjs': 'docs/development/reference/JavaScript.toml',
    '.ts': 'docs/development/reference/JavaScript.toml',
    '.md': 'docs/development/reference/DocumentationFormatting.toml',
    '.toml': 'docs/development/reference/DocumentationFormatting.toml',
    '.yml': 'docs/development/reference/Workflows.toml',
    '.yaml': 'docs/development/reference/Workflows.toml',
    default: 'docs/development/reference/CodingStandards.toml',
  };
  return mappings[ext] || mappings['default'];
}

export function parseJSONFromText(text) {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    core.error(`Invalid JSON: ${err.message}`);
    return clean.startsWith('[') ? [] : {};
  }
}

export const qaValidator = (output) => {
  const parsed = parseJSONFromText(output);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Output must be a valid JSON object.');
  }
  if (parsed.approval_status !== 'APPROVED' && parsed.approval_status !== 'UNAPPROVED') {
    throw new Error('approval_status must be either APPROVED or UNAPPROVED.');
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error('findings must be an array.');
  }
  for (const item of parsed.findings) {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Each finding item must be an object.');
    }
    if (typeof item.file !== 'string') {
      throw new Error("Each finding must have a string 'file' property.");
    }
    if (!Array.isArray(item.line_numbers)) {
      throw new Error("Each finding must have an array 'line_numbers' property.");
    }
    if (typeof item.narrative !== 'string') {
      throw new Error("Each finding must have a string 'narrative' property.");
    }
  }
  if (typeof parsed.suggested_commit !== 'object' || parsed.suggested_commit === null) {
    throw new Error('suggested_commit must be an object.');
  }
  return parsed;
};

async function writeSignatures(reportObj, planHash, activeDiff, targetDir) {
  await revokeSignature(targetDir, 'review-approval.json');

  const diffHash = crypto.createHash('sha256').update(activeDiff).digest('hex');
  const suggestedCommit = reportObj.suggested_commit || {};
  const suggestedCommitMessage = `${suggestedCommit.title || ''}\n\n${suggestedCommit.message || ''}`.trim();

  const ok = await writeFileSafe(
    path.join(targetDir, 'review-approval.json'),
    JSON.stringify(
      {
        status: 'approved',
        plan_hash: planHash,
        diff_hash: diffHash,
        suggested_commit_message: suggestedCommitMessage,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o400 },
  );

  if (!ok) {
    throw new Error(`Failed to write review-approval.json under targetDir: ${targetDir}`);
  }

  await setPhase(targetDir, 'commit');
  core.info('Workspace phase automatically transitioned to commit!');
  core.info('Gate 2 (Review) Cryptographically Signed successfully!');
}

export function filterExcludedFiles(files, excludeRules) {
  const results = [];

  const exclusions = [];
  const negations = [];

  for (const rule of excludeRules) {
    const trimmed = rule.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('!')) {
      negations.push(trimmed.slice(1));
    } else {
      exclusions.push(trimmed);
    }
  }

  const matchesRule = (filePath, rule) => {
    if (rule.endsWith('/')) {
      const dirRule = rule.slice(0, -1);
      return filePath === dirRule || filePath.startsWith(rule) || filePath.includes('/' + rule);
    }
    if (rule.includes('*') || rule.includes('?')) {
      const escaped = rule.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`(^|/)${regexStr}$`);
      return regex.test(filePath);
    }
    if (rule.startsWith('.')) {
      return path.extname(filePath) === rule || filePath.endsWith(rule);
    }
    return filePath === rule || filePath.endsWith('/' + rule);
  };

  for (const file of files) {
    const filePath = file.trim();
    if (!filePath) {
      continue;
    }

    let isExcluded = false;
    for (const rule of exclusions) {
      if (matchesRule(filePath, rule)) {
        isExcluded = true;
        break;
      }
    }

    if (isExcluded) {
      for (const rule of negations) {
        if (matchesRule(filePath, rule)) {
          isExcluded = false;
          break;
        }
      }
    }

    if (!isExcluded) {
      results.push(filePath);
    }
  }
  return results;
}

function showHelp() {
  console.info('Usage: node agent-scripts/quality-assurance.js [options]');
  console.info('');
  console.info('Options:');
  console.info('  help, -h, --help  Show this help message');
  console.info('  --debug           Enable debug/verbose logging');
  console.info('  --check-only      Dry-run review check without modifying state or signing approvals');
  process.exit(0);
}

async function main() {
  process.on('unhandledRejection', async (reason) => {
    core.error('Unhandled Promise Rejection: ' + (reason.stack || reason));
    await teardown();
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    core.warning('Process interrupted via SIGINT. Running teardown...');
    await teardown();
    process.exit(130);
  });

  process.on('SIGTERM', async () => {
    core.warning('Process terminated via SIGTERM. Running teardown...');
    await teardown();
    process.exit(143);
  });

  const currentDirName = path.basename(process.cwd());
  if (currentDirName === 'agent-scripts') {
    process.chdir(path.resolve(__dirname, '..'));
  }

  const args = process.argv.slice(2);
  if (args.includes('help') || args.includes('-h') || args.includes('--help')) {
    showHelp();
  }
  const isDebug = args.includes('--debug');
  const isCheckOnly = args.includes('--check-only');
  core.info(`[QA] Debug mode: ${isDebug ? 'enabled' : 'disabled'}`);
  if (isCheckOnly) {
    core.notice('[QA] Check-only mode: enabled. Phase transitions and signatures are disabled.');
  }

  // Acquire workspace lock
  const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
  lockAcquired = false;
  const start = Date.now();
  while (!lockAcquired) {
    if (Date.now() - start > 30000) {
      core.error('❌ Failed to acquire workspace lock (gemini-reset.lock is active).');
      process.exit(1);
    }
    let fh;
    try {
      fh = await fs.promises.open(lockPath, 'wx');
      try {
        await fh.write(process.pid.toString());
      } finally {
        await fh.close();
      }
      lockAcquired = true;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const TARGET_DIR = await resolveTargetDir();

  // Initialize temporary sandbox directory
  let sandboxDir;
  try {
    sandboxDir = await fs.promises.mkdtemp(path.join(TARGET_DIR, 'gemini-qa-sandbox-'));
    activeSandboxDir = sandboxDir;
    core.notice(`📦 Created secure QA subagent sandbox: ${sandboxDir}`);
  } catch (err) {
    core.error(`❌ Failed to create temporary sandbox directory: ${err.message}`);
    await teardown();
    process.exit(1);
  }

  // Step 1: Verify planning gate status
  core.info('Verifying planning gate status...');
  const planHash = await verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    core.error('❌ Error: Planning Gate (Gate 1) has not been approved yet. Run plan phase first.');
    await teardown();
    process.exit(1);
  }
  core.info('🟢 Planning Gate status verified successfully.');

  // Step 2: Run pre-review tests and linter
  core.info('Running workspace linters and tests...');
  const testResults = await runPreReviewTests(TARGET_DIR);
  if (!testResults.success) {
    core.error('❌ Workspace testing or linting failed!');
    core.error(testResults.failureOutput);
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }
  core.info('🟢 All workspace linters and tests passed.');

  // Step 3: Stage all changes and gather the context diff
  core.info('Staging all workspace changes (git add -A)...');
  await gitAddAll();

  // Load .aiexclude rules
  let excludeRules = [];
  try {
    const aiexcludePath = path.join(process.cwd(), '.aiexclude');
    if (await asyncExists(aiexcludePath)) {
      const content = await fs.promises.readFile(aiexcludePath, 'utf8');
      excludeRules = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    }
  } catch (err) {
    core.warning(`Failed to read .aiexclude: ${err.message}`);
  }

  if (excludeRules.length === 0) {
    excludeRules = ['go.sum', 'package-lock.json', '.png', '.jpg', '.svg', '.gif', '.lock'];
  }

  let activeDiff;

  core.info('[Unified Diff] Calculating active workspace difference...');
  const unfilteredDiff = await getActiveDiff(process.cwd());
  const changedFilesOutput = await getActiveChangedFiles(process.cwd());

  const rawChangedFiles = changedFilesOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const changedFiles = filterExcludedFiles(rawChangedFiles, excludeRules);

  if (unfilteredDiff && unfilteredDiff.trim() !== '' && changedFiles.length === 0) {
    core.error('❌ Security Gating Failure: Staged changes consist solely of protected/excluded files.');
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }

  if (!unfilteredDiff || unfilteredDiff.trim() === '') {
    core.info('🟢 No changes detected. Automatically approving Review Gate.');
    const emptyReport = {
      approval_status: 'APPROVED',
      findings: [],
      suggested_commit: {
        title: 'chore: no changes to review',
        message: 'No changes found in the workspace.',
      },
    };
    if (isCheckOnly) {
      core.notice('[Check-Only] Skipping signature and phase transition.');
    } else {
      await writeSignatures(emptyReport, planHash, '', TARGET_DIR);
    }
    await teardown();
    process.exit(0);
  }

  // Generate the filtered activeDiff for Gemini audit
  if (changedFiles.length > 0) {
    activeDiff = await executeGit(['diff', '-U10', 'HEAD', '--staged', '--', ...changedFiles]);
  } else {
    activeDiff = '';
  }

  // Step 4: Load the active Plan (acting as living PR description)
  const activePlan = await readPlan(TARGET_DIR);
  if (!activePlan) {
    console.error('::error::❌ Error: Failed to load the active plan from TARGET_DIR.');
    await teardown();
    process.exit(1);
  }

  // Step 5: Load coding standards for changed files
  let codingStandardsText = '';
  const standardsFilesLoaded = new Set();
  for (const file of changedFiles) {
    const stdFile = getStandardsFile(file);
    if (!standardsFilesLoaded.has(stdFile)) {
      standardsFilesLoaded.add(stdFile);
      const stdPath = path.join(process.cwd(), stdFile);
      if (await asyncExists(stdPath)) {
        const content = await readFileSafe(stdPath);
        if (content) {
          codingStandardsText += `\n\n--- CODING STANDARDS REFERENCE: ${stdFile} ---\n${content}`;
        }
      }
    }
  }

  // Step 6: Load prior project decisions from .gemini/project-report.json
  const stateFile = path.join(process.cwd(), '.gemini/project-report.json');
  let priorDecisions = [];
  if (await asyncExists(stateFile)) {
    try {
      const stateContent = await readFileSafe(stateFile);
      if (stateContent) {
        priorDecisions = JSON.parse(stateContent);
        core.info('Loaded stateful project-report.json with prior tradeoff decisions.');
      }
    } catch (err) {
      core.warning(`Failed to parse project-report.json: ${err.message}`);
    }
  }

  // Step 7: Construct QA Reviewer system & evaluation prompt
  const qaPrompt = `Please perform a single-pass quality assurance review of the staged code changes in <git_diff> by applying your system instructions to evaluate Plan congruence, security, concurrency, and style correctness.

  <active_plan>
  ${activePlan}
  </active_plan>

  <prior_decisions>
  ${JSON.stringify(priorDecisions, null, 2)}
  </prior_decisions>

  <coding_standards>
  ${codingStandardsText}
  </coding_standards>

  <git_diff>
  ${activeDiff}
  </git_diff>`;

  core.info('Performing single-pass QA Review via @quality_assurance...');
  const schemaPrompt = `{
  "approval_status": "APPROVED/UNAPPROVED",
  "findings": [
    {
      "file": "relative_filepath",
      "line_numbers": [12, 13],
      "narrative": "Detailed narrative of active/unresolved violations (this array MUST be empty if approval_status is APPROVED)"
    }
  ],
  "suggested_commit": {
    "title": "Chore: title",
    "message": "Commit message"
  }
}`;

  let qaReportObj;
  try {
    const { output } = await runGeminiWithValidation(
      qaPrompt,
      '@quality_assurance',
      sandboxDir,
      schemaPrompt,
      qaValidator,
      ['gemini-3.1-pro-preview', 'gemini-3.5-flash'],
      300000,
      'QA',
      '@json_formatter',
    );
    qaReportObj = parseJSONFromText(output);
  } catch (err) {
    core.error(`❌ QA Review execution or validation failed: ${err.message}`);
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }

  // Step 8: Evaluate results and sign off or exit
  const isApproved =
    qaReportObj.approval_status === 'APPROVED' &&
    (!Array.isArray(qaReportObj.findings) || qaReportObj.findings.length === 0);

  if (isApproved) {
    core.notice('🟢 QA Review Approved! No issues detected.');
    // Remove stale remediation-report.json to prevent subsequent auto-remediation from running on stale data
    const remediationChecklistPath = path.join(TARGET_DIR, 'remediation-report.json');
    if (await asyncExists(remediationChecklistPath)) {
      try {
        await fs.promises.unlink(remediationChecklistPath);
        core.info('Cleaned up stale remediation-report.json successfully.');
      } catch (err) {
        core.warning(`Failed to remove stale remediation report: ${err.message}`);
      }
    }
    if (isCheckOnly) {
      core.notice('[Check-Only] Skipping signature and phase transition.');
    } else {
      await writeSignatures(qaReportObj, planHash, unfilteredDiff, TARGET_DIR);
    }
    await teardown();
    process.exit(0);
  } else {
    core.error('QA Review Unapproved: Findings require manual remediation before commit.');
    core.info(`Actionable Findings:\n${JSON.stringify(qaReportObj.findings, null, 2)}`);

    // Write remediation-report.json to maintain compatibility with remediate tool
    const remediationChecklistPath = path.join(TARGET_DIR, 'remediation-report.json');
    const okReport = await writeFileSafe(remediationChecklistPath, JSON.stringify(qaReportObj.findings, null, 2));
    if (okReport) {
      core.info(`Remediation report successfully written to: ${remediationChecklistPath}`);
    } else {
      core.error(`Failed to write remediation report under targetDir: ${TARGET_DIR}`);
    }

    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    core.error('Fatal QA Review Orchestrator Error: ' + (err.stack || err.message));
    await teardown();
    process.exit(1);
  });
}
