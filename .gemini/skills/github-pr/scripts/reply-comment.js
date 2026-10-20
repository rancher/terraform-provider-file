#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';
import { findPR } from './find_pr.js';

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

  const numericCommentId = typeof commentId === 'string' ? parseInt(commentId.replace(/^#/, ''), 10) : commentId;
  let targetPrNumber = prNumber;

  if (!targetPrNumber && owner && repo && octokit.rest?.pulls?.getReviewComment) {
    try {
      const { data: comment } = await octokit.rest.pulls.getReviewComment({
        owner,
        repo,
        comment_id: numericCommentId,
      });
      if (comment.pull_request_url) {
        const parts = comment.pull_request_url.split('/');
        const extractedPr = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(extractedPr)) {
          targetPrNumber = extractedPr;
        }
      }
    } catch {
      if (octokit.rest?.issues?.getComment) {
        try {
          const { data: issueComment } = await octokit.rest.issues.getComment({
            owner,
            repo,
            comment_id: numericCommentId,
          });
          if (issueComment.issue_url) {
            const parts = issueComment.issue_url.split('/');
            const extractedPr = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(extractedPr)) {
              targetPrNumber = extractedPr;
            }
          }
        } catch {
          // Proceed to normal flow if lookup fails
        }
      }
    }
  }

  try {
    // Attempt reply to inline review comment thread
    const { data } = await octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: targetPrNumber,
      comment_id: numericCommentId,
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
          comment_id: numericCommentId,
        });

        const { data } = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: targetPrNumber,
          body: `> In reply to comment #${numericCommentId}\n\n${body}`,
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
  let prTarget;
  let commentId;
  let body;

  const isUrl = (v) => /\/pull\/(\d+)/.test(String(v || ''));
  const isNum = (v) => /^#?\d+$/.test(String(v || '').trim()) || isUrl(v);
  const toNum = (v) => {
    const s = String(v).trim();
    const urlMatch = s.match(/\/pull\/(\d+)/);
    if (urlMatch) return parseInt(urlMatch[1], 10);
    return parseInt(s.replace(/^#/, ''), 10);
  };
  const isRef = (v) => isNum(v) || String(v || '').startsWith('PRRT_');
  const toRef = (v) => (String(v || '').startsWith('PRRT_') ? String(v).trim() : toNum(v));

  let cleanArgs = [...args];
  let explicitBody = null;
  const mIndex = cleanArgs.findIndex((a) => a === '-m' || a === '--body');
  if (mIndex !== -1 && mIndex + 1 < cleanArgs.length) {
    explicitBody = cleanArgs.slice(mIndex + 1).join(' ');
    cleanArgs = cleanArgs.slice(0, mIndex);
  }

  if (explicitBody !== null) {
    body = explicitBody;
    if (cleanArgs.length === 1 && isRef(cleanArgs[0])) {
      commentId = toRef(cleanArgs[0]);
    } else if (cleanArgs.length >= 2) {
      const c0 = cleanArgs[0];
      const c1 = cleanArgs[1];
      if (c0 === 'current' && isRef(c1)) {
        commentId = toRef(c1);
      } else if (isRef(c0) && c1 === 'current') {
        commentId = toRef(c0);
      } else if (isNum(c0) && isNum(c1)) {
        const n0 = toNum(c0);
        const n1 = toNum(c1);
        if (isUrl(c0) && !isUrl(c1)) {
          prNumber = n0;
          commentId = n1;
        } else if (isUrl(c1) && !isUrl(c0)) {
          prNumber = n1;
          commentId = n0;
        } else if (n0 > n1) {
          commentId = n0;
          prNumber = n1;
        } else {
          prNumber = n0;
          commentId = n1;
        }
      } else if (String(c0).startsWith('PRRT_')) {
        commentId = String(c0).trim();
        prNumber = isNum(c1) ? toNum(c1) : undefined;
      } else if (String(c1).startsWith('PRRT_')) {
        commentId = String(c1).trim();
        prNumber = isNum(c0) ? toNum(c0) : undefined;
      } else if (!isRef(c0) && isRef(c1)) {
        prTarget = c0;
        commentId = toRef(c1);
        prNumber = isNum(c0) ? toNum(c0) : undefined;
      } else if (isRef(c0)) {
        commentId = toRef(c0);
        prNumber = isNum(c1) ? toNum(c1) : undefined;
      }
    }
    const res = { prNumber, commentId, body };
    if (prTarget !== undefined && !isNum(prTarget) && prTarget !== 'current') {
      res.prTarget = prTarget;
    }
    return res;
  }

  if (args.length === 2) {
    if (isRef(args[0])) {
      commentId = toRef(args[0]);
      body = args[1];
    }
  } else if (args.length >= 3) {
    const arg0 = args[0];
    const arg1 = args[1];
    const lastArg = args[args.length - 1];

    if (String(arg0).startsWith('PRRT_') && (isNum(arg1) || arg1 === 'current')) {
      commentId = String(arg0).trim();
      prNumber = arg1 === 'current' ? undefined : toNum(arg1);
      body = args.slice(2).join(' ');
    } else if (String(arg1).startsWith('PRRT_') && (isNum(arg0) || arg0 === 'current')) {
      commentId = String(arg1).trim();
      prNumber = arg0 === 'current' ? undefined : toNum(arg0);
      body = args.slice(2).join(' ');
    } else if (isRef(arg0) && arg1 === 'current') {
      commentId = toRef(arg0);
      prNumber = undefined;
      body = args.slice(2).join(' ');
    } else if (arg0 === 'current' && isRef(arg1)) {
      commentId = toRef(arg1);
      prNumber = undefined;
      body = args.slice(2).join(' ');
    } else if (isRef(arg0) && String(arg1).startsWith('#') && !String(arg0).startsWith('#')) {
      commentId = toRef(arg0);
      prNumber = toNum(arg1);
      body = args.slice(2).join(' ');
    } else if (String(arg0).startsWith('#') && !String(arg1).startsWith('#') && isRef(arg1)) {
      prNumber = toNum(arg0);
      commentId = toRef(arg1);
      body = args.slice(2).join(' ');
    } else if (isNum(arg0) && isNum(arg1)) {
      const n0 = toNum(arg0);
      const n1 = toNum(arg1);
      if (isUrl(arg0) && !isUrl(arg1)) {
        prNumber = n0;
        commentId = n1;
      } else if (isUrl(arg1) && !isUrl(arg0)) {
        prNumber = n1;
        commentId = n0;
      } else if (n0 > n1) {
        commentId = n0;
        prNumber = n1;
      } else {
        prNumber = n0;
        commentId = n1;
      }
      body = args.slice(2).join(' ');
    } else if (!isRef(arg0) && isRef(arg1)) {
      prTarget = arg0;
      commentId = toRef(arg1);
      prNumber = isNum(arg0) ? toNum(arg0) : undefined;
      body = args.slice(2).join(' ');
    } else if (isRef(arg0) && (isNum(lastArg) || lastArg === 'current')) {
      commentId = toRef(arg0);
      body = args.slice(1, -1).join(' ');
      prNumber = lastArg === 'current' ? undefined : toNum(lastArg);
    } else if (isRef(arg0)) {
      commentId = toRef(arg0);
      body = args.slice(1).join(' ');
    }
  }

  const res = { prNumber, commentId, body };
  if (prTarget !== undefined && !isNum(prTarget) && prTarget !== 'current') {
    res.prTarget = prTarget;
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const { prNumber: parsedPr, prTarget, commentId, body } = parseReplyArgs(args);
  let prNumber = parsedPr;

  if (!commentId || !body) {
    console.error('Usage: reply-comment.js <comment_id_or_thread_id> <body> [pr_number_or_current]');
    console.error('   or: reply-comment.js [pr_number_or_current] <comment_id_or_thread_id> <body>');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  if ((!prNumber || isNaN(prNumber)) && !String(commentId).startsWith('PRRT_')) {
    if (prTarget && prTarget !== 'current') {
      try {
        const pr = await findPR({ octokit, owner, repo, target: prTarget });
        prNumber = pr?.number;
      } catch {
        // Fall back to current branch or comment lookup
      }
    }
    if (!prNumber) {
      prNumber = await getCurrentPRNumber(octokit, { owner, repo });
    }
  }

  if ((!prNumber || isNaN(prNumber)) && !String(commentId).startsWith('PRRT_')) {
    const numericCommentId = typeof commentId === 'string' ? parseInt(commentId.replace(/^#/, ''), 10) : commentId;
    try {
      const { data: comment } = await octokit.rest.pulls.getReviewComment({
        owner,
        repo,
        comment_id: numericCommentId,
      });
      if (comment.pull_request_url) {
        const parts = comment.pull_request_url.split('/');
        const extractedPr = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(extractedPr)) {
          prNumber = extractedPr;
        }
      }
    } catch {
      try {
        const { data: issueComment } = await octokit.rest.issues.getComment({
          owner,
          repo,
          comment_id: numericCommentId,
        });
        if (issueComment.issue_url) {
          const parts = issueComment.issue_url.split('/');
          const extractedPr = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(extractedPr)) {
            prNumber = extractedPr;
          }
        }
      } catch {
        // Ignore if not an issue comment
      }
    }
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
