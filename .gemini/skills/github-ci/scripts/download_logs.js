#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOctokit, getRepoDetails } from './auth.js';

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

  // List jobs for the workflow run
  const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  const jobs = data.jobs || [];
  let savedCount = 0;

  for (const job of jobs) {
    try {
      const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      const logText = typeof response.data === 'string' ? response.data : String(response.data);
      const safeJobName = job.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(outputDir, `job-${job.id}-${safeJobName}.log`);
      await fs.writeFile(filePath, logText, 'utf8');
      savedCount++;
    } catch (err) {
      // Some jobs might not have logs available yet
    }
  }

  return { outputDir, jobsCount: savedCount };
}

async function main() {
  const runIdArg = process.argv[2];
  if (!runIdArg) {
    console.error('Usage: download_logs.js <run_id> [output_directory]');
    process.exit(1);
  }

  const runId = parseInt(runIdArg, 10);
  if (isNaN(runId)) {
    console.error('❌ Error: run_id must be a numeric integer.');
    process.exit(1);
  }

  const outputDir = process.argv[3] || `/tmp/ci-logs-${runId}`;
  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

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
