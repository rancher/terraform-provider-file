import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

/**
 * Returns the maximum turns allowed for a given model tier.
 *
 * @param {string} modelName - The name of the model
 * @param {Object} [models] - Optional dynamically loaded model configuration
 * @returns {number} The maximum number of turns
 */
export function getMaxTurnsForModel(modelName, models = null) {
  if (models) {
    if (modelName === models.pro) {
      return 10;
    }
    if (modelName === models.flash_lite) {
      return 2;
    }
    if (modelName === models.flash) {
      return 5;
    }
  }

  if (typeof modelName === 'string') {
    if (modelName === 'gemini-3.1-pro-preview' || modelName.includes('pro')) {
      return 10;
    }
    if (modelName === 'gemini-3.1-flash-lite' || modelName.includes('flash-lite')) {
      return 2;
    }
    if (modelName === 'gemini-3.5-flash' || modelName.includes('flash')) {
      return 5;
    }
  }

  return 5;
}

/**
 * Safely increments maxTurns across agent and session configurations.
 *
 * @param {Object} [agent] - Agent instance
 * @param {Object} [session] - Session instance
 * @param {number} delta - Number of turns to add
 */
export function bumpTurnCapacity(agent, session, delta) {
  if (agent) {
    if (typeof agent.maxTurns === 'number') {
      agent.maxTurns += delta;
    }
    if (typeof agent.max_turns === 'number') {
      agent.max_turns += delta;
    }
    if (agent.config && typeof agent.config.maxTurns === 'number') {
      agent.config.maxTurns += delta;
    }
    if (agent.config && typeof agent.config.max_turns === 'number') {
      agent.config.max_turns += delta;
    }
  }
  if (session && session.config) {
    if (typeof session.config.maxTurns === 'number') {
      session.config.maxTurns += delta;
    }
    if (typeof session.config.max_turns === 'number') {
      session.config.max_turns += delta;
    }
  }
}

/**
 * Prompts the user via readline when turn budget is exhausted to either continue or stop.
 *
 * @param {number} turnsExecuted - Total turns executed so far
 * @param {number} currentTurnBudget - Current turn budget limit
 * @param {number} maxTurns - The turn increment for this model
 * @param {AbortController} [controller] - The abort controller for the session
 * @param {Object} [ioOptions] - Custom I/O streams for testing
 * @param {Function} [logger] - Async logger function
 * @returns {Promise<{shouldContinue: boolean, newBudget: number}>}
 */
export async function promptTurnBudgetExhaustion(
  turnsExecuted,
  currentTurnBudget,
  maxTurns,
  controller,
  ioOptions = {},
  logger = () => {},
) {
  logger(`[Turn Limit Reached] Turns executed: ${turnsExecuted}/${currentTurnBudget}. Pausing for user decision.`);
  console.log(`\n\n⚠️ Turn budget reached (${turnsExecuted}/${currentTurnBudget} turns).`);

  const rlInput = ioOptions.input || input;
  const rlOutput = ioOptions.output || output;

  const isInteractive = Boolean(ioOptions.rl || ioOptions.input || rlInput.isTTY);
  if (!isInteractive) {
    logger(`[DEBUG] Non-interactive environment detected before turn limit prompt. Defaulting to stop.`);
    console.log('\n🛑 Non-interactive environment detected. Gracefully aborting agent session.\n');
    controller?.abort();
    return { shouldContinue: false, newBudget: currentTurnBudget };
  }

  const ownsRl = !ioOptions.rl;
  const rl = ioOptions.rl || readline.createInterface({ input: rlInput, output: rlOutput });
  try {
    let answer = '';
    let attempts = 0;
    while (answer !== 'continue' && answer !== 'stop' && attempts < 5) {
      attempts++;
      let response;
      try {
        response = await rl.question("👉 Type 'continue' to extend the turn limit or 'stop' to gracefully abort: ");
      } catch (err) {
        logger(`[DEBUG] Readline question error: ${err.message}`);
        answer = 'stop';
        break;
      }
      if (response === undefined || response === null) {
        answer = 'stop';
        break;
      }
      answer = response.trim().toLowerCase();
      if (answer !== 'continue' && answer !== 'stop') {
        if (!rlInput.isTTY && !ioOptions.input && !ioOptions.rl) {
          logger(`[DEBUG] Non-interactive environment detected at turn limit prompt. Defaulting to stop.`);
          answer = 'stop';
          break;
        }
        console.log("Please enter 'continue' or 'stop'.");
      }
    }

    if (answer === 'continue') {
      logger(`[Turn Limit Reached] User opted to continue session.`);
      console.log(`\n▶️ Resuming / continuing agent workflow...\n`);
      return { shouldContinue: true, newBudget: currentTurnBudget + maxTurns };
    } else {
      logger(`[Turn Limit Aborted] User opted to stop session.`);
      console.log('\n🛑 Gracefully aborting agent session at user request.\n');
      if (controller) {
        controller.abort();
      }
      return { shouldContinue: false, newBudget: currentTurnBudget };
    }
  } finally {
    if (ownsRl) {
      rl.close();
    }
    // Do not call input.resume() to prevent leaving stdin in flowing mode without listeners
  }
}

