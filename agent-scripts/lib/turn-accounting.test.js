import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  bumpTurnCapacity,
  extractIntent,
  getMaxTurnsForModel,
  promptTurnBudgetExhaustion,
  requestHandoffSummary,
  syncSessionTools,
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

test('TurnTracker onContent halts stream and flags budget exhaustion when exceeding max turns', async () => {
  const controller = { abort() {} };
  const tracker = new TurnTracker({
    maxTurns: 1,
    controller,
  });

  assert.strictEqual(tracker.onContent(), true);
  tracker.onToolResult();
  assert.strictEqual(tracker.onContent(), false);
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

test('requestHandoffSummary disarms tools during summary generation and restores original invocations', async () => {
  let executedOriginalA = false;
  let executedOriginalB = false;

  const mockToolA = {
    name: 'toolA',
    createInvocation() {
      return {
        execute: async () => {
          executedOriginalA = true;
          return { llmContent: 'resultA' };
        },
      };
    },
  };

  const mockToolB = {
    name: 'toolB',
    execute: async () => {
      executedOriginalB = true;
      return { llmContent: 'resultB' };
    },
  };

  const fakeRegistry = {
    tools: { toolA: mockToolA, toolB: mockToolB },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
    getFunctionDeclarations() {
      return [{ name: 'toolA' }, { name: 'toolB' }];
    },
  };

  let disarmedOutputA = null;
  let disarmedOutputB = null;

  const fakeSession = {
    config: { toolRegistry: fakeRegistry },
    async *sendStream() {
      // Declarations must remain present in the registry so API request schemas remain valid
      assert.strictEqual(fakeRegistry.getAllToolNames().length, 2);
      assert.strictEqual(fakeRegistry.getFunctionDeclarations().length, 2);

      // But invocations must be disarmed
      const invA = fakeRegistry.getTool('toolA').createInvocation();
      disarmedOutputA = await invA.execute();

      disarmedOutputB = await fakeRegistry.getTool('toolB').execute();

      yield { type: 'content', value: 'summary output' };
    },
  };

  const summary = await requestHandoffSummary({ maxTurns: 5 }, fakeSession);
  assert.strictEqual(summary, 'summary output');
  assert.strictEqual(executedOriginalA, false);
  assert.strictEqual(executedOriginalB, false);
  assert.match(disarmedOutputA.llmContent, /Tool execution is disabled/);
  assert.match(disarmedOutputB.llmContent, /Tool execution is disabled/);

  // Invocations must be fully restored upon exiting requestHandoffSummary
  const restoredInvA = fakeRegistry.getTool('toolA').createInvocation();
  const resA = await restoredInvA.execute();
  assert.strictEqual(executedOriginalA, true);
  assert.strictEqual(resA.llmContent, 'resultA');

  const resB = await fakeRegistry.getTool('toolB').execute();
  assert.strictEqual(executedOriginalB, true);
  assert.strictEqual(resB.llmContent, 'resultB');
});

test('syncSessionTools synchronizes chat tools and resets lastUsedModelId', () => {
  let updatedTools = null;
  const mockChat = {
    setTools(tools) {
      updatedTools = tools;
    },
  };

  const mockClient = {
    lastUsedModelId: 'gemini-2.5-pro',
    getChat() {
      return mockChat;
    },
  };

  const mockRegistry = {
    getFunctionDeclarations() {
      return [{ name: 'readFile' }, { name: 'replace' }];
    },
  };

  const mockSession = {
    client: mockClient,
    config: {
      toolRegistry: mockRegistry,
      getModel() {
        return 'gemini-2.5-pro';
      },
    },
  };

  syncSessionTools(mockSession);

  assert.strictEqual(mockClient.lastUsedModelId, undefined);
  assert.deepStrictEqual(updatedTools, [{ functionDeclarations: [{ name: 'readFile' }, { name: 'replace' }] }]);
});

test('syncSessionTools passes empty tools array when declarations is empty', () => {
  let updatedTools = null;
  const mockChat = {
    setTools(tools) {
      updatedTools = tools;
    },
  };

  const mockClient = {
    lastUsedModelId: 'gemini-2.5-pro',
    getChat() {
      return mockChat;
    },
  };

  const mockRegistry = {
    getFunctionDeclarations() {
      return [];
    },
  };

  const mockSession = {
    client: mockClient,
    config: { toolRegistry: mockRegistry },
  };

  syncSessionTools(mockSession);
  assert.deepStrictEqual(updatedTools, []);
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

test('extractIntent parses intents across single-line, multi-line, and ordinary prose', () => {
  assert.strictEqual(extractIntent('Intent: to check the git status'), 'check the git status');
  assert.strictEqual(extractIntent('Intent: run tests and build'), 'run tests and build');
  assert.strictEqual(extractIntent('**Intent:** to check the git status'), 'check the git status');
  assert.strictEqual(extractIntent('* Intent: run tests and build'), 'run tests and build');
  assert.strictEqual(extractIntent('**Intent**: run tests and build'), 'run tests and build');
  assert.strictEqual(extractIntent('- **Intent:** check files**'), 'check files');
  assert.strictEqual(extractIntent('Intent: **to check the git status**'), 'check the git status');
  assert.strictEqual(extractIntent('### Intent: check status'), 'check status');
  assert.strictEqual(extractIntent('## Intent: **to check status**'), 'check status');
  assert.strictEqual(
    extractIntent('Analyzing project structure...\nIntent: inspect file\nthen compare it'),
    'inspect file\nthen compare it',
  );
  assert.strictEqual(
    extractIntent('Analyzing project structure...\n- **Intent:** inspect file\nthen compare it'),
    'inspect file\nthen compare it',
  );
  assert.strictEqual(extractIntent('Turn 1 initial response'), '');
  assert.strictEqual(extractIntent(''), '');
  assert.strictEqual(extractIntent('   '), '');
  assert.strictEqual(extractIntent('Intent:   '), '');
  assert.strictEqual(extractIntent(null), '');
  assert.strictEqual(extractIntent(undefined), '');
});

test('TurnTracker intent validation allows execution with valid intent and resets retries', async () => {
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

  const currentText = 'Intent: execute the test tool';
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => currentText,
  });

  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);

  const inv = fakeRegistry.getTool('test_tool').createInvocation();
  const res = await inv.execute();
  assert.strictEqual(res, 'done');
  assert.strictEqual(executed, true);
  assert.strictEqual(tracker.intentRetries, 0);
  assert.strictEqual(tracker.turnCountedForModelStep, false);
  tracker.dispose();
});

test('TurnTracker intent validation refuses execution and refunds turn when intent is missing', async () => {
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

  let currentText = 'Just ordinary prose without intent';
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => currentText,
  });

  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);

  const inv = fakeRegistry.getTool('test_tool').createInvocation();
  const res = await inv.execute();
  assert.strictEqual(executed, false, 'Tool must not execute when intent is missing');
  assert.strictEqual(res.error, true);
  assert.match(res.llmContent, /Tool call refused: You must declare an "Intent: <reason>"/);
  assert.strictEqual(tracker.count, 0, 'Turn count must be refunded on refused intent');
  assert.strictEqual(tracker.intentRetries, 1);

  // Agent self-corrects on next step
  currentText = 'Intent: retry with valid intent';
  tracker.onContent(currentText);
  assert.strictEqual(tracker.count, 1);

  const inv2 = fakeRegistry.getTool('test_tool').createInvocation();
  const res2 = await inv2.execute();
  assert.strictEqual(executed, true, 'Tool must execute after self-correction');
  assert.strictEqual(res2, 'done');
  assert.strictEqual(tracker.intentRetries, 0, 'Retries must reset after success');
  assert.strictEqual(tracker.count, 1, 'Net turn count must be exactly 1 after self-correction');
  tracker.dispose();
});

