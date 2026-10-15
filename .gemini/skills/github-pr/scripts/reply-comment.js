#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';

const ADD_THREAD_REPLY_MUTATION = `
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    comment {
      id
      databaseId
      body
    }
  }
}
`;

/**
 * Replies directly to an inline review comment, GraphQL review thread, or issue comment.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} [params.prNumber]
 * @param {number|string} params.commentId - Numeric comment ID or GraphQL Thread ID (PRRT_...)
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

  // If a GraphQL review thread ID is provided (e.g. PRRT_...), use addPullRequestReviewThreadReply mutation
  if (typeof commentId === 'string' && commentId.startsWith('PRRT_')) {
    const response = await octokit.graphql(ADD_THREAD_REPLY_MUTATION, {
      threadId: commentId,
      body,
    });
    const created = response.resolveReviewThread?.thread || response.addPullRequestReviewThreadReply?.comment;
    return { type: 'thread_reply', data: created };
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
    // If not a review comment (404 Not Found), verify if it is an issue comment
    if (err.status === 404) {
      try {
        await octokit.rest.issues.getComment({
          owner,
          repo,
          comment_id: commentId,
        });

        const { data } = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `> In reply to comment #${commentId}\n\n${body}`,
        });
        return { type: 'issue_reply', data };
      } catch {
        // Not a valid issue comment either; throw the original error
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Parses command-line arguments for reply-comment.js flexibly.
 * Supports:
 * - [comment_id, body]
 * - [comment_id, ...body_tokens]
 * - [pr_number, comment_id, ...body_tokens]
 * - [comment_id, ...body_tokens, pr_number]
 * @param {Array<string>} args
 * @returns {{commentId?: number|string, body?: string, prNumber?: number}}
 */
export function parseReplyArgs(args) {
  if (!args || args.length < 2) {
    return {};
  }

  let prNumber;
  let commentId;
  let body;

  const isNum = (v) => /^#?\d+$/.test(String(v || '').trim());
  const toNum = (v) => parseInt(String(v).trim().replace(/^#/, ''), 10);
  const isRef = (v) => isNum(v) || String(v || '').startsWith('PRRT_');
  const toRef = (v) => (String(v || '').startsWith('PRRT_') ? String(v).trim() : toNum(v));

  if (args.length === 2) {
    if (isRef(args[0])) {
      commentId = toRef(args[0]);
      body = args[1];
    }
  } else if (args.length >= 3) {
    if (isNum(args[0]) && isRef(args[1])) {
      prNumber = toNum(args[0]);
      commentId = toRef(args[1]);
      body = args.slice(2).join(' ');
    } else if (isRef(args[0]) && isNum(args[args.length - 1])) {
      commentId = toRef(args[0]);
      body = args.slice(1, -1).join(' ');
      prNumber = toNum(args[args.length - 1]);
    } else if (isRef(args[0])) {
      commentId = toRef(args[0]);
      body = args.slice(1).join(' ');
    }
  }

  return { prNumber, commentId, body };
}

async function main() {
  const args = process.argv.slice(2);
  const { prNumber: parsedPr, commentId, body } = parseReplyArgs(args);
  let prNumber = parsedPr;

  if (!commentId || !body) {
    console.error('Usage: reply-comment.js <comment_id_or_thread_id> <body> [pr_number]');
    console.error('   or: reply-comment.js [pr_number] <comment_id_or_thread_id> <body>');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  if ((!prNumber || isNaN(prNumber)) && !String(commentId).startsWith('PRRT_')) {
    prNumber = await getCurrentPRNumber(octokit);
  }

  if (!prNumber && !String(commentId).startsWith('PRRT_')) {
    console.error('❌ Error: Could not determine target PR number.');
    process.exit(1);
  }

  try {
    const result = await replyComment({
      octokit,
      owner,
      repo,
      prNumber,
      commentId,
      body,
    });
    const targetDesc = String(commentId).startsWith('PRRT_')
      ? `thread ${commentId}`
      : `comment #${commentId} on PR #${prNumber}`;
    console.log(`✅ Successfully replied to ${targetDesc} (${result.type}).`);
  } catch (err) {
    console.error(`❌ Error replying to comment: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
