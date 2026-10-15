#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';
import { replyComment } from './reply-comment.js';

/**
 * Adds a general comment or replies to an inline comment on a pull request.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string|number} [params.commentId] - numeric ID or 'general' / '0'
 * @param {string} params.body
 * @returns {Promise<object>}
 */
export async function respondComment({ octokit, owner, repo, prNumber, commentId, body }) {
  if (!body || !body.trim()) {
    throw new Error('Comment body cannot be empty.');
  }

  const isGeneral = !commentId || commentId === 'general' || commentId === '0' || commentId === 0;

  if (isGeneral) {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    return { type: 'general_comment', data };
  }

  return replyComment({
    octokit,
    owner,
    repo,
    prNumber,
    commentId: parseInt(commentId, 10),
    body,
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: respond_comment.js [pr_number_or_current] [comment_id_or_general] "body"');
    process.exit(1);
  }

  let prTarget = args[0];
  let commentId = args[1];
  let body = args[2];

  if (!body && commentId) {
    body = commentId;
    commentId = 'general';
  } else if (!body && !commentId) {
    body = prTarget;
    prTarget = 'current';
    commentId = 'general';
  }

  let prNumber = null;
  if (!prTarget || prTarget === 'current') {
    prNumber = await getCurrentPRNumber();
  } else {
    prNumber = parseInt(prTarget, 10);
  }

  if (!prNumber || isNaN(prNumber)) {
    console.error('❌ Error: Could not determine target PR number.');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const result = await respondComment({
      octokit,
      owner,
      repo,
      prNumber,
      commentId,
      body,
    });
    console.log(`✅ Successfully responded on PR #${prNumber} (${result.type}).`);
  } catch (err) {
    console.error(`❌ Error responding to PR comment: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