test('TurnTracker intent validation enforces maxIntentRetries limit', async () => {
  const mockTool = {
    name: 'test_tool',
    createInvocation() {
      return {
        async execute() {
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

  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => 'no intent',
    maxIntentRetries: 2,
  });

  // Attempt 1: refunded
  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);
  await fakeRegistry.getTool('test_tool').createInvocation().execute();
  assert.strictEqual(tracker.count, 0);
  assert.strictEqual(tracker.intentRetries, 1);

  // Attempt 2: refunded
  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);
  await fakeRegistry.getTool('test_tool').createInvocation().execute();
  assert.strictEqual(tracker.count, 0);
  assert.strictEqual(tracker.intentRetries, 2);

  // Attempt 3: exceeds maxIntentRetries (2), turn is NOT refunded
  tracker.onToolCall('test_tool');
  assert.strictEqual(tracker.count, 1);
  await fakeRegistry.getTool('test_tool').createInvocation().execute();
  assert.strictEqual(tracker.count, 1, 'Turn must not be refunded after exceeding retry limit');
  assert.strictEqual(tracker.intentRetries, 2);
  tracker.dispose();
});

test('TurnTracker exempts tools in exemptTools from intent validation', async () => {
  let executed = false;
  const noOpTool = {
    name: 'no_op',
    createInvocation() {
      return {
        async execute() {
          executed = true;
          return 'ok';
        },
      };
    },
  };

  const fakeRegistry = {
    tools: { no_op: noOpTool },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
  };

  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    exemptTools: ['no_op'],
    getTurnText: () => 'no intent emitted',
  });

  tracker.onToolCall('no_op');
  assert.strictEqual(tracker.count, 1);
  const res = await fakeRegistry.getTool('no_op').createInvocation().execute();
  assert.strictEqual(executed, true, 'Exempt tool must execute even without intent');
  assert.strictEqual(res, 'ok');
  assert.strictEqual(tracker.count, 1);
  tracker.dispose();
});

