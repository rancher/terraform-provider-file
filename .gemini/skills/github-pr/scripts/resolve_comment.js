#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';
import { readComments } from './read_comments.js';

const RESOLVE_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}
`;

/**
 * Resolves an inline review thread on GitHub.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string|number} params.threadId - GraphQL node ID starting with PRRT_ or numeric comment ID
 * @param {string} [params.owner]
 * @param {string} [params.repo]
 * @param {number} [params.prNumber]
 * @returns {Promise<{id: string, isResolved: boolean}>}
 */
export async function resolveThread({ octokit, threadId, owner, repo, prNumber }) {
  if (!threadId) {
    throw new Error('Missing thread ID.');
  }

  let targetThreadId = String(threadId).trim();

  // If a numeric comment ID was provided (e.g. 1001 or #1001), find its matching review thread
  if (/^#?\d+$/.test(targetThreadId)) {
    const numericCommentId = parseInt(targetThreadId.replace(/^#/, ''), 10);
    if (!owner || !repo || !prNumber) {
      throw new Error(
        `Cannot resolve numeric comment ID #${numericCommentId} without owner, repo, and prNumber to locate thread.`,
      );
    }
    const { reviewThreads } = await readComments({ octokit, owner, repo, prNumber });
    const matchingThread = reviewThreads.find(
      (t) => t.id && t.comments?.nodes?.some((c) => c.databaseId === numericCommentId),
    );
    if (!matchingThread) {
      throw new Error(`No review thread found containing comment #${numericCommentId} on PR #${prNumber}.`);
    }
    targetThreadId = matchingThread.id;
  }

  const response = await octokit.graphql(RESOLVE_THREAD_MUTATION, {
    threadId: targetThreadId,
  });

  const thread = response.resolveReviewThread?.thread;
  if (!thread) {
    throw new Error(`Failed to resolve review thread ${targetThreadId}.`);
  }

  return thread;
}

async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  if (!arg1) {
    console.error('Usage: resolve_comment.js <thread_id_or_comment_id> [pr_number]');
    process.exit(1);
  }

  const octokit = await getOctokit();
  let owner;
  let repo;
  let prNumber;

  if (/^#?\d+$/.test(arg1)) {
    const details = await getRepoDetails();
    owner = details.owner;
    repo = details.repo;
    prNumber = arg2 ? parseInt(arg2.replace(/^#/, ''), 10) : await getCurrentPRNumber(octokit);
  }

  try {
    const thread = await resolveThread({ octokit, threadId: arg1, owner, repo, prNumber });
    console.log(
      `✅ Successfully resolved review thread ${thread.id} (Status: ${thread.isResolved ? 'RESOLVED' : 'UNRESOLVED'}).`,
    );
  } catch (err) {
    console.error(`❌ Error resolving thread: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
