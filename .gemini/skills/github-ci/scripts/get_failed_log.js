#!/usr/bin/env node
import { getCurrentBranch, getOctokit, getRepoDetails } from './auth.js';
import { findFailedRuns } from './find_failed_runs.js';

/**
 * Retrieves and parses logs from failed jobs in a workflow run.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.runId
 * @returns {Promise<{run: object, failedJobs: Array<{job: object, errorLines: Array<string>}>}>}
 */
export async function getFailedLog({ octokit, owner, repo, runId }) {
  const { data: run } = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  const failedJobs = [];
  const failureRegex = /\b(error|failed|failure|fatal|panic|exit code [1-9]|exit status [1-9])\b/i;

  for (const job of jobsData.jobs || []) {
    if (job.conclusion === 'failure' || job.status === 'in_progress') {
      let logText = '';
      try {
        const logRes = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
          owner,
          repo,
          job_id: job.id,
        });
        logText = typeof logRes.data === 'string' ? logRes.data : String(logRes.data);
      } catch {
        // Logs might not be available
      }

      const lines = logText.split('\n');
      const errorLines = lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && failureRegex.test(l))
        .slice(-30); // Last 30 error lines

      failedJobs.push({
        job,
        errorLines,
      });
    }
  }

  return { run, failedJobs };
}

async function main() {
  const runIdArg = process.argv[2];
  let runId = runIdArg ? parseInt(runIdArg, 10) : null;

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  if (!runId || isNaN(runId)) {
    const branch = await getCurrentBranch();
    console.log(`Finding latest failed run for branch '${branch || 'all'}'...`);
    const failedRuns = await findFailedRuns({ octokit, owner, repo, branch, limit: 1 });
    if (failedRuns.length === 0) {
      console.log('No failed workflow runs found.');
      return;
    }
    runId = failedRuns[0].id;
  }

  console.log(`==================================================`);
  console.log(`Inspecting failed workflow run #${runId} in ${owner}/${repo}...`);
  console.log(`==================================================\n`);

  try {
    const { run, failedJobs } = await getFailedLog({ octokit, owner, repo, runId });
    console.log(`Workflow:   ${run.name} (${run.event})`);
    console.log(`Status:     ${run.status} / ${run.conclusion}`);
    console.log(`Branch:     ${run.head_branch} (Commit: ${run.head_sha?.slice(0, 7)})`);
    console.log(`URL:        ${run.html_url}`);

    if (failedJobs.length === 0) {
      console.log('\nNo specific failed jobs found or logs are still pending.');
      return;
    }

    console.log(`\n=== Failed Job Log Analysis (${failedJobs.length} job(s)) ===`);
    for (const item of failedJobs) {
      console.log(`\n❌ Job: ${item.job.name} (ID: ${item.job.id})`);
      if (item.errorLines.length === 0) {
        console.log('   (No explicit error lines matched, check full logs via download_logs.js)');
      } else {
        console.log('   Relevant failure log lines:');
        for (const line of item.errorLines) {
          console.log(`   > ${line}`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error inspecting failed run: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