test('TurnTracker supports parallel tool executions with shared intent', async () => {
  const executedTools = [];
  const toolA = {
    name: 'tool_a',
    createInvocation() {
      return {
        async execute() {
          executedTools.push('tool_a');
          return 'result_a';
        },
      };
    },
  };
  const toolB = {
    name: 'tool_b',
    createInvocation() {
      return {
        async execute() {
          executedTools.push('tool_b');
          return 'result_b';
        },
      };
    },
  };

  const fakeRegistry = {
    tools: { tool_a: toolA, tool_b: toolB },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
  };

  let currentText = 'Intent: execute both tools in parallel';
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => currentText,
  });

  // Agent signals intent and invokes tool_a
  tracker.onToolCall('tool_a');
  const invA = fakeRegistry.getTool('tool_a').createInvocation();
  const resA = await invA.execute();
  assert.strictEqual(resA, 'result_a');

  // Stream clears turn text after tool_a result chunk
  currentText = '';

  // Parallel tool_b executes in the same turn
  const invB = fakeRegistry.getTool('tool_b').createInvocation();
  const resB = await invB.execute();
  assert.strictEqual(resB, 'result_b');
  assert.deepStrictEqual(executedTools, ['tool_a', 'tool_b']);
  assert.strictEqual(tracker.intentRetries, 0);

  tracker.dispose();
});

test('TurnTracker resets intentRetries even when tool execution throws', async () => {
  const throwingTool = {
    name: 'throwing_tool',
    createInvocation() {
      return {
        async execute() {
          throw new Error('Tool execution failed unexpectedly');
        },
      };
    },
  };

  const fakeRegistry = {
    tools: { throwing_tool: throwingTool },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
  };

  let currentText = 'no intent first';
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => currentText,
  });

  // Attempt without intent -> refused and retries incremented
  tracker.onToolCall('throwing_tool');
  await fakeRegistry.getTool('throwing_tool').createInvocation().execute();
  assert.strictEqual(tracker.intentRetries, 1);

  // Agent provides valid intent, but tool throws during execution
  currentText = 'Intent: execute throwing tool';
  tracker.onToolCall('throwing_tool');
  const inv = fakeRegistry.getTool('throwing_tool').createInvocation();
  await assert.rejects(async () => {
    await inv.execute();
  }, /Tool execution failed unexpectedly/);

  // intentRetries must have been reset because valid intent was declared
  assert.strictEqual(tracker.intentRetries, 0);

  tracker.dispose();
});

test('TurnTracker clears lastDeclaredIntent on onToolCall when starting a new turn', async () => {
  const toolA = {
    name: 'tool_a',
    createInvocation() {
      return {
        async execute() {
          return 'ok_a';
        },
      };
    },
  };
  const toolB = {
    name: 'tool_b',
    createInvocation() {
      return {
        async execute() {
          return 'ok_b';
        },
      };
    },
  };

  const fakeRegistry = {
    tools: { tool_a: toolA, tool_b: toolB },
    getAllToolNames() {
      return Object.keys(this.tools);
    },
    getTool(name) {
      return this.tools[name];
    },
  };

  let currentText = 'Intent: execute tool a';
  const tracker = new TurnTracker({
    maxTurns: 5,
    controller: { abort() {} },
    session: { config: { toolRegistry: fakeRegistry } },
    validateIntent: true,
    getTurnText: () => currentText,
  });

  // Turn 1: tool_a succeeds with valid intent
  tracker.onToolCall('tool_a');
  assert.strictEqual(tracker.count, 1);
  const resA = await fakeRegistry.getTool('tool_a').createInvocation().execute();
  assert.strictEqual(resA, 'ok_a');

  // Turn 2: Agent starts with direct tool_b call without emitting any content or intent
  currentText = '';
  tracker.onToolCall('tool_b');
  assert.strictEqual(tracker.count, 2);

  const resB = await fakeRegistry.getTool('tool_b').createInvocation().execute();
  // Must be refused because Turn 1's intent was not leaked
  assert.strictEqual(resB.error, true);
  assert.match(resB.returnDisplay, /Missing Intent declaration for tool_b/);
  assert.match(resB.llmContent, /You must declare an "Intent: <reason>"/);
  // Turn count is refunded to 1
  assert.strictEqual(tracker.count, 1);
  assert.strictEqual(tracker.intentRetries, 1);

  tracker.dispose();
});
