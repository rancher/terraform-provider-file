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
 * @returns {Promise<{outputDir: string, jobsCount: number}>}
 */
export async function downloadLogs({ octokit, owner, repo, runId, outputDir }) {
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

  let savedCount = 0;

  for (const job of jobs) {
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

async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  let runId = null;
  let outputDir = null;

  if (arg1 && /^#?\d+$/.test(arg1)) {
    runId = parseInt(arg1.replace(/^#/, ''), 10);
    outputDir = arg2 || `/tmp/ci-logs-${runId}`;
  } else if (arg1 && (arg1.startsWith('/') || arg1.startsWith('.'))) {
    outputDir = arg1;
  } else if (arg1 === 'current' || !arg1) {
    outputDir = arg2 || null;
  } else {
    console.error('Usage: download_logs.js [run_id_or_current] [output_directory]');
    process.exit(1);
  }

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
    console.log(`Downloading job logs for run #${runId} to ${outputDir}...`);
    const result = await downloadLogs({
      octokit,
      owner,
      repo,
      runId,
      outputDir,
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
