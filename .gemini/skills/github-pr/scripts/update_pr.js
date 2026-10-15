#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';

/**
 * Updates a pull request's title and/or body.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string} [params.title]
 * @param {string} [params.body]
 * @returns {Promise<object>}
 */
export async function updatePR({ octokit, owner, repo, prNumber, title, body }) {
  const updatePayload = {
    owner,
    repo,
    pull_number: prNumber,
  };

  let hasUpdate = false;
  if (title !== undefined && title !== null && title !== '') {
    updatePayload.title = title;
    hasUpdate = true;
  }
  if (body !== undefined && body !== null && body !== '') {
    updatePayload.body = body;
    hasUpdate = true;
  }

  if (!hasUpdate) {
    throw new Error('No title or body updates provided.');
  }

  const { data } = await octokit.rest.pulls.update(updatePayload);
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: update_pr.js [pr_number_or_current] <title_or_empty> <body_or_empty>');
    process.exit(1);
  }

  let prTarget = args[0];
  let title = args[1];
  let body = args[2] || '';

  let prNumber = null;
  if (!prTarget || prTarget === 'current') {
    prNumber = await getCurrentPRNumber();
  } else if (!isNaN(parseInt(prTarget, 10))) {
    prNumber = parseInt(prTarget, 10);
  }

  if (!prNumber) {
    console.error('❌ Error: Could not determine target PR number.');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const updated = await updatePR({
      octokit,
      owner,
      repo,
      prNumber,
      title,
      body,
    });
    console.log(`✅ Successfully updated PR #${updated.number}: "${updated.title}"`);
  } catch (err) {
    console.error(`❌ Error updating PR: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
