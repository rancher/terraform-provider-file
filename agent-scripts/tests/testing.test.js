import assert from 'node:assert';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { runPreReviewTests } from '../testing.js';

test('testing.js: testing utility unit tests', async (t) => {
  await t.test('module stub validation', () => {
    assert.ok(true, 'Test execution scaffolded safely');
  });

  await t.test('runPreReviewTests: reports overall success when all steps pass', () => {
    let callCount = 0;
    const mockExec = () => {
      callCount++;
      return Buffer.from('mock success output');
    };

    const result = runPreReviewTests(mockExec);

    assert.strictEqual(result.success, true);
    assert.match(result.output, /=== PRE-REVIEW TESTING ===/);
    assert.match(result.output, /Running Full Workspace Lint/);
    assert.match(result.output, /Full workspace lint passed/);
    assert.match(result.output, /Running Full Workspace Tests/);
    assert.match(result.output, /Full workspace tests passed/);

    assert.strictEqual(callCount, 2);
  });

  await t.test('runPreReviewTests: continues executing remaining suites on failure', () => {
    const calls = [];
    const mockExec = (cmd) => {
      calls.push(cmd);
      if (cmd.includes('lint.sh all')) {
        const error = new Error('Lint failed');
        error.stdout = Buffer.from('lint stdout error');
        error.stderr = Buffer.from('lint stderr error');
        throw error;
      }
      return Buffer.from('mock success');
    };

    const result = runPreReviewTests(mockExec);

    assert.strictEqual(result.success, false);
    assert.match(result.failureOutput, /❌ Full workspace lint failed/);
    assert.match(result.failureOutput, /lint stdout error/);
    assert.match(result.failureOutput, /lint stderr error/);

    // Verify it still ran All steps even after lint failed
    assert.deepStrictEqual(calls, [
      'bash .github/workflows/scripts/lint.sh all',
      'bash .github/workflows/scripts/test.sh all',
    ]);
  });

  await t.test('runPreReviewTests: handles silent process-level errors (ENOENT)', () => {
    const mockExec = () => {
      const error = new Error('spawnSync make ENOENT');
      error.code = 'ENOENT';
      throw error;
    };

    const result = runPreReviewTests(mockExec);

    assert.strictEqual(result.success, false);
    assert.match(result.failureOutput, /Error Details: spawnSync make ENOENT/);
  });
});
