#!/usr/bin/env node
import { getCurrentPRNumber, getOctokit, getRepoDetails } from './auth.js';

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 10) {
            nodes {
              databaseId
              author {
                login
              }
              body
              path
              line
            }
          }
        }
      }
    }
  }
}
`;

/**
 * Reads all conversation and review comments for a PR.
 * @param {object} params
 * @param {import('octokit').Octokit} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @returns {Promise<{conversationComments: Array, reviewThreads: Array}>}
 */
export async function readComments({ octokit, owner, repo, prNumber }) {
  // 1. Fetch conversation comments
  const { data: conversationComments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  // 2. Fetch review threads via GraphQL
  let reviewThreads = [];
  try {
    const gqlRes = await octokit.graphql(REVIEW_THREADS_QUERY, {
      owner,
      repo,
      prNumber,
    });
    reviewThreads = gqlRes.repository?.pullRequest?.reviewThreads?.nodes || [];
  } catch (err) {
    // If GraphQL query fails, fallback to REST review comments
    const { data: restReviewComments } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    reviewThreads = restReviewComments.map((c) => ({
      id: c.node_id,
      isResolved: false,
      comments: {
        nodes: [
          {
            databaseId: c.id,
            author: { login: c.user?.login },
            body: c.body,
            path: c.path,
            line: c.line || c.original_line,
          },
        ],
      },
    }));
  }

  return { conversationComments, reviewThreads };
}

async function main() {
  const argTarget = process.argv[2];
  let prNumber = argTarget ? parseInt(argTarget, 10) : null;

  if (!prNumber || isNaN(prNumber)) {
    prNumber = await getCurrentPRNumber();
  }

  if (!prNumber) {
    console.error('❌ Error: Could not determine pull request number.');
    process.exit(1);
  }

  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  try {
    const { conversationComments, reviewThreads } = await readComments({
      octokit,
      owner,
      repo,
      prNumber,
    });

    console.log(`=== Comments for PR #${prNumber} in ${owner}/${repo} ===\n`);

    console.log(`--- Conversation Comments (${conversationComments.length}) ---`);
    if (conversationComments.length === 0) {
      console.log('No general conversation comments found.');
    } else {
      for (const comment of conversationComments) {
        console.log(`\n[Comment #${comment.id}] @${comment.user?.login}:`);
        console.log(comment.body);
      }
    }

    console.log(`\n--- Review Comment Threads (${reviewThreads.length}) ---`);
    if (reviewThreads.length === 0) {
      console.log('No review threads found.');
    } else {
      for (const thread of reviewThreads) {
        const status = thread.isResolved ? 'RESOLVED' : 'UNRESOLVED';
        console.log(`\n[Thread ID: ${thread.id}] Status: ${status}`);
        for (const c of thread.comments.nodes || []) {
          console.log(`  Comment #${c.databaseId} by @${c.author?.login} on ${c.path}:${c.line || '?'}:`);
          console.log(`    ${c.body.replace(/\n/g, '\n    ')}`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error fetching comments: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