/**
 * Bumps the agent session turn limit and requests a structured handoff summary.
 *
 * @param {Object} agent - The GeminiCliAgent instance
 * @param {Object} session - The active agent session instance
 * @param {Function} [logger] - Async logger hook
 * @param {AbortController} [controller] - The abort controller for the session
 * @returns {Promise<string>} The handoff summary produced by the agent
 */
export async function requestHandoffSummary(agent, session, logger = () => {}, controller = null) {
  logger('[Turn Limit Reached] Requesting handoff summary from agent...');
  console.log('\n⏳ Turn limit reached. Asking agent for a handoff checkpoint summary...\n');

  // Increase turn capacity on the agent and session configurations to allow the summary prompt
  bumpTurnCapacity(agent, session, 2);

  const handoffPrompt =
    '⚠️ TURN LIMIT REACHED. Do not invoke any further tools. Output a structured markdown checkpoint summary with: 1) What has been completed so far, 2) Current state of modified files, and 3) The exact remaining steps to complete the task.';

  // Disarm tool calling for the handoff turn if registry is available
  const registry = session?.config?.toolRegistry;
  const savedTools = [];
  if (registry?.getAllToolNames && registry?.getTool) {
    for (const name of registry.getAllToolNames()) {
      const tool = registry.getTool(name);
      if (tool) {
        savedTools.push({ name, tool });
      }
    }
  }
  if (typeof registry?.unregisterAllTools === 'function') {
    registry.unregisterAllTools();
  } else if (typeof registry?.unregisterTool === 'function') {
    for (const { name } of savedTools) {
      registry.unregisterTool(name);
    }
  }

  let summary = '';
  try {
    const handoffStream = session.sendStream(handoffPrompt, controller?.signal);
    for await (const chunk of handoffStream) {
      if (chunk.type === 'content') {
        const text = chunk.value || '';
        process.stdout.write(text);
        summary += text;
      }
    }
  } catch (err) {
    logger(`[DEBUG] Failed to obtain handoff summary: ${err.message}`);
  } finally {
    if (registry?.registerTool) {
      for (const { name, tool } of savedTools) {
        if (tool && !tool.name) {
          tool.name = name;
        }
        registry.registerTool(tool);
      }
    }
  }

  return summary.trim();
}

/**
 * State tracker for agent stream turns and budget exhaustion.
 * Supports native session event hooks as well as stream-level fallback inspection.
 */
export class TurnTracker {
  /**
   * @param {Object} options
   * @param {number} options.maxTurns - Increment turn budget per model
   * @param {AbortController} options.controller - Controller used to abort execution
   * @param {Object} [options.session] - The active GeminiCliAgent session
   * @param {Function} [options.logger] - Logger hook for recording state changes
   */
  constructor({ maxTurns, controller, session = null, logger = () => {} }) {
    this.maxTurns = maxTurns;
    this.currentTurnBudget = maxTurns;
    this.turnsExecuted = 0;
    this.turnCountedForModelStep = false;
    this.controller = controller;
    this.session = session;
    this.logger = logger;
    this._hasSessionEvents = false;
    this._cleanupFns = [];

    if (this.session?.events && typeof this.session.events.on === 'function') {
      this._attachSessionHooks(this.session.events);
    }
    if (this.session?.config?.toolRegistry) {
      this._attachToolRegistryHooks(this.session.config.toolRegistry);
    }
  }

