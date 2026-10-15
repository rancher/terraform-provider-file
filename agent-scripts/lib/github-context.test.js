import assert from 'node:assert';
import test from 'node:test';
import { getPRComments } from './github-context.js';

test('github-context - getPRComments', async (t) => {
  await t.test('executes read_comments.js and returns formatted comments', async () => {
    const comments = await getPRComments(448);
    assert.strictEqual(typeof comments, 'string');
    assert.match(comments, /Comments for PR #448/);
  });
});
