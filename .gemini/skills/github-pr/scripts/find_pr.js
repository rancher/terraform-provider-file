#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';

/**
 * Fetches pull request details via Octokit.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} [params.target] - PR number or branch name
 * @returns {Promise<object>} PR data
 */
export async function findPR({ octokit, owner, repo, target }) {
  let pullNumber = null;

  if (target && !isNaN(parseInt(target, 10))) {
    pullNumber = parseInt(target, 10);
  } else if (target) {
    // Search by head branch
    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${target}`,
      state: 'all',
      per_page: 1,
    });
    if (pulls.length > 0) {
      pullNumber = pulls[0].number;
    } else {
      throw new Error(`No pull request found for branch '${target}' in ${owner}/${repo}.`);
    }
  } else {
    pullNumber = await getCurrentPRNumber();
    if (!pullNumber) {
      throw new Error('No pull request target specified and no PR found for current branch.');
    }
  }

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return pr;
}

async function main() {
  const target = process.argv[2];
  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const pr = await findPR({ octokit, owner, repo, target });
    console.log(`=== Pull Request #${pr.number}: ${pr.title} ===`);
    console.log(`State:  ${pr.state.toUpperCase()}`);
    console.log(`Author: ${pr.user?.login}`);
    console.log(`Branch: ${pr.head.ref} -> ${pr.base.ref}`);
    console.log(`URL:    ${pr.html_url}`);
    console.log(`\n--- Description ---\n${pr.body || '(No description provided)'}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
