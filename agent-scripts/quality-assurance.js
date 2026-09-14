#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { revokeSignature, verifyPlanGate } from './tools/approval.js';
import { executeGit, gitAddAll, gitDiffHeadNameOnly, gitDiffStagedContext } from './tools/git.js';
import { runGeminiWithValidation } from './tools/gemini.js';
import { resolveTargetDir } from './tools/file.js';
import { runPreReviewTests } from './tools/test.js';
import { readPlan } from './tools/plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let activeSandboxDir = null;
let lockAcquired = false;

process.on('unhandledRejection', async (reason) => {
  console.error('::error::Unhandled Promise Rejection: ' + (reason.stack || reason));
  await teardown();
  process.exit(1);
});

async function teardown() {
  if (activeSandboxDir) {
    try {
      await fs.promises.rm(activeSandboxDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to clean up sandbox: ${err.message}`);
    }
    activeSandboxDir = null;
  }
  if (lockAcquired) {
    const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
    try {
      await fs.promises.unlink(lockPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to unlink lock file: ${err.message}`);
      }
    }
    lockAcquired = false;
    console.info('::notice::[Teardown] Workspace lock (gemini-reset.lock) safely released.');
  }
}

async function asyncExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (err) {
    console.debug(`Access failed for ${filePath}: ${err.message}`);
    return false;
  }
}

async function writeFileSafe(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content, { encoding: 'utf8', ...options });
}

async function readFileSafe(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    console.debug(`Read failed for ${filePath}: ${err.message}`);
    return null;
  }
}

export function getStandardsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mappings = {
    '.go': 'docs/development/reference/Go.md',
    '.tf': 'docs/development/reference/Terraform.md',
    '.sh': 'docs/development/reference/ShellScripts.md',
    '.bash': 'docs/development/reference/ShellScripts.md',
    '.js': 'docs/development/reference/JavaScript.md',
    '.mjs': 'docs/development/reference/JavaScript.md',
    '.cjs': 'docs/development/reference/JavaScript.md',
    '.ts': 'docs/development/reference/JavaScript.md',
    '.md': 'docs/development/reference/Documentation.md',
    default: 'docs/development/reference/CodingStandards.md',
  };
  return mappings[ext] || mappings['default'];
}

