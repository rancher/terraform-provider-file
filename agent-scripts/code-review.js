#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { revokeSignature, verifyPlanGate } from './tools/approval.js';
import { executeGit, gitAddAll, gitDiffHeadNameOnly, gitDiffStagedContext } from './tools/git.js';
import { runMapPhase, runReducePhase } from './tools/review.js';
import { runProjectManager } from './tools/project-manager.js';
import { runMetaAnalysis } from './tools/meta-analysis.js';
import { resolveTargetDir } from './tools/file.js';
import { runPreReviewTests } from './tools/test.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let activeSandboxDir = null;
let lockAcquired = false;

process.on('unhandledRejection', async (reason) => {
  console.error('::error::Unhandled Promise Rejection: ' + (reason.stack || reason));
  if (activeSandboxDir) {
    try {
      await fs.promises.rm(activeSandboxDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to clean up sandbox on unhandled rejection: ${err.message}`);
    }
  }
  await teardown();
  process.exit(1);
});

async function getRepoDefaultBranch() {
  try {
    const ref = await executeGit(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return ref.trim().replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

async function asyncExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (err) {
    console.warn(err.message);
    return false;
  }
}

async function statSafe(filePath) {
  return await fs.promises.stat(filePath);
}

async function mkdtempSafe(prefix) {
  return await fs.promises.mkdtemp(prefix);
}

async function writeFileSafe(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content, { encoding: 'utf8', ...options });
}

async function readFileSafe(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function registerCleanupTraps(sandboxDir) {
  const cleanup = () => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to clean up sandbox on exit: ${err.message}`);
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

async function verifyGates(targetDir) {
  console.info('::notice::Verifying planning gate status...');
  const planHash = await verifyPlanGate(targetDir);
  if (!planHash) {
    console.error('::error::❌ Error: Planning Gate (Gate 1) has not been approved yet. Run plan phase first.');
    process.exit(1);
  }
  console.info('::notice::🟢 Planning Gate status verified successfully.');
  return planHash;
}

async function revokeReviewState(targetDir) {
  console.info('::notice::🗑️ Revoked review approval and state flag files due to non-compliance.');
  await revokeSignature(targetDir, 'review-approval.json');
}

async function getFilesRecursively(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.resolve(dirPath, entry.name);
      return entry.isDirectory() ? getFilesRecursively(res) : res;
    }),
  );
  return Array.prototype.concat(...files);
}

function filterExcludedFiles(files, excludeRules) {
  const results = [];
  for (const file of files) {
    const filePath = file.trim();
    if (!filePath) {
      continue;
    }
    const shouldExclude = () => {
      const ext = path.extname(filePath);
      return excludeRules.some((rule) => {
        if (rule.startsWith('.')) {
          return ext === rule || filePath.includes(rule);
        }
        if (rule.endsWith('/')) {
          return filePath.startsWith(rule) || filePath.includes('/' + rule);
        }
        return filePath === rule || filePath.endsWith('/' + rule);
      });
    };
    if (!shouldExclude()) {
      results.push(filePath);
    }
  }
  return results;
}

async function identifyFilesToReview(argv, targetDir, isFullContext = false) {
  let outputFilePath = path.join(targetDir, 'review-report.json');
  const pathArgs = argv.filter((arg) => !arg.startsWith('-'));

  const pathArg = pathArgs[0];
  const isCustomPathMode = !!pathArg;

  if (outputFilePath) {
    if (outputFilePath.startsWith('~')) {
      outputFilePath = path.join(os.homedir(), outputFilePath.slice(1));
    }
    outputFilePath = path.resolve(outputFilePath);
    console.info(`::notice::💾 Final report will be saved to: ${outputFilePath}`);
  }

  let activeDiff;
  let filteredFiles;
  let isEntireFileReview = false;

  if (isCustomPathMode) {
    const resolvedPath = path.resolve(process.cwd(), pathArg);
    if (!resolvedPath.startsWith(process.cwd())) {
      console.error(`::error::❌ Error: Path traversal detected or path outside workspace: ${pathArg}`);
      await revokeReviewState(targetDir);
      process.exit(1);
    }
    try {
      await fs.promises.access(resolvedPath);
    } catch {
      console.error(`::error::❌ Error: Path not found: ${pathArg}`);
      await revokeReviewState(targetDir);
      process.exit(1);
    }
    const stat = await statSafe(resolvedPath);
    if (stat.isDirectory()) {
      console.info(`::notice::🔍 Directory Mode: Recursively reviewing entire files as written in: ${resolvedPath}`);
      filteredFiles = await getFilesRecursively(resolvedPath);
      activeDiff = `directory-review-of-${resolvedPath}`;
    } else {
      console.info(`::notice::🔍 Single File Mode: Reviewing entire file as written: ${resolvedPath}`);
      filteredFiles = [resolvedPath];
      activeDiff = (await readFileSafe(resolvedPath)) || '';
    }
    isEntireFileReview = true;
  } else {
    console.info('::notice::Staging all workspace changes (git add -A)...');
    await gitAddAll();

    let filesOutput;
    if (isFullContext) {
      const defaultBranch = await getRepoDefaultBranch();
      console.info(`::notice::[Full Context] Calculating diff against default branch (git diff ${defaultBranch})...`);
      // Since executeGit is already imported and available, we can run:
      activeDiff = await executeGit(['diff', 'origin/' + defaultBranch]);
      filesOutput = await executeGit(['diff', 'origin/' + defaultBranch, '--name-only']);
    } else {
      console.info('::notice::[Targeted Diff] Identifying changed files relative to HEAD...');
      activeDiff = await gitDiffStagedContext();
      filesOutput = await gitDiffHeadNameOnly();
    }

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

    filteredFiles = filterExcludedFiles(
      filesOutput
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean),
      excludeRules,
    );
  }

  return { outputFilePath, filteredFiles, activeDiff, isEntireFileReview };
}

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

  await setPhase(targetDir, 'commit');

  console.info('::notice::🟢 Gate 2 (Review) Cryptographically Signed successfully!');
}