  /**
   * Connects to native SDK session event emitter.
   * @private
   */
  _attachSessionHooks(events) {
    this._hasSessionEvents = true;
    const onToolCall = (call) => {
      const name = call?.name || 'unknown_tool';
      this.onToolCall(name);
    };
    const onToolResult = () => {
      this.onToolResult();
    };

    events.on('tool_call', onToolCall);
    events.on('tool_result', onToolResult);

    this._cleanupFns.push(() => {
      events.removeListener?.('tool_call', onToolCall);
      events.removeListener?.('tool_result', onToolResult);
      this._hasSessionEvents = false;
    });
  }

  /**
   * Wraps tool executions in the SDK tool registry to reliably reset the step latch upon completion.
   * @private
   */
  _attachToolRegistryHooks(registry) {
    if (!registry || typeof registry.getAllToolNames !== 'function') {
      return;
    }
    const wrapTool = (tool) => {
      if (tool && typeof tool.createInvocation === 'function' && !tool._turnAccountingWrapped) {
        const origCreate = tool.createInvocation;
        const tracker = this;
        tool.createInvocation = function (...args) {
          const invocation = origCreate.apply(this, args);
          if (invocation && typeof invocation.execute === 'function') {
            const origExec = invocation.execute;
            invocation.execute = async function (...execArgs) {
              try {
                return await origExec.apply(this, execArgs);
              } finally {
                tracker.onToolResult();
              }
            };
          }
          return invocation;
        };
        tool._turnAccountingWrapped = true;
        this._cleanupFns.push(() => {
          tool.createInvocation = origCreate;
          delete tool._turnAccountingWrapped;
        });
      }
    };

    for (const name of registry.getAllToolNames()) {
      wrapTool(registry.getTool(name));
    }

    if (typeof registry.registerTool === 'function') {
      const origRegister = registry.registerTool;
      registry.registerTool = function (...args) {
        for (const arg of args) {
          wrapTool(arg);
        }
        return origRegister.apply(this, args);
      };
      this._cleanupFns.push(() => {
        registry.registerTool = origRegister;
      });
    }
  }

  /**
   * Detaches native event hooks to prevent listener leaks.
   */
  dispose() {
    for (const cleanup of this._cleanupFns) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this._cleanupFns = [];
  }

  /**
   * Whether native session event hooks are currently active.
   */
  get hasSessionHooks() {
    return Boolean(this._hasSessionEvents);
  }

  /**
   * Resets the turn step latch upon receiving a tool result.
   */
  onToolResult() {
    this.turnCountedForModelStep = false;
  }

  /**
   * Handles content streaming tokens.
   * @returns {boolean} true if execution should continue, false if aborted.
   */
  onContent() {
    if (!this.turnCountedForModelStep) {
      this.turnCountedForModelStep = true;
      this.turnsExecuted++;
      this.logger(`[Turn ${this.turnsExecuted}/${this.currentTurnBudget}] Agent streaming content response.`);
    }
    return this._checkBudget();
  }

  /**
   * Handles a tool call request chunk.
   * @param {string} toolName - Name of the requested tool
   * @returns {boolean} true if execution should continue, false if aborted.
   */
  onToolCall(toolName) {
    if (!this.turnCountedForModelStep) {
      this.turnCountedForModelStep = true;
      this.turnsExecuted++;
      this.logger(`[Turn ${this.turnsExecuted}/${this.currentTurnBudget}] Tool call request: ${toolName}`);
    }
    return this._checkBudget();
  }

  /**
   * Evaluates turn budget and allows content streaming through the current turn.
   * @private
   * @returns {boolean} false if budget is exceeded, true otherwise
   */
  _checkBudget() {
    return this.turnsExecuted <= this.currentTurnBudget;
  }

  /**
   * Explicitly resets the step latch across stream prompt restarts.
   */
  resetStepLatch() {
    this.turnCountedForModelStep = false;
  }

  /**
   * Whether the budget limit has been reached.
   */
  get isBudgetExhausted() {
    return this.turnsExecuted > this.currentTurnBudget;
  }

  /**
   * Current summary count of turns taken.
   */
  get count() {
    return this.turnsExecuted;
  }
}
