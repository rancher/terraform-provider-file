#!/usr/bin/env node
import { getOctokit, getRepoDetails } from './auth.js';
import { findPR } from './find_pr.js';

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $prNumber: Int!, $threadCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 50, after: $threadCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          comments(first: 50) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              databaseId
              author {
                login
              }
              body
              path
              line
              originalLine
            }
          }
        }
      }
    }
  }
}
`;

const THREAD_COMMENTS_QUERY = `
query($threadId: ID!, $commentCursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 50, after: $commentCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          databaseId
          author {
            login
          }
          body
          path
          line
          originalLine
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
  // 1. Fetch conversation comments (paginated)
  let conversationComments = [];
  if (octokit.paginate && octokit.rest?.issues?.listComments) {
    conversationComments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
  } else if (octokit.rest?.issues?.listComments) {
    const res = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
    conversationComments = res.data || [];
  }

  // 2. Fetch review threads via GraphQL with cursor pagination
  const reviewThreads = [];
  try {
    let threadCursor = null;
    let hasNextThreadPage = true;

    while (hasNextThreadPage) {
      const gqlRes = await octokit.graphql(REVIEW_THREADS_QUERY, {
        owner,
        repo,
        prNumber,
        threadCursor,
      });

      const threadConnection = gqlRes.repository?.pullRequest?.reviewThreads;
      const threads = threadConnection?.nodes || [];

      for (const thread of threads) {
        let commentCursor = thread.comments?.pageInfo?.endCursor;
        let hasNextCommentPage = thread.comments?.pageInfo?.hasNextPage;

        while (hasNextCommentPage) {
          const commentRes = await octokit.graphql(THREAD_COMMENTS_QUERY, {
            threadId: thread.id,
            commentCursor,
          });
          const commentConnection = commentRes.node?.comments;
          const moreComments = commentConnection?.nodes || [];
          if (moreComments.length > 0) {
            thread.comments.nodes.push(...moreComments);
          }
          hasNextCommentPage = commentConnection?.pageInfo?.hasNextPage || false;
          commentCursor = commentConnection?.pageInfo?.endCursor;
        }

        reviewThreads.push(thread);
      }

      hasNextThreadPage = threadConnection?.pageInfo?.hasNextPage || false;
      threadCursor = threadConnection?.pageInfo?.endCursor;
    }
  } catch {
    // If GraphQL query fails, fallback to REST review comments
    const restReviewComments = octokit.paginate
      ? await octokit.paginate(octokit.rest.pulls.listReviewComments, {
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        })
      : (
          await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100,
          })
        ).data || [];

    for (const c of restReviewComments) {
      reviewThreads.push({
        id: null,
        isResolved: false,
        isResolvable: false,
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
      });
    }
  }

  return { conversationComments, reviewThreads };
}

async function main() {
  const argTarget = process.argv[2];
  const { owner, repo } = await getRepoDetails();
  const octokit = await getOctokit();

  let prNumber;
  try {
    const pr = await findPR({
      octokit,
      owner,
      repo,
      target: argTarget === 'current' ? undefined : argTarget,
    });
    prNumber = pr.number;
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }

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
        if (thread.id) {
          const status = thread.isResolved ? 'RESOLVED' : 'UNRESOLVED';
          console.log(`\n[Thread ID: ${thread.id}] Status: ${status}`);
        } else {
          console.log('\n[Review Comment (REST Fallback - Not resolvable via GraphQL)]');
        }
        for (const c of thread.comments.nodes || []) {
          const lineNum = c.line || c.originalLine || '?';
          console.log(`  Comment #${c.databaseId} by @${c.author?.login} on ${c.path}:${lineNum}:`);
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
