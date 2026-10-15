#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';

/**
 * Replies directly to an inline review comment or issue comment.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {number} params.commentId
 * @param {string} params.body
 * @returns {Promise<object>}
 */
export async function replyComment({ octokit, owner, repo, prNumber, commentId, body }) {
  if (!commentId) {
    throw new Error('Missing comment ID.');
  }
  if (!body || !body.trim()) {
    throw new Error('Reply body cannot be empty.');
  }

  try {
    // Attempt reply to inline review comment thread
    const { data } = await octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      comment_id: commentId,
      body,
    });
    return { type: 'review_reply', data };
  } catch (err) {
    // If not an inline review comment, fallback to issue comment
    if (err.status === 404 || err.status === 422) {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `> In reply to comment #${commentId}\n\n${body}`,
      });
      return { type: 'issue_reply', data };
    }
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: reply-comment.js <comment_id> <body> [pr_number]');
    console.error('   or: reply-comment.js [pr_number] <comment_id> <body>');
    process.exit(1);
  }

  let prNumber = null;
  let commentId = null;
  let body = null;

  if (args.length >= 3) {
    if (!isNaN(parseInt(args[0], 10)) && !isNaN(parseInt(args[1], 10))) {
      prNumber = parseInt(args[0], 10);
      commentId = parseInt(args[1], 10);
      body = args.slice(2).join(' ');
    } else {
      commentId = parseInt(args[0], 10);
      body = args[1];
      prNumber = parseInt(args[2], 10);
    }
  } else {
    commentId = parseInt(args[0], 10);
    body = args[1];
  }

  if (!prNumber || isNaN(prNumber)) {
    prNumber = await getCurrentPRNumber();
  }

  if (!prNumber) {
    console.error('❌ Error: Could not determine target PR number.');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const result = await replyComment({
      octokit,
      owner,
      repo,
      prNumber,
      commentId,
      body,
    });
    console.log(`✅ Successfully replied to comment #${commentId} on PR #${prNumber} (${result.type}).`);
  } catch (err) {
    console.error(`❌ Error replying to comment: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
