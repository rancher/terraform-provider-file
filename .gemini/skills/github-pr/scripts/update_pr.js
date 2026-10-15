#!/usr/bin/env node
import { getOctokit, getRepoDetails } from './auth.js';
import { findPR } from './find_pr.js';

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

/**
 * Parses command-line arguments for update_pr.js flexibly.
 * Supports:
 * - [pr_target, title, body]
 * - [pr_target, title]
 * - [title, body]
 * - [title]
 * @param {Array<string>} args
 * @returns {{prTarget?: string, title?: string, body?: string}}
 */
export function parseUpdateArgs(args) {
  if (!args || args.length === 0) {
    return {};
  }

  const isNum = (v) => /^#?\d+$/.test(String(v || '').trim());

  if (args.length === 1) {
    return { prTarget: 'current', title: args[0], body: undefined };
  }

  if (args.length === 2) {
    if (args[0] === 'current' || isNum(args[0])) {
      return { prTarget: args[0], title: args[1], body: undefined };
    }
    return { prTarget: 'current', title: args[0], body: args[1] };
  }

  return {
    prTarget: args[0],
    title: args[1],
    body: args.slice(2).join(' '),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { prTarget, title, body } = parseUpdateArgs(args);

  if (title === undefined && body === undefined) {
    console.error('Usage: update_pr.js [pr_number_or_current] <title_or_empty> [body_or_empty]');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  let prNumber;
  try {
    const pr = await findPR({
      octokit,
      owner,
      repo,
      target: prTarget === 'current' ? undefined : prTarget,
    });
    prNumber = pr.number;
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }

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
