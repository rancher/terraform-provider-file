#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBranch, getOctokit, getRepoDetails } from './auth.js';
import { findFailedRuns } from './find_failed_runs.js';

/**
 * Downloads logs for a workflow run and saves them locally.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.runId
 * @param {string} params.outputDir
 * @param {boolean} [params.failedOnly=false]
 * @returns {Promise<{outputDir: string, jobsCount: number}>}
 */
export async function downloadLogs({ octokit, owner, repo, runId, outputDir, failedOnly = false }) {
  await fs.mkdir(outputDir, { recursive: true });

  // List all jobs for the workflow run across all pages
  const jobs = octokit.paginate
    ? await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: runId,
        per_page: 100,
      })
    : (
        await octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: runId,
        })
      ).data.jobs || [];

  const targetJobs = failedOnly
    ? jobs.filter(
        (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out' || j.conclusion === 'startup_failure',
      )
    : jobs;

  let savedCount = 0;

  for (const job of targetJobs) {
    try {
      const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      let logText;
      if (Buffer.isBuffer(response.data)) {
        logText = response.data.toString('utf8');
      } else if (response.data instanceof ArrayBuffer || ArrayBuffer.isView(response.data)) {
        logText = Buffer.from(response.data).toString('utf8');
      } else {
        logText = typeof response.data === 'string' ? response.data : String(response.data);
      }
      const safeJobName = job.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(outputDir, `job-${job.id}-${safeJobName}.log`);
      await fs.writeFile(filePath, logText, 'utf8');
      savedCount++;
    } catch {
      // Some jobs might not have logs available yet
    }
  }

  return { outputDir, jobsCount: savedCount };
}

/**
 * Parses command-line arguments for download_logs.js.
 * Supports:
 * - [run_id] [output_dir]
 * - [output_dir]
 * - [run_id]
 * - ['current', output_dir]
 * - [-o, output_dir] or [--output, output_dir] or [--output=dir]
 * - [--failed-only] or [-f]
 * @param {Array<string>} [args]
 * @returns {{runId: number|null, outputDir: string|null, failedOnly: boolean}}
 */
export function parseDownloadArgs(args = []) {
  let runId = null;
  let outputDir = null;
  let failedOnly = false;

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--failed-only' || arg === '-f') {
      failedOnly = true;
    } else if ((arg === '-o' || arg === '--output') && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
      outputDir = arg.slice(arg.indexOf('=') + 1);
    } else if (arg && !arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const first = positional[0];
    if (/^#?\d+$/.test(first)) {
      runId = parseInt(first.replace(/^#/, ''), 10);
      if (positional.length > 1 && !outputDir) {
        outputDir = positional[1];
      }
    } else if (first === 'current') {
      runId = null;
      if (positional.length > 1 && !outputDir) {
        outputDir = positional[1];
      }
    } else {
      if (!outputDir) {
        outputDir = first;
      }
      if (positional.length > 1 && /^#?\d+$/.test(positional[1])) {
        runId = parseInt(positional[1].replace(/^#/, ''), 10);
      }
    }
  }

  if (runId && !outputDir) {
    outputDir = `/tmp/ci-logs-${runId}`;
  }

  return { runId, outputDir, failedOnly };
}

async function main() {
  const { runId: parsedRunId, outputDir: parsedOutputDir, failedOnly } = parseDownloadArgs(process.argv.slice(2));
  let runId = parsedRunId;
  let outputDir = parsedOutputDir;

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  if (!runId) {
    const branch = await getCurrentBranch();
    console.log(`Finding latest failed run for branch '${branch || 'all'}'...`);
    const failedRuns = await findFailedRuns({ octokit, owner, repo, branch, limit: 1 });
    if (failedRuns.length === 0) {
      console.log('No failed workflow runs found to download logs for.');
      return;
    }
    runId = failedRuns[0].id;
    if (!outputDir) {
      outputDir = `/tmp/ci-logs-${runId}`;
    }
  }

  try {
    const scopeDesc = failedOnly ? 'failed job logs' : 'job logs';
    console.log(`Downloading ${scopeDesc} for run #${runId} to ${outputDir}...`);
    const result = await downloadLogs({
      octokit,
      owner,
      repo,
      runId,
      outputDir,
      failedOnly,
    });
    console.log(`✅ Successfully saved ${result.jobsCount} job log(s) to: ${result.outputDir}`);
  } catch (err) {
    console.error(`❌ Error downloading logs: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