export function parseJSONFromText(text) {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error(`Invalid JSON: ${err.message}`);
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

  await writeFileSafe(
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

  await writeFileSafe(path.join(targetDir, 'phase.txt'), 'commit');

  console.info('::notice::🟢 Gate 2 (Review) Cryptographically Signed successfully!');
}

export async function getRepoDefaultBranch() {
  try {
    const ref = await executeGit(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return ref.trim().replace('refs/remotes/origin/', '');
  } catch (err) {
    console.debug(`Failed to resolve default branch ref: ${err.message}`);
    return 'main';
  }
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
  process.exit(0);
}

async function main() {
  const currentDirName = path.basename(process.cwd());
  if (currentDirName === 'agent-scripts') {
    process.chdir(path.resolve(__dirname, '..'));
  }

  const args = process.argv.slice(2);
  if (args.includes('help') || args.includes('-h') || args.includes('--help')) {
    showHelp();
  }
  const isDebug = args.includes('--debug');
  console.info(`::notice::[QA] Debug mode: ${isDebug ? 'enabled' : 'disabled'}`);

  // Acquire workspace lock
  const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
  lockAcquired = false;
  const start = Date.now();
  while (!lockAcquired) {
    if (Date.now() - start > 30000) {
      console.error('::error::❌ Failed to acquire workspace lock (gemini-reset.lock is active).');
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
    console.info(`::notice::📦 Created secure QA subagent sandbox: ${sandboxDir}`);
  } catch (err) {
    console.error('::error::❌ Failed to create temporary sandbox directory: ' + err.message);
    await teardown();
    process.exit(1);
  }

  // Step 1: Verify planning gate status
  console.info('::notice::Verifying planning gate status...');
  const planHash = await verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    console.error('::error::❌ Error: Planning Gate (Gate 1) has not been approved yet. Run plan phase first.');
    await teardown();
    process.exit(1);
  }
  console.info('::notice::🟢 Planning Gate status verified successfully.');

  // Step 2: Run pre-review tests and linter
  console.info('::notice::Running workspace linters and tests...');
  const testResults = await runPreReviewTests(TARGET_DIR);
  if (!testResults.success) {
    console.error('::error::❌ Workspace testing or linting failed!');
    console.error(testResults.failureOutput);
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }
  console.info('::notice::🟢 All workspace linters and tests passed.');

  // Step 3: Stage all changes and gather the context diff
  console.info('::notice::Staging all workspace changes (git add -A)...');
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
    console.warn(`Failed to read .aiexclude: ${err.message}`);
  }

  if (excludeRules.length === 0) {
    excludeRules = ['go.sum', 'package-lock.json', '.png', '.jpg', '.svg', '.gif', '.lock'];
  }

  let activeDiff;
  let unfilteredDiff;
  let changedFilesOutput;

  const defaultBranch = await getRepoDefaultBranch();
  const currentBranch = await executeGit(['branch', '--show-current']);

  if (currentBranch && currentBranch !== defaultBranch) {
    console.info(`::notice::[Feature Branch] Reviewing all changes against base branch 'origin/${defaultBranch}'...`);
    try {
      unfilteredDiff = await executeGit(['diff', '-U10', `origin/${defaultBranch}`]);
      changedFilesOutput = await executeGit(['diff', `origin/${defaultBranch}`, '--name-only']);
    } catch (err) {
      // If origin/<defaultBranch> doesn't exist or fetch failed, fallback to local defaultBranch
      console.warn(
        `::warning::Failed to diff against origin/${defaultBranch}, falling back to local ${defaultBranch}: ${err.message}`,
      );
      unfilteredDiff = await executeGit(['diff', '-U10', defaultBranch]);
      changedFilesOutput = await executeGit(['diff', defaultBranch, '--name-only']);
    }
  } else {
    console.info('::notice::[Targeted Diff] Identifying changed files relative to HEAD...');
    unfilteredDiff = await gitDiffStagedContext();
    changedFilesOutput = await gitDiffHeadNameOnly();
  }

  const rawChangedFiles = changedFilesOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const changedFiles = filterExcludedFiles(rawChangedFiles, excludeRules);

  if (unfilteredDiff && unfilteredDiff.trim() !== '' && changedFiles.length === 0) {
    console.error('::error::❌ Security Gating Failure: Staged changes consist solely of protected/excluded files.');
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }

  if (!unfilteredDiff || unfilteredDiff.trim() === '') {
    console.info('::notice::🟢 No changes detected. Automatically approving Review Gate.');
    const emptyReport = {
      approval_status: 'APPROVED',
      findings: [],
      suggested_commit: {
        title: 'chore: no changes to review',
        message: 'No changes found in the workspace.',
      },
    };
    await writeSignatures(emptyReport, planHash, '', TARGET_DIR);
    await teardown();
    process.exit(0);
  }

  // Generate the filtered activeDiff for Gemini audit
  if (changedFiles.length > 0) {
    if (currentBranch && currentBranch !== defaultBranch) {
      try {
        activeDiff = await executeGit(['diff', '-U10', `origin/${defaultBranch}`, '--', ...changedFiles]);
      } catch (err) {
        console.debug(`Failed to diff against origin/${defaultBranch}, trying local fallback: ${err.message}`);
        activeDiff = await executeGit(['diff', '-U10', defaultBranch, '--', ...changedFiles]);
      }
    } else {
      activeDiff = await executeGit(['diff', '-U10', 'HEAD', '--staged', '--', ...changedFiles]);
    }
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
        console.info('::notice::Loaded stateful project-report.json with prior tradeoff decisions.');
      }
    } catch (err) {
      console.warn(`::warning::Failed to parse project-report.json: ${err.message}`);
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

  console.info('::notice::🔍 Performing single-pass QA Review via @quality_assurance...');
  const schemaPrompt = `{
  "approval_status": "APPROVED/UNAPPROVED",
  "findings": [
    {
      "file": "relative_filepath",
      "line_numbers": [12, 13],
      "narrative": "Detailed narrative"
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
    console.error(`::error::❌ QA Review execution or validation failed: ${err.message}`);
    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }

  // Step 8: Evaluate results and sign off or exit
  const isApproved = qaReportObj.approval_status === 'APPROVED';

  if (isApproved) {
    console.info('::notice::🟢 QA Review Approved! No issues detected.');
    // Remove stale remediation-report.json to prevent subsequent auto-remediation from running on stale data
    const remediationChecklistPath = path.join(TARGET_DIR, 'remediation-report.json');
    if (await asyncExists(remediationChecklistPath)) {
      try {
        await fs.promises.unlink(remediationChecklistPath);
        console.info('::notice::Cleaned up stale remediation-report.json successfully.');
      } catch (err) {
        console.warn(`::warning::Failed to remove stale remediation report: ${err.message}`);
      }
    }
    await writeSignatures(qaReportObj, planHash, unfilteredDiff, TARGET_DIR);
    await teardown();
    process.exit(0);
  } else {
    console.error('::error::❌ QA Review Unapproved: Findings require manual remediation before commit.');
    console.info(`::notice::💡 Actionable Findings:\n${JSON.stringify(qaReportObj.findings, null, 2)}`);

    // Write remediation-report.json to maintain compatibility with remediate tool
    const remediationChecklistPath = path.join(TARGET_DIR, 'remediation-report.json');
    try {
      await writeFileSafe(remediationChecklistPath, JSON.stringify(qaReportObj.findings, null, 2));
      console.info(`::notice::✅ Remediation report successfully written to: ${remediationChecklistPath}`);
    } catch (err) {
      console.error(`::error::❌ Failed to write remediation report: ${err.message}`);
    }

    await revokeSignature(TARGET_DIR, 'review-approval.json');
    await teardown();
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error('::error::❌ Fatal QA Review Orchestrator Error: ' + (err.stack || err.message));
    await teardown();
    process.exit(1);
  });
}
