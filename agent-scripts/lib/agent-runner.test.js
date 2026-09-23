import { TerminalQuotaError } from '@google/gemini-cli-core';
import assert from 'node:assert';
import path from 'node:path';
import test from 'node:test';
import { flushLogs, initializeAgentRunner, isMaxTurnsError } from './agent-runner.js';
import { promptTurnBudgetExhaustion } from './turn-accounting.js';

test('TerminalQuotaError massive delay interceptor patch', async (t) => {
  await t.test('keeps small retry delay and original message untouched', () => {
    const rawMsg = 'You have exhausted your capacity on this model. Your quota will reset after 5s.';
    const err = new TerminalQuotaError(rawMsg, { code: 429 }, 5, 'MODEL_CAPACITY_EXHAUSTED');

    assert.strictEqual(err.retryDelayMs, 5000);
    assert.strictEqual(err.message, rawMsg);
    assert.strictEqual(err.reason, 'MODEL_CAPACITY_EXHAUSTED');
  });

  await t.test('censors message and reason when retry delay is massive (> 5 minutes)', () => {
    const rawMsg = 'You have exhausted your capacity on this model. Your quota will reset after 12h53m47s.';
    const err = new TerminalQuotaError(rawMsg, { code: 429 }, 46427, 'MODEL_CAPACITY_EXHAUSTED');

    assert.strictEqual(err.retryDelayMs, 46427000);
    assert.match(err.message, /exhausted capacity \(immediate fallback\)/);
    assert.doesNotMatch(err.message, /exhausted your capacity/);
    assert.strictEqual(err.reason, 'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK');
  });
});

test('isMaxTurnsError detection', async (t) => {
  await t.test('identifies max_turns errors in objects and strings', () => {
    assert.strictEqual(isMaxTurnsError({ error: 'max_turns_exceeded' }), true);
    assert.strictEqual(isMaxTurnsError(new Error('Agent exceeded maximum turns limit')), true);
    assert.strictEqual(isMaxTurnsError('turn limit reached'), true);
    assert.strictEqual(isMaxTurnsError(null), false);
    assert.strictEqual(isMaxTurnsError(undefined), false);
    assert.strictEqual(isMaxTurnsError(new Error('Connection reset')), false);
  });
});

test('promptTurnBudgetExhaustion caller readline reuse', async (t) => {
  await t.test('reuses caller readline interface without closing it', async () => {
    let closed = false;
    const fakeRl = {
      async question() {
        return 'continue';
      },
      close() {
        closed = true;
      },
    };
    const decision = await promptTurnBudgetExhaustion(5, 5, 5, null, { rl: fakeRl });
    assert.strictEqual(decision.shouldContinue, true);
    assert.strictEqual(decision.newBudget, 10);
    assert.strictEqual(closed, false, 'Caller readline interface must not be closed');
  });

  await t.test('aborts session when user responds stop via reused interface', async () => {
    let closed = false;
    let aborted = false;
    const fakeRl = {
      async question() {
        return 'stop';
      },
      close() {
        closed = true;
      },
    };
    const controller = {
      abort() {
        aborted = true;
      },
    };
    const decision = await promptTurnBudgetExhaustion(5, 5, 5, controller, { rl: fakeRl });
    assert.strictEqual(decision.shouldContinue, false);
    assert.strictEqual(aborted, true);
    assert.strictEqual(closed, false);
  });
});

test('agent-runner initialization and logging', async (t) => {
  await t.test('initializeAgentRunner loads configuration without errors and targets orchestrator.log', async () => {
    const config = await initializeAgentRunner();
    assert.ok(config.repoRoot);
    assert.ok(config.logPath);
    assert.ok(config.logPath.endsWith(path.join('agent-scripts', 'orchestrator.log')));
    assert.ok(config.models);
    assert.ok(config.models.pro);
    assert.ok(config.models.flash);
    assert.ok(config.models.flash_lite);
    await flushLogs();
    // Verify flushLogs is idempotent and safe to call when stream is already flushed
    await flushLogs();
  });
});
