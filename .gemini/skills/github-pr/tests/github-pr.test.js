import assert from 'node:assert';
import test from 'node:test';
import { replyComment } from '../scripts/reply-comment.js';
import { resolveThread } from '../scripts/resolve_comment.js';
import { updatePR } from '../scripts/update_pr.js';

test('github-pr skill - replyComment unit tests', async (t) => {
  await t.test('rejects empty commentId or body', async () => {
    await assert.rejects(async () => {
      await replyComment({
        octokit: {},
        owner: 'rancher',
        repo: 'terraform-provider-file',
        prNumber: 123,
        commentId: null,
        body: 'hello',
      });
    }, /Missing comment ID/);

    await assert.rejects(async () => {
      await replyComment({
        octokit: {},
        owner: 'rancher',
        repo: 'terraform-provider-file',
        prNumber: 123,
        commentId: 456,
        body: '',
      });
    }, /cannot be empty/);
  });

  await t.test('calls createReplyForReviewComment successfully', async () => {
    let captured = null;
    const mockOctokit = {
      rest: {
        pulls: {
          createReplyForReviewComment: async (params) => {
            captured = params;
            return { data: { id: 789, body: params.body } };
          },
        },
      },
    };

    const result = await replyComment({
      octokit: mockOctokit,
      owner: 'testowner',
      repo: 'testrepo',
      prNumber: 42,
      commentId: 100,
      body: 'Thanks for the review!',
    });

    assert.strictEqual(result.type, 'review_reply');
    assert.deepStrictEqual(captured, {
      owner: 'testowner',
      repo: 'testrepo',
      pull_number: 42,
      comment_id: 100,
      body: 'Thanks for the review!',
    });
  });

  await t.test('falls back to issue comment when review comment gives 404', async () => {
    let capturedIssueComment = null;
    const mockOctokit = {
      rest: {
        pulls: {
          createReplyForReviewComment: async () => {
            const err = new Error('Not found');
            err.status = 404;
            throw err;
          },
        },
        issues: {
          createComment: async (params) => {
            capturedIssueComment = params;
            return { data: { id: 999 } };
          },
        },
      },
    };

    const result = await replyComment({
      octokit: mockOctokit,
      owner: 'testowner',
      repo: 'testrepo',
      prNumber: 42,
      commentId: 100,
      body: 'General conversation reply',
    });

    assert.strictEqual(result.type, 'issue_reply');
    assert.match(capturedIssueComment.body, /> In reply to comment #100/);
    assert.match(capturedIssueComment.body, /General conversation reply/);
  });
});

test('github-pr skill - updatePR unit tests', async (t) => {
  await t.test('throws when neither title nor body is provided', async () => {
    await assert.rejects(async () => {
      await updatePR({
        octokit: {},
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
      });
    }, /No title or body updates provided/);
  });

  await t.test('calls octokit.rest.pulls.update with supplied fields', async () => {
    let captured = null;
    const mockOctokit = {
      rest: {
        pulls: {
          update: async (params) => {
            captured = params;
            return { data: { number: params.pull_number, title: params.title } };
          },
        },
      },
    };

    const updated = await updatePR({
      octokit: mockOctokit,
      owner: 'testowner',
      repo: 'testrepo',
      prNumber: 99,
      title: 'New PR Title',
    });

    assert.strictEqual(updated.title, 'New PR Title');
    assert.strictEqual(captured.title, 'New PR Title');
    assert.strictEqual(captured.pull_number, 99);
  });
});

test('github-pr skill - resolveThread unit tests', async (t) => {
  await t.test('calls octokit.graphql with threadId', async () => {
    let capturedQuery = null;
    let capturedVars = null;

    const mockOctokit = {
      graphql: async (query, vars) => {
        capturedQuery = query;
        capturedVars = vars;
        return {
          resolveReviewThread: {
            thread: { id: vars.threadId, isResolved: true },
          },
        };
      },
    };

    const thread = await resolveThread({
      octokit: mockOctokit,
      threadId: 'PRRT_kwDOAbc123',
    });

    assert.strictEqual(thread.id, 'PRRT_kwDOAbc123');
    assert.strictEqual(thread.isResolved, true);
    assert.match(capturedQuery, /resolveReviewThread/);
    assert.strictEqual(capturedVars.threadId, 'PRRT_kwDOAbc123');
  });
});
