#!/usr/bin/env node
import { getCurrentBranch, getOctokit, getRepoDetails } from './auth.js';
import { parseRunArgs } from './find_failed_runs.js';

/**
 * Lists workflow runs from GitHub Actions.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} [params.branch]
 * @param {number} [params.limit=10]
 * @param {string} [params.status]
 * @returns {Promise<Array>} List of workflow runs
 */
export async function listRuns({ octokit, owner, repo, branch, limit = 10, status }) {
  const req = {
    owner,
    repo,
    per_page: Math.min(limit, 100),
  };
  if (branch) {
    req.branch = branch;
  }
  if (status) {
    req.status = status;
  }

  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo(req);
  return data.workflow_runs || [];
}

async function main() {
  const { branchTarget, limit, status } = parseRunArgs(process.argv.slice(2));

  let branch;
  if (branchTarget === 'all') {
    branch = undefined;
  } else if (branchTarget === 'current') {
    branch = await getCurrentBranch();
  } else {
    branch = branchTarget;
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const runs = await listRuns({ octokit, owner, repo, branch, limit, status });
    const statusNote = status ? `, Status: ${status}` : '';
    console.log(`=== Recent Workflow Runs for ${owner}/${repo} (Branch: ${branch || 'all'}${statusNote}) ===\n`);
    if (runs.length === 0) {
      console.log('No workflow runs found.');
      return;
    }

    for (const r of runs) {
      const state = (r.conclusion || r.status).toUpperCase();
      const symbol = state === 'SUCCESS' ? '✓' : state === 'FAILURE' ? 'X' : '•';
      console.log(`${symbol} [${r.id}] ${r.name} - ${state} (${r.head_branch})`);
      console.log(`   Event: ${r.event} | Triggered: ${r.created_at} | URL: ${r.html_url}`);
    }
  } catch (err) {
    console.error(`❌ Error listing workflow runs: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
