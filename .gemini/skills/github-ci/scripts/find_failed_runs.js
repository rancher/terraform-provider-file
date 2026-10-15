#!/usr/bin/env node
import { getCurrentBranch, getOctokit, getRepoDetails } from './auth.js';
import { listRuns } from './list_runs.js';

/**
 * Finds failed workflow runs.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} [params.branch]
 * @param {number} [params.limit=10]
 * @returns {Promise<Array>} Failed runs
 */
export async function findFailedRuns({ octokit, owner, repo, branch, limit = 10 }) {
  return listRuns({
    octokit,
    owner,
    repo,
    branch,
    limit,
    status: 'failure',
  });
}

async function main() {
  const branchArg = process.argv[2];
  const limitArg = process.argv[3];

  let branch = branchArg;
  if (!branch) {
    branch = await getCurrentBranch();
  }

  const limit = limitArg ? parseInt(limitArg, 10) : 10;
  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const runs = await findFailedRuns({ octokit, owner, repo, branch, limit });
    console.log(`=== Failed Workflow Runs for ${owner}/${repo} (Branch: ${branch || 'all'}) ===\n`);
    if (runs.length === 0) {
      console.log('No failed workflow runs found.');
      return;
    }

    for (const r of runs) {
      console.log(`X [${r.id}] ${r.name} (${r.head_branch})`);
      console.log(`   Conclusion: ${r.conclusion} | Event: ${r.event} | Triggered: ${r.created_at}`);
      console.log(`   URL: ${r.html_url}`);
    }
  } catch (err) {
    console.error(`❌ Error finding failed workflow runs: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
