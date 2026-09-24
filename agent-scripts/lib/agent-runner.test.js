import { TerminalQuotaError } from '@google/gemini-cli-core';
import assert from 'node:assert';
import { Buffer } from 'node:buffer';
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
  await t.test('identifies max_turns errors in standard strings and Error objects', () => {
    assert.strictEqual(isMaxTurnsError('turn limit reached'), true);
    assert.strictEqual(isMaxTurnsError('max_turns exceeded'), true);
    assert.strictEqual(isMaxTurnsError('max-turns-exceeded'), true);
    assert.strictEqual(isMaxTurnsError('turn-limit-reached'), true);
    assert.strictEqual(isMaxTurnsError('maximum turns reached'), true);
    assert.strictEqual(isMaxTurnsError(new Error('Agent exceeded maximum turns limit')), true);
    assert.strictEqual(isMaxTurnsError(new Error('Hit turn limit')), true);
  });

  await t.test('identifies max_turns when err.error is a string, object, or Error instance', () => {
    assert.strictEqual(isMaxTurnsError({ error: 'max_turns_exceeded' }), true);
    assert.strictEqual(isMaxTurnsError({ error: { code: 400, message: 'max_turns exceeded' } }), true);
    assert.strictEqual(isMaxTurnsError({ error: { code: 400, message: 'Invalid argument' } }), false);

    // Top-level message alongside nested error object (e.g. HTTP client error)
    assert.strictEqual(
      isMaxTurnsError({
        message: 'Request failed with status code 400',
        error: { code: 400, message: 'max_turns exceeded' },
      }),
      true,
    );

    // Empty message property with valid error property
    assert.strictEqual(isMaxTurnsError({ message: '', error: 'max_turns exceeded' }), true);

    // Error instance with attached nested plain object details
    const customErr = new Error('Request failed with status code 400');
    customErr.error = { message: 'maximum turns reached' };
    assert.strictEqual(isMaxTurnsError(customErr), true);

    // Nested Error instance attached to err.error (where Error properties are non-enumerable)
    const nestedErrInstance = new Error('Request failed with status code 400');
    nestedErrInstance.error = new Error('max_turns exceeded');
    assert.strictEqual(isMaxTurnsError(nestedErrInstance), true);

    const unrelatedNestedErr = new Error('Request failed with status code 400');
    unrelatedNestedErr.error = new Error('database connection lost');
    assert.strictEqual(isMaxTurnsError(unrelatedNestedErr), false);

    // Standard properties (message, reason) formatted as nested objects
    assert.strictEqual(isMaxTurnsError({ message: { text: 'max_turns exceeded' } }), true);
    assert.strictEqual(isMaxTurnsError({ reason: { details: 'turn limit reached' } }), true);
  });

  await t.test('identifies max_turns in chained errors via err.cause', () => {
    // Cause as an Error instance
    const causeErr = new Error('Agent execution failed', { cause: new Error('turn limit reached') });
    assert.strictEqual(isMaxTurnsError(causeErr), true);

    // Cause as a string
    const causeStringErr = new Error('Agent execution failed', { cause: 'maximum turns reached' });
    assert.strictEqual(isMaxTurnsError(causeStringErr), true);

    // Cause as a plain object with message
    const causeObjErr = new Error('Agent execution failed', { cause: { message: 'max_turns exceeded' } });
    assert.strictEqual(isMaxTurnsError(causeObjErr), true);

    // Unrelated cause
    const unrelatedCauseErr = new Error('Agent execution failed', { cause: new Error('network timeout') });
    assert.strictEqual(isMaxTurnsError(unrelatedCauseErr), false);
  });

  await t.test('identifies max_turns in HTTP response payloads (err.response.data) with circular references', () => {
    // Response data as nested object
    const httpLikeErr = new Error('Request failed with status code 400');
    httpLikeErr.response = {
      data: { error: { message: 'max_turns exceeded' } },
    };
    httpLikeErr.circularRef = httpLikeErr;
    assert.strictEqual(isMaxTurnsError(httpLikeErr), true);

    // Response body as nested object (e.g. fetch / got / octokit client error)
    const fetchLikeErr = new Error('HTTP 400 Bad Request');
    fetchLikeErr.response = {
      body: { error: { message: 'max_turns exceeded' } },
    };
    assert.strictEqual(isMaxTurnsError(fetchLikeErr), true);

    // Response body as raw string
    const fetchStringErr = new Error('HTTP 504 Gateway Timeout');
    fetchStringErr.response = { body: 'turn limit reached' };
    assert.strictEqual(isMaxTurnsError(fetchStringErr), true);

    // Response data as raw string
    const httpStringErr = new Error('Bad Request');
    httpStringErr.response = { data: 'Agent hit turn limit during processing' };
    httpStringErr.self = httpStringErr;
    assert.strictEqual(isMaxTurnsError(httpStringErr), true);

    // Response statusText matching turn limit (e.g. gateway error with empty body)
    const statusTextErr = new Error('Gateway Error');
    statusTextErr.response = { status: 504, statusText: 'Turn Limit Exceeded' };
    assert.strictEqual(isMaxTurnsError(statusTextErr), true);

    // Response as direct raw string
    const rawStringResponseErr = new Error('Gateway Error');
    rawStringResponseErr.response = '504 Gateway Error: turn limit reached';
    assert.strictEqual(isMaxTurnsError(rawStringResponseErr), true);

    // Response data as Buffer containing plain text
    const httpBufferTextErr = new Error('Gateway Error');
    httpBufferTextErr.response = { data: Buffer.from('Agent hit turn limit during processing') };
    assert.strictEqual(isMaxTurnsError(httpBufferTextErr), true);

    // Response data as Buffer containing JSON error object
    const httpBufferJsonErr = new Error('Bad Request');
    httpBufferJsonErr.response = {
      data: Buffer.from(JSON.stringify({ error: { message: 'max_turns exceeded' } })),
    };
    assert.strictEqual(isMaxTurnsError(httpBufferJsonErr), true);

    // Response data as Buffer containing unrelated error
    const httpBufferUnrelatedErr = new Error('Internal Error');
    httpBufferUnrelatedErr.response = {
      data: Buffer.from(JSON.stringify({ error: { message: 'Internal Server Error' } })),
    };
    assert.strictEqual(isMaxTurnsError(httpBufferUnrelatedErr), false);

    // Response data as Buffer containing ignored keys like config with turn mentions
    const httpBufferPromptIgnoredErr = new Error('Internal Error');
    httpBufferPromptIgnoredErr.response = {
      data: Buffer.from(
        JSON.stringify({
          config: { prompt: 'fix max_turns' },
          error: { message: 'Internal Server Error' },
        }),
      ),
    };
    assert.strictEqual(isMaxTurnsError(httpBufferPromptIgnoredErr), false);

    // Oversized buffer (>64KB) is skipped safely
    const oversizedBufferErr = new Error('Oversized Error');
    oversizedBufferErr.response = {
      data: Buffer.concat([Buffer.from('turn limit reached '), Buffer.alloc(65 * 1024, 0)]),
    };
    assert.strictEqual(isMaxTurnsError(oversizedBufferErr), false);

    // Non-Buffer typed arrays are safely ignored
    const typedArrayErr = new Error('Binary Error');
    typedArrayErr.response = { data: new Uint8Array([1, 2, 3]) };
    assert.strictEqual(isMaxTurnsError(typedArrayErr), false);

    // Unrelated HTTP error
    const unrelatedHttpErr = new Error('Request failed with status code 500');
    unrelatedHttpErr.response = { data: { error: 'Internal Server Error' } };
    assert.strictEqual(isMaxTurnsError(unrelatedHttpErr), false);
  });

  await t.test('handles non-error objects, null, undefined, and primitives safely', () => {
    assert.strictEqual(isMaxTurnsError(null), false);
    assert.strictEqual(isMaxTurnsError(undefined), false);
    assert.strictEqual(isMaxTurnsError(''), false);
    assert.strictEqual(isMaxTurnsError(123), false);
    assert.strictEqual(isMaxTurnsError(new Error('Connection reset')), false);

    // Object with arbitrary property matching turn keywords
    assert.strictEqual(isMaxTurnsError({ details: 'turn limit hit' }), true);
    assert.strictEqual(isMaxTurnsError({ details: 'other error' }), false);
  });

  await t.test('identifies max_turns when specified via custom error name', () => {
    const customNameErr = new Error('Execution halted prematurely');
    customNameErr.name = 'MaxTurnsExceededError';
    assert.strictEqual(isMaxTurnsError(customNameErr), true);

    const maxTurnsNameErr = new Error('');
    maxTurnsNameErr.name = 'MaxTurnsError';
    assert.strictEqual(isMaxTurnsError(maxTurnsNameErr), true);
  });

  await t.test('traverses deeply chained causes and array details', () => {
    const deepCauseErr = new Error('Level 1', {
      cause: new Error('Level 2', {
        cause: new Error('turn limit reached'),
      }),
    });
    assert.strictEqual(isMaxTurnsError(deepCauseErr), true);

    const arrayDetailsErr = new Error('Resource exhausted');
    arrayDetailsErr.details = [{ message: 'max_turns exceeded' }];
    assert.strictEqual(isMaxTurnsError(arrayDetailsErr), true);
  });

  await t.test('avoids false positives when request payload or client config mentions turn keywords', () => {
    const httpErrWithPrompt = new Error('Request failed with status code 500');
    httpErrWithPrompt.config = {
      data: JSON.stringify({ prompt: 'Please fix the max_turns and turn limit bug in agent-runner' }),
    };
    httpErrWithPrompt.request = {
      body: 'turn limit prompt content',
    };
    httpErrWithPrompt.response = {
      status: 500,
      data: { error: { message: 'Internal Server Error' } },
    };
    assert.strictEqual(isMaxTurnsError(httpErrWithPrompt), false);
  });

  await t.test('identifies max_turns when signaled via property keys and snake_case properties', () => {
    assert.strictEqual(isMaxTurnsError({ max_turns: true }), true);
    assert.strictEqual(isMaxTurnsError({ max_turns_exceeded: true }), true);
    assert.strictEqual(isMaxTurnsError({ turn_limit: 10 }), true);
    assert.strictEqual(isMaxTurnsError({ turn_limit_exceeded: true }), true);
    assert.strictEqual(isMaxTurnsError({ details: { max_turns: 5 } }), true);

    // Explicit false boolean flags and falsy/zero values should not trigger false positives
    assert.strictEqual(isMaxTurnsError({ max_turns_exceeded: false }), false);
    assert.strictEqual(isMaxTurnsError({ turn_limit_reached: false }), false);
    assert.strictEqual(isMaxTurnsError({ status: 'OK', details: { max_turns: false } }), false);
    assert.strictEqual(isMaxTurnsError({ max_turns: 0 }), false);
    assert.strictEqual(isMaxTurnsError({ turn_limit: 0 }), false);
    assert.strictEqual(isMaxTurnsError({ max_turns: null }), false);
    assert.strictEqual(isMaxTurnsError({ details: { max_turns: null } }), false);
  });

  await t.test('identifies max_turns with singular phrasing variant', () => {
    assert.strictEqual(isMaxTurnsError('max turn reached'), true);
    assert.strictEqual(isMaxTurnsError(new Error('Hit max turn count limit')), true);
    assert.strictEqual(isMaxTurnsError('exceeded maximum turn count'), true);
    assert.strictEqual(isMaxTurnsError(new Error('Agent reached maximum turn threshold')), true);
  });

  await t.test('handles throwing property getters gracefully without uncaught exceptions', () => {
    const throwingErr = {
      get message() {
        throw new Error('Exploding getter');
      },
      get response() {
        throw new Error('Exploding response');
      },
      error: 'max_turns exceeded',
    };
    assert.strictEqual(isMaxTurnsError(throwingErr), true);

    const throwingArbitraryGetterErr = {
      get brokenProp() {
        throw new Error('Exploding arbitrary getter');
      },
      customTurnMessage: 'turn limit reached',
    };
    assert.strictEqual(isMaxTurnsError(throwingArbitraryGetterErr), true);

    const completelyBrokenErr = {
      get message() {
        throw new Error('Exploding getter');
      },
      get details() {
        throw new Error('Exploding details');
      },
    };
    assert.strictEqual(isMaxTurnsError(completelyBrokenErr), false);
  });

  await t.test('avoids false positives for return limits, turnaround times, and adjacent keys', () => {
    // Return limit mentions in query and pagination errors
    assert.strictEqual(isMaxTurnsError('return limit reached'), false);
    assert.strictEqual(isMaxTurnsError('Query return limit exceeded'), false);
    assert.strictEqual(isMaxTurnsError('Failed to return limit parameter'), false);
    assert.strictEqual(isMaxTurnsError('Invalid return_limit specified'), false);
    assert.strictEqual(
      isMaxTurnsError(new Error('API error: parameter return_limit must be a positive integer')),
      false,
    );
    assert.strictEqual(isMaxTurnsError({ return_limit: 50 }), false);

    // Turnaround and turnout wording
    assert.strictEqual(isMaxTurnsError('Maximum turnaround time exceeded'), false);
    assert.strictEqual(isMaxTurnsError('Max turnaround time reached'), false);
    assert.strictEqual(isMaxTurnsError(new Error('Request exceeded maximum turnaround SLA')), false);
    assert.strictEqual(isMaxTurnsError('Max turnout reached'), false);

    // Adjacent property keys and values that could accidentally form phrases if joined indiscriminately
    assert.strictEqual(isMaxTurnsError({ turn: 1, limit: 100 }), false);
    assert.strictEqual(isMaxTurnsError({ max: 10, turn: 2 }), false);
    assert.strictEqual(isMaxTurnsError({ return: 1, limit: 10 }), false);
    assert.strictEqual(isMaxTurnsError({ prefix: 'max', suffix: 'turn' }), false);
    assert.strictEqual(isMaxTurnsError({ header: 'turn', detail: 'limit' }), false);
    assert.strictEqual(isMaxTurnsError({ action: 'turn to retry', name: 'max' }), false);

    // Configuration and context containers on unrelated errors should not trigger false positives
    const errWithOptions = new Error('Gateway timeout');
    errWithOptions.options = { max_turns: 25 };
    assert.strictEqual(isMaxTurnsError(errWithOptions), false);

    const errWithAgent = new Error('Database unreachable');
    errWithAgent.agent = { max_turns: 25 };
    assert.strictEqual(isMaxTurnsError(errWithAgent), false);

    const errWithParams = new Error('Service unavailable');
    errWithParams.params = { turn_limit: 10 };
    assert.strictEqual(isMaxTurnsError(errWithParams), false);
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