async function setPhase(targetDir, phase) {
  await writeFileSafe(path.join(targetDir, 'phase.txt'), phase);
}

function extractFindingsFromReport(reportText) {
  try {
    const report = JSON.parse(reportText);
    return report.active_ledger || [];
  } catch (err) {
    console.warn(`::warning::Failed to parse review report JSON: ${err.message}`);
    return [];
  }
}

function showHelp() {
  console.info('Usage: node agent-scripts/code-review.js [path] [options]');
  console.info('');
  console.info('Options:');
  console.info('  help, -h, --help  Show this help message');
  console.info('');
  console.info('If a path is provided, it reviews that file or directory entirely.');
  console.info('Otherwise, it reviews changed files relative to HEAD.');
  process.exit(0);
}

async function teardown() {
  if (lockAcquired) {
    const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
    try {
      await fs.promises.unlink(lockPath);
    } catch {
      // Ignore if doesn't exist
    }
    lockAcquired = false;
    console.info('::notice::[Teardown] Workspace lock (gemini-reset.lock) safely released.');
  }
}

async function main() {
  const currentDirName = path.basename(process.cwd());
  if (currentDirName === 'agent-scripts') {
    process.chdir(path.resolve(__dirname, '..'));
  } else if (currentDirName === 'tests') {
    process.chdir(path.resolve(__dirname, '../..'));
  }

  const args = process.argv.slice(2);
  if (args.includes('help') || args.includes('-h') || args.includes('--help')) {
    showHelp();
  }

  const isFullContext = args.includes('--full-context');

  const lockPath = path.join(process.cwd(), 'gemini-reset.lock');
  lockAcquired = false;
  const start = Date.now();
  while (!lockAcquired) {
    if (Date.now() - start > 30000) {
      console.error('::error::❌ Failed to acquire workspace lock (gemini-reset.lock is active).');
      process.exit(1);
    }
    try {
      const fh = await fs.promises.open(lockPath, 'wx');
      await fh.write(process.pid.toString());
      await fh.close();
      lockAcquired = true;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const TARGET_DIR = await resolveTargetDir();

  // Initialize unique temporary sandbox directory
  let sandboxDir;
  try {
    sandboxDir = await mkdtempSafe(path.join(TARGET_DIR, 'gemini-review-sandbox-'));
    activeSandboxDir = sandboxDir;
    console.info(`::notice::📦 Created secure subagent sandbox: ${sandboxDir}`);
    registerCleanupTraps(sandboxDir);
  } catch (err) {
    console.error('::error::❌ Failed to create temporary sandbox directory: ' + err.message);
    await revokeReviewState(TARGET_DIR);
    await teardown();
    process.exit(1);
  }

  // STEP 2: Verify Planning Gate
  const planHash = await verifyGates(TARGET_DIR);

  // STEP 3: Run Pre-Review Tests
  await runPreReviewTests(TARGET_DIR);

  // STEP 4: Identify Files to Review
  const { outputFilePath, filteredFiles, activeDiff, isEntireFileReview } = await identifyFilesToReview(
    args,
    TARGET_DIR,
    isFullContext,
  );

  console.info('::notice::🔍 Running single-pass code review...');

  // STEP 5: Map Phase (Auditors)
  const workerNotes = await runMapPhase(
    filteredFiles,
    isEntireFileReview,
    TARGET_DIR,
    sandboxDir,
    process.cwd(),
    false,
  );

  // STEP 6: Reduce Phase (Aggregation)
  const reportString = await runReducePhase(workerNotes, outputFilePath, TARGET_DIR, sandboxDir, process.cwd());

  let reportObj;
  try {
    reportObj = JSON.parse(reportString);
  } catch (err) {
    console.error(`::error::Failed to parse review report JSON: ${err.message}`);
    reportObj = { approval_status: 'UNAPPROVED', suggested_commit: {} };
  }
  const currentFindings = extractFindingsFromReport(reportString);

  // STEP 7: Meta-analysis (Read prior project findings and analyze for drift/convergence)
  const priorFindingsFile = path.join(TARGET_DIR, 'project-findings.json');
  let priorFindings = null;
  if (await asyncExists(priorFindingsFile)) {
    try {
      const priorContent = await fs.promises.readFile(priorFindingsFile, 'utf8');
      priorFindings = JSON.parse(priorContent);
    } catch (err) {
      console.warn(`::warning::Failed to read prior project findings: ${err.message}`);
    }
  }

  const { metaFindingsList, warnings, newFindings } = runMetaAnalysis(priorFindings, currentFindings, 0);
  if (warnings && warnings.length > 0) {
    console.warn(`::warning::Meta-analysis warnings: ${warnings.join(', ')}`);
  }
  if (newFindings && newFindings.length > 0) {
    const findingStrings = newFindings.map((nf) => `${nf.file}: ${nf.finding || nf.description || 'No description'}`);
    console.info(`::notice::New findings detected:\n${findingStrings.join('\n')}`);
  }

  // Save current findings as state for the next run
  try {
    await fs.promises.writeFile(priorFindingsFile, JSON.stringify(currentFindings, null, 2), 'utf8');
  } catch (err) {
    console.warn(`::warning::Failed to save project findings state: ${err.message}`);
  }

  // Save meta-findings to disk if they exist, so the project manager can read them
  const metaFindingsFileOnDisk = path.join(TARGET_DIR, 'meta-review-findings.txt');
  if (metaFindingsList.length > 0) {
    try {
      await fs.promises.writeFile(metaFindingsFileOnDisk, metaFindingsList.join('\n'), 'utf8');
      console.info(`::notice::📝 Saved ${metaFindingsList.length} meta-findings for the project manager.`);
    } catch (err) {
      console.warn(`::warning::Failed to write meta-review findings: ${err.message}`);
    }
  } else {
    try {
      await fs.promises.unlink(metaFindingsFileOnDisk);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`::warning::Failed to clean up meta-review findings: ${err.message}`);
      }
    }
  }

  // STEP 8: Project Manager Phase (Actionable Remediation Worklist)
  const { worklist } = await runProjectManager(reportString, TARGET_DIR, process.cwd(), sandboxDir);

  const isApproved = reportObj.approval_status === 'APPROVED';

  // STEP 9: Evaluate and Sign Off
  if (isApproved) {
    console.info('::notice::🟢 Review Approved by Data Scientist.');
    try {
      await fs.promises.unlink(metaFindingsFileOnDisk);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`::warning::Failed to clean up meta-review findings file on approval: ${err.message}`);
      }
    }
    try {
      await fs.promises.unlink(priorFindingsFile);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`::warning::Failed to clean up prior project findings file on approval: ${err.message}`);
      }
    }

    // Append APPROVED current findings to global findings-ledger.json
    const ledgerPath = path.join(os.homedir(), '.gemini/tmp', 'terraform-provider-file', 'findings-ledger.json');
    let ledger = [];
    const ledgerDir = path.dirname(ledgerPath);
    let ledgerContent = null;
    try {
      const [, content] = await Promise.all([
        fs.promises.mkdir(ledgerDir, { recursive: true }),
        (async () => {
          try {
            if (await asyncExists(ledgerPath)) {
              return await fs.promises.readFile(ledgerPath, 'utf8');
            }
          } catch (err) {
            console.warn(err.message);
          }
          return null;
        })(),
      ]);
      ledgerContent = content;
    } catch (err) {
      console.warn(`::warning::Failed to parallelize findings ledger operations: ${err.message}`);
    }

    if (ledgerContent) {
      try {
        ledger = JSON.parse(ledgerContent);
      } catch (err) {
        console.warn(`::warning::Failed to parse findings ledger: ${err.message}`);
      }
    }
    const timestamp = new Date().toISOString();
    for (const f of currentFindings) {
      const exists = ledger.some(
        (item) => item.file === f.file && (item.finding === f.finding || item.finding === f.description),
      );
      if (!exists) {
        ledger.push({
          timestamp,
          severity: f.severity,
          file: f.file,
          finding: f.finding || f.description || '',
        });
      }
    }
    try {
      await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(ledgerPath, { encoding: 'utf8' });
        stream.on('finish', resolve);
        stream.on('error', reject);
        stream.write(JSON.stringify(ledger, null, 2));
        stream.end();
      });
      console.info(`::notice::📝 Appended ${currentFindings.length} findings to the long-running findings ledger.`);
    } catch (err) {
      console.warn(`::warning::Failed to save findings ledger: ${err.message}`);
    }

    // Cryptographically sign review approval (Gate 2 passed)
    await writeSignatures(reportObj, planHash, activeDiff, TARGET_DIR);

    await teardown();
    process.exit(0);
  } else {
    // Review unapproved, write checklist reports to target dir
    const remediationChecklistPath = path.join(TARGET_DIR, 'remediation-report.json');
    try {
      await writeFileSafe(remediationChecklistPath, worklist);
      console.info(`::notice::✅ Remediation report successfully written to: ${remediationChecklistPath}`);
    } catch (err) {
      console.error(`::error::❌ Failed to write remediation report to ${remediationChecklistPath}: ${err.message}`);
    }

    const suppressedFindings = reportObj.suppressed_findings || [];
    if (suppressedFindings.length > 0) {
      const projectReportPath = path.join(process.cwd(), '.gemini', 'project-report.json');
      try {
        let existingReport = [];
        if (await asyncExists(projectReportPath)) {
          const rawContent = await readFileSafe(projectReportPath);
          if (rawContent) {
            try {
              existingReport = JSON.parse(rawContent);
              if (!Array.isArray(existingReport)) {
                existingReport = [];
              }
            } catch {
              existingReport = [];
            }
          }
        }

        for (const newFinding of suppressedFindings) {
          const isDuplicate = existingReport.some(
            (existing) => existing.file === newFinding.file && existing.finding === newFinding.finding,
          );
          if (!isDuplicate) {
            existingReport.push(newFinding);
          }
        }

        await writeFileSafe(projectReportPath, JSON.stringify(existingReport, null, 2));
        console.info(
          `::notice::✅ Stateful project report successfully saved and merged with ${suppressedFindings.length} new findings to .gemini/project-report.json`,
        );
      } catch (err) {
        console.error(`::error::❌ Failed to write project report to ${projectReportPath}: ${err.message}`);
      }
    }

    console.error('::error::❌ Review Unapproved: Findings require remediation.');
    console.info(`::notice::💡 Worklist:\n${worklist}`);

    // Programmatic WIP commit using the suggested commit message from the data scientist
    console.info('::notice::Executing automatic WIP commit to save remediation history...');
    try {
      const suggestedCommit = reportObj.suggested_commit || {};
      const commitTitle = suggestedCommit.title || 'wip: code review remediation';
      const commitMsg = `${commitTitle}\n\n${suggestedCommit.message || ''}`.trim();

      await gitAddAll();
      await executeGit(['commit', '-s', '-S', '-m', commitMsg]);
      console.info(`::notice::🟢 Successfully created WIP commit: "${commitTitle}"`);
    } catch (err) {
      console.warn(`::warning::Failed to execute automatic WIP commit: ${err.message}`);
    }

    await revokeReviewState(TARGET_DIR);
    await teardown();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.log('::error::❌ Fatal Review Orchestrator Error: ' + (err.stack || err.message));
  await teardown();
  process.exit(1);
});
