#!/usr/bin/env node
import { getOctokit } from './auth.js';

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
 * @param {string} params.threadId - GraphQL node ID starting with PRRT_
 * @returns {Promise<{id: string, isResolved: boolean}>}
 */
export async function resolveThread({ octokit, threadId }) {
  if (!threadId) {
    throw new Error('Missing thread ID.');
  }

  const response = await octokit.graphql(RESOLVE_THREAD_MUTATION, {
    threadId,
  });

  const thread = response.resolveReviewThread?.thread;
  if (!thread) {
    throw new Error(`Failed to resolve review thread ${threadId}.`);
  }

  return thread;
}

async function main() {
  const threadId = process.argv[2];
  if (!threadId) {
    console.error('Usage: resolve_comment.js <thread_id>');
    process.exit(1);
  }

  const octokit = await getOctokit();

  try {
    const thread = await resolveThread({ octokit, threadId });
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
