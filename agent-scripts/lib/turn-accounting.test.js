import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  bumpTurnCapacity,
  getMaxTurnsForModel,
  promptTurnBudgetExhaustion,
  requestHandoffSummary,
  TurnTracker,
} from './turn-accounting.js';

test('turn-accounting model limits', () => {
  assert.strictEqual(getMaxTurnsForModel('gemini-3.1-pro-preview'), 10);
  assert.strictEqual(getMaxTurnsForModel('gemini-3.5-flash'), 5);
  assert.strictEqual(getMaxTurnsForModel('gemini-3.1-flash-lite'), 2);
  assert.strictEqual(getMaxTurnsForModel('unknown-model'), 5);

  // Dynamic config support
  const dynamicModels = {
    pro: 'custom-pro-model',
    flash: 'custom-flash-model',
    flash_lite: 'custom-lite-model',
  };
  assert.strictEqual(getMaxTurnsForModel('custom-pro-model', dynamicModels), 10);
  assert.strictEqual(getMaxTurnsForModel('custom-flash-model', dynamicModels), 5);
  assert.strictEqual(getMaxTurnsForModel('custom-lite-model', dynamicModels), 2);
});

test('bumpTurnCapacity increments maxTurns across agent and session configurations', () => {
  const fakeAgent = { maxTurns: 5, config: { maxTurns: 5 } };
  const fakeSession = { config: { maxTurns: 5 } };

  bumpTurnCapacity(fakeAgent, fakeSession, 5);

  assert.strictEqual(fakeAgent.maxTurns, 10);
  assert.strictEqual(fakeAgent.config.maxTurns, 10);
  assert.strictEqual(fakeSession.config.maxTurns, 10);
});

test('promptTurnBudgetExhaustion extends budget when user enters continue', async () => {
  const mockInput = Readable.from(['continue\n']);
  const mockOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const result = await promptTurnBudgetExhaustion(5, 5, 5, null, { input: mockInput, output: mockOutput });
  assert.strictEqual(result.shouldContinue, true);
  assert.strictEqual(result.newBudget, 10);
});

test('promptTurnBudgetExhaustion aborts session when user enters stop', async () => {
  const mockInput = Readable.from(['stop\n']);
  const mockOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  let aborted = false;
  const controller = {
    abort() {
      aborted = true;
    },
  };
  const result = await promptTurnBudgetExhaustion(5, 5, 5, controller, { input: mockInput, output: mockOutput });
  assert.strictEqual(result.shouldContinue, false);
  assert.strictEqual(result.newBudget, 5);
  assert.strictEqual(aborted, true);
});

test('TurnTracker maintains step latches and records turns accurately', async () => {
  let aborted = false;
  const controller = {
    abort() {
      aborted = true;
    },
  };
  const logs = [];
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller,
    logger: (msg) => logs.push(msg),
  });

  // First content token increments turn
  await tracker.onContent();
  assert.strictEqual(tracker.count, 1);

  // Subsequent content chunks in same model turn should not increment turn count
  await tracker.onContent();
  assert.strictEqual(tracker.count, 1);

  // Receiving tool result resets latch
  tracker.onToolResult();

  // Tool call in next turn increments turn count
  await tracker.onToolCall('read_file');
  assert.strictEqual(tracker.count, 2);
  assert.strictEqual(aborted, false);
  assert.strictEqual(logs.length, 2);
  tracker.dispose();
});

test('TurnTracker binds to native session events when available', async () => {
  const emitter = new EventEmitter();
  const fakeSession = { events: emitter };
  const logs = [];
  const tracker = new TurnTracker({
    maxTurns: 3,
    controller: { abort() {} },
    session: fakeSession,
    logger: (msg) => logs.push(msg),
  });

  assert.strictEqual(tracker.hasSessionHooks, true);
  // Emit first tool call
  emitter.emit('tool_call', { name: 'read_file' });
  assert.strictEqual(tracker.count, 1);

  // Emit tool result to reset latch
  emitter.emit('tool_result', { name: 'read_file', result: 'ok' });

  // Emit second tool call
  emitter.emit('tool_call', { name: 'write_file' });
  assert.strictEqual(tracker.count, 2);

  tracker.dispose();
  assert.strictEqual(tracker.hasSessionHooks, false);
  // Emitting after dispose should not increment count
  emitter.emit('tool_result', {});
  emitter.emit('tool_call', { name: 'list_directory' });
  assert.strictEqual(tracker.count, 2);
});

test('TurnTracker flags budget exhaustion when reaching max turns', async () => {
  const controller = { abort() {} };
  const logs = [];
  const tracker = new TurnTracker({
    maxTurns: 2,
    controller,
    logger: (msg) => logs.push(msg),
  });

  // Turn 1
  const shouldContinueTurn1 = await tracker.onContent();
  assert.strictEqual(shouldContinueTurn1, true);
  assert.strictEqual(tracker.isBudgetExhausted, false);

  // Turn 2 tool execution (within budget)
  tracker.onToolResult();
  const shouldContinueTurn2 = await tracker.onToolCall('write_file');
  assert.strictEqual(shouldContinueTurn2, true);
  assert.strictEqual(tracker.isBudgetExhausted, false);

  // Turn 3 tool execution (exceeds budget of 2)
  tracker.onToolResult();
  const shouldContinueTurn3 = await tracker.onToolCall('write_file');
  assert.strictEqual(shouldContinueTurn3, false);
  assert.strictEqual(tracker.isBudgetExhausted, true);
});

test('requestHandoffSummary bumps agent turn limits and collects handoff markdown', async () => {
  const fakeAgent = {
    maxTurns: 5,
    config: {
      maxTurns: 5,
    },
  };

  const fakeSession = {
    async *sendStream(prompt, signal) {
      assert.match(prompt, /TURN LIMIT REACHED/);
      assert.ok(signal);
      yield { type: 'content', value: '## Checkpoint Summary\n' };
      yield { type: 'content', value: '- Completed: Step A\n- Remaining: Step B' };
    },
  };

  const logs = [];
  const controller = new globalThis.AbortController();
  const summary = await requestHandoffSummary(fakeAgent, fakeSession, (msg) => logs.push(msg), controller);

  assert.strictEqual(fakeAgent.maxTurns, 7);
  assert.strictEqual(fakeAgent.config.maxTurns, 7);
  assert.match(summary, /Completed: Step A/);
  assert.match(summary, /Remaining: Step B/);
  assert.ok(logs.some((l) => l.includes('[Turn Limit Reached] Requesting handoff summary')));
});

test('requestHandoffSummary handles stream errors gracefully without throwing', async () => {
  const fakeAgent = { maxTurns: 2 };
  const fakeSession = {
    sendStream() {
      throw new Error('SDK network failure during summary');
    },
  };

  const summary = await requestHandoffSummary(fakeAgent, fakeSession);
  assert.strictEqual(summary, '');
});

test('requestHandoffSummary restores tools after summary generation completes', async () => {
  const tools = { toolA: { name: 'toolA', fn: () => {} }, toolB: { name: 'toolB', fn: () => {} } };
  const fakeRegistry = {
    tools: { ...tools },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
    unregisterAllTools() {
      this.tools = {};
    },
    unregisterTool(name) {
      delete this.tools[name];
    },
    registerTool(tool) {
      this.tools[tool.name] = tool;
    },
  };

  const fakeSession = {
    config: { toolRegistry: fakeRegistry },
    async *sendStream() {
      // During summary, tools must be disarmed
      assert.strictEqual(Object.keys(fakeRegistry.tools).length, 0);
      yield { type: 'content', value: 'summary output' };
    },
  };

  const summary = await requestHandoffSummary({ maxTurns: 5 }, fakeSession);
  assert.strictEqual(summary, 'summary output');
  // Tools must be fully restored upon exiting requestHandoffSummary
  assert.strictEqual(Object.keys(fakeRegistry.tools).length, 2);
  assert.ok(fakeRegistry.tools.toolA && fakeRegistry.tools.toolB);
});

test('TurnTracker hooks into session.config.toolRegistry and resets latch on execution', async () => {
  let executed = false;
  const mockTool = {
    name: 'test_tool',
    createInvocation() {
      return {
        async execute() {
          executed = true;
          return 'done';
        },
      };
    },
  };

  const fakeRegistry = {
    tools: { test_tool: mockTool },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
  };

  const fakeSession = {
    config: { toolRegistry: fakeRegistry },
  };

  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: fakeSession,
  });

  // Turn 1 tool call sets latch
  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);
  assert.strictEqual(tracker.turnCountedForModelStep, true);

  // Executing the tool resets the latch
  const inv = fakeRegistry.getTool('test_tool').createInvocation();
  await inv.execute();
  assert.strictEqual(executed, true);
  assert.strictEqual(tracker.turnCountedForModelStep, false);

  // Next turn can now be counted
  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 2);

  tracker.dispose();
});
