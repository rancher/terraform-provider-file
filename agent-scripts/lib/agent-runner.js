import { promptIdContext, TerminalQuotaError } from '@google/gemini-cli-core';
import { GeminiCliAgent, tool, z } from '@google/gemini-cli-sdk';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import {
  bumpTurnCapacity,
  getMaxTurnsForModel,
  promptTurnBudgetExhaustion,
  requestHandoffSummary,
  TurnTracker,
} from './turn-accounting.js';
import { getRepoRoot } from './utils.js';

const MAX_SILENT_RETRY_DELAY_MS = 300000; // 5 minutes

// Intercept retryDelayMs of TerminalQuotaError to prevent massive retry hangs (> 5 minutes)
if (TerminalQuotaError && TerminalQuotaError.prototype) {
  Object.defineProperty(TerminalQuotaError.prototype, 'name', {
    get() {
      return this._name;
    },
    set(val) {
      this._name = val;
      Object.defineProperty(this, 'retryDelayMs', {
        get() {
          return this._retryDelayMs;
        },
        set(delayVal) {
          this._retryDelayMs = delayVal;
          if (delayVal !== undefined && delayVal > MAX_SILENT_RETRY_DELAY_MS) {
            if (typeof this.message === 'string') {
              this.message = this.message.replace(
                /exhausted your capacity|capacity exceeded|MODEL_CAPACITY_EXHAUSTED/gi,
                'exhausted capacity (immediate fallback)',
              );
            }
            if (typeof this._reason === 'string') {
              this._reason = this._reason.replace(
                /MODEL_CAPACITY_EXHAUSTED|MODEL_CAPACITY_EXCEEDED/g,
                'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK',
              );
            }
          }
        },
        configurable: true,
        enumerable: true,
      });

      Object.defineProperty(this, 'reason', {
        get() {
          return this._reason;
        },
        set(reasonVal) {
          if (reasonVal !== undefined && this.retryDelayMs > MAX_SILENT_RETRY_DELAY_MS) {
            this._reason = reasonVal.replace(
              /MODEL_CAPACITY_EXHAUSTED|MODEL_CAPACITY_EXCEEDED/g,
              'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK',
            );
          } else {
            this._reason = reasonVal;
          }
        },
        configurable: true,
        enumerable: true,
      });
    },
    configurable: true,
    enumerable: true,
  });
}

let initPromise = null;
let repoRoot = null;
let logStream = null;
let isConsoleIntercepted = false;
let originalLog = null;

let MODEL_PRO = 'gemini-3.1-pro-preview';
let MODEL_FLASH = 'gemini-3.5-flash';
let MODEL_FLASH_LITE = 'gemini-3.1-flash-lite';
let MODEL_HIERARCHY = [MODEL_PRO, MODEL_FLASH, MODEL_FLASH_LITE];

function writeLogAsync(msg) {
  if (logStream && logStream.writable && !logStream.writableEnded && !logStream.destroyed && !logStream.errored) {
    logStream.write(msg + '\n');
  }
}

/**
 * Flushes and closes the active debug log stream if open.
 * @returns {Promise<void>}
 */
export async function flushLogs() {
  if (isConsoleIntercepted && originalLog) {
    console.log = originalLog;
    originalLog = null;
    isConsoleIntercepted = false;
  }
  if (!logStream) {
    return;
  }
  const stream = logStream;
  logStream = null;
  initPromise = null;

  if (stream.destroyed || stream.errored || stream.writableEnded) {
    return;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    stream.end(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function shouldRedirectLog(msg) {
  if (typeof msg !== 'string') {
    return false;
  }
  return (
    msg.includes('[DEBUG]') ||
    msg.includes('[PolicyEngine.check]') ||
    msg.includes('[Routing]') ||
    msg.includes('[TopicTool]') ||
    msg.includes('Experiments loaded') ||
    msg.includes('Loading ignore patterns') ||
    msg.includes('Ripgrep is not available') ||
    msg.includes('Tool with name') ||
    msg.includes('GrepLogic:') ||
    msg.includes('Loaded cached credentials')
  );
}

function setupConsoleIntercept() {
  if (isConsoleIntercepted) {
    return;
  }
  isConsoleIntercepted = true;
  originalLog = console.log;
  console.log = function (...args) {
    const msg = util.formatWithOptions({ colors: false }, ...args);
    if (shouldRedirectLog(msg)) {
      if (logStream && !logStream.writableEnded && !logStream.destroyed && !logStream.errored) {
        writeLogAsync(msg);
      } else {
        originalLog.apply(console, args);
      }
    } else {
      originalLog.apply(console, args);
    }
  };
}

/**
 * Initializes configuration state and logging streams asynchronously.
 * Can be called explicitly or lazily when runAgentSession executes.
 * @returns {Promise<{repoRoot: string, models: {pro: string, flash: string, flash_lite: string}}>}
 */
export async function initializeAgentRunner() {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    repoRoot = await getRepoRoot();
    const logDir = path.join(repoRoot, 'agent-scripts');
    await fsPromises.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, 'orchestrator.log');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.on('error', (err) => {
      console.debug(`[DEBUG] Debug log stream error encountered: ${err.message}`);
    });
    setupConsoleIntercept();

    let modelConfig;
    try {
      const settingsStr = await fsPromises.readFile(path.join(repoRoot, '.gemini/settings.json'), 'utf8');
      const settingsObj = JSON.parse(settingsStr);
      modelConfig = settingsObj.models || {};
    } catch (err) {
      console.debug(`[DEBUG] Could not load .gemini/settings.json models: ${err.message}. Using defaults.`);
      modelConfig = {};
    }

    MODEL_PRO = modelConfig.pro || 'gemini-3.1-pro-preview';
    MODEL_FLASH = modelConfig.flash || 'gemini-3.5-flash';
    MODEL_FLASH_LITE = modelConfig.flash_lite || 'gemini-3.1-flash-lite';
    MODEL_HIERARCHY = [MODEL_PRO, MODEL_FLASH, MODEL_FLASH_LITE];

    return {
      repoRoot,
      logPath,
      models: { pro: MODEL_PRO, flash: MODEL_FLASH, flash_lite: MODEL_FLASH_LITE },
    };
  })();

  return initPromise;
}

function getModelFallbackSequence(requestedModel) {
  let modelName = requestedModel;
  if (!modelName || modelName === 'auto-gemini-3') {
    modelName = MODEL_PRO;
  }
  const index = MODEL_HIERARCHY.indexOf(modelName);
  if (index === -1) {
    return [requestedModel, ...MODEL_HIERARCHY];
  }
  return MODEL_HIERARCHY.slice(index);
}

function isMaxTurnsError(err) {
  if (!err) {
    return false;
  }
  const msg =
    typeof err === 'object'
      ? (err.message || err.error || JSON.stringify(err)).toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes('max_turns') ||
    msg.includes('max turns') ||
    msg.includes('turn limit') ||
    msg.includes('maximum turns')
  );
}

// Re-export turn accounting helpers for backward compatibility
export { bumpTurnCapacity, getMaxTurnsForModel, promptTurnBudgetExhaustion, requestHandoffSummary, TurnTracker };

function isQuotaError(err) {
  if (!err) {
    return false;
  }
  const message = String(err.message || err).toLowerCase();
  const name = String(err.name || '').toLowerCase();
  return (
    name.includes('quota') ||
    message.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('capacity') ||
    message.includes('exhausted') ||
    message.includes('exceeded')
  );
}

function truncateDeep(val, maxLen = 2000) {
  if (typeof val === 'string') {
    if (val.length > maxLen) {
      return val.substring(0, maxLen) + `... [Truncated, total length: ${val.length} characters]`;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => truncateDeep(item, maxLen));
  }
  if (typeof val === 'object' && val !== null) {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = truncateDeep(v, maxLen);
    }
    return res;
  }
  return val;
}

/**
 * Runs a Gemini Cli Agent session with specified parameters, automatically managing models,
 * fallbacks, budgeting, sandboxing, and error intercepts.
 *
 * @param {Object} options
 * @param {string} options.initialPrompt - The user objective or prompt
 * @param {string} [options.systemInstructions] - Custom system instructions for the agent
 * @param {string} [options.requestedModel] - Model to start with
 * @param {Array<string>} [options.blockTools] - List of tools to unregister/block
 * @param {Array<Object>} [options.customTools] - Array of custom SDK tools to register
 * @param {boolean} [options.isolate] - Whether to isolate the agent session
 * @param {boolean} [options.standalone] - Whether to auto-flush logs upon session completion
 * @returns {Promise<string>} Accumulated text output from the agent
 */
export async function runAgentSession({
  initialPrompt,
  systemInstructions = '',
  requestedModel,
  blockTools = [],
  customTools = [],
  isolate = false,
  standalone = false,
}) {
  await initializeAgentRunner();

  try {
    const startingModel = requestedModel || MODEL_FLASH;
    const fallbackSequence = getModelFallbackSequence(startingModel);

    for (let i = 0; i < fallbackSequence.length; i++) {
      const currentModel = fallbackSequence[i];
      const maxTurns = getMaxTurnsForModel(currentModel, {
        pro: MODEL_PRO,
        flash: MODEL_FLASH,
        flash_lite: MODEL_FLASH_LITE,
      });
      console.log(`\n[Initializing Gemini SDK Agentic Session] (Model: ${currentModel}, Max Turns: ${maxTurns})...`);

      const modelInstructions =
        (systemInstructions || 'You are a highly capable agentic assistant.') +
        `\n\n⚠️ IMPORTANT TURN BUDGET: You are allowed a MAXIMUM of ${maxTurns} turns/iterations for this entire run. Conduct yourself efficiently, use tools in parallel, avoid unnecessary turns, and complete your task before reaching this limit.`;

      const noOpTool = tool(
        {
          name: 'no_op',
          description: 'A dummy tool that does nothing.',
          inputSchema: z.object({ dummy: z.string().optional().describe('Ignored parameter') }),
        },
        async () => 'No operation performed.',
      );

      const finalTools = isolate ? [noOpTool] : customTools;
      const controller = new globalThis.AbortController();
      let accumulatedText = '';
      let turnTracker = null;

      try {
        const agent = new GeminiCliAgent({
          model: currentModel,
          max_turns: maxTurns,
          instructions: modelInstructions,
          tools: finalTools,
        });

        const session = agent.session();
        const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');
        session.config.getWorkspaceContext().addDirectory(projectTempDir);
        await session.initialize();

        if (isolate) {
          const registeredTools = session.config.toolRegistry.getAllToolNames();
          for (const toolName of registeredTools) {
            if (toolName !== 'no_op') {
              session.config.toolRegistry.unregisterTool(toolName);
            }
          }
        } else {
          // Enforce custom sandboxing by unregistering specified tools
          for (const toolName of blockTools) {
            session.config.toolRegistry.unregisterTool(toolName);
          }
          // Always unregister invoke_agent to prevent unmonitored delegation
          session.config.toolRegistry.unregisterTool('invoke_agent');
        }

        turnTracker = new TurnTracker({
          maxTurns,
          controller,
          session,
          logger: writeLogAsync,
        });

        const runResult = await promptIdContext.run(session.id, async () => {
          let currentPrompt = initialPrompt;

          while (!controller.signal.aborted) {
            let streamHaltedByBudget = false;
            try {
              const stream = session.sendStream(currentPrompt, controller.signal);

              for await (const chunk of stream) {
                if (
                  chunk.type === 'error' ||
                  chunk.type === 'invalid_stream' ||
                  chunk.type === 'agent_execution_blocked'
                ) {
                  if (isMaxTurnsError(chunk.value)) {
                    writeLogAsync(`[Turn Budget Reached] SDK reported max turns reached via chunk error.`);
                    turnTracker.turnsExecuted = turnTracker.currentTurnBudget;
                    streamHaltedByBudget = true;
                    break;
                  }
                  throw new Error(
                    `Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`,
                  );
                }
                if (chunk.type === 'content') {
                  const shouldContinue = turnTracker.onContent();
                  if (!shouldContinue) {
                    break;
                  }
                  const text = chunk.value || '';
                  process.stdout.write(text);
                  accumulatedText += text;
                } else if (chunk.type === 'tool_call_request') {
                  const toolCall = chunk.value;
                  const toolName = toolCall.name;
                  if (toolName === 'invoke_agent') {
                    throw new Error('Sub-agent delegation is blocked.');
                  }

                  let args = toolCall.args;
                  if (typeof args === 'string') {
                    try {
                      args = JSON.parse(args);
                    } catch (err) {
                      console.debug(`[DEBUG] Failed to parse tool arguments string as JSON: ${err.message}`);
                    }
                  }

                  let formattedRawArgs;
                  if (typeof args === 'object' && args !== null) {
                    formattedRawArgs = JSON.stringify(truncateDeep(args, 2000), null, 2);
                  } else {
                    formattedRawArgs = String(args);
                  }

                  writeLogAsync(`\n[Tool Call]: ${toolName}\nArguments:\n${formattedRawArgs}`);

                  let shouldContinue = true;
                  if (!turnTracker.hasSessionHooks) {
                    shouldContinue = turnTracker.onToolCall(toolName);
                  } else {
                    shouldContinue = turnTracker.count <= turnTracker.currentTurnBudget;
                  }
                  if (!shouldContinue) {
                    streamHaltedByBudget = true;
                    break;
                  }

                  console.log(`⚡ Agent using tool: ${toolName}`);
                } else if (chunk.type === 'tool_call_result') {
                  if (!turnTracker.hasSessionHooks) {
                    turnTracker.onToolResult();
                  }
                  try {
                    const safeValue = truncateDeep(chunk.value, 2000);
                    writeLogAsync(`\n[Tool Result]: ${JSON.stringify(safeValue, null, 2)}`);
                  } catch (err) {
                    console.debug(`[DEBUG] Failed to log tool call result: ${err.message}`);
                  }
                }
              }
            } catch (err) {
              if (isMaxTurnsError(err)) {
                writeLogAsync(`[Turn Budget Reached] SDK threw max turns error during stream: ${err.message}`);
                turnTracker.turnsExecuted = turnTracker.currentTurnBudget;
                streamHaltedByBudget = true;
              } else {
                throw err;
              }
            }

            if (streamHaltedByBudget || turnTracker.isBudgetExhausted) {
              writeLogAsync(
                `[Turn Limit Reached] Tracker detected budget limit (${turnTracker.count}/${turnTracker.currentTurnBudget}).`,
              );
              const summary = await requestHandoffSummary(agent, session, writeLogAsync, controller);
              if (summary) {
                accumulatedText += '\n\n' + summary;
              }

              const decision = await promptTurnBudgetExhaustion(
                turnTracker.count,
                turnTracker.currentTurnBudget,
                maxTurns,
                controller,
                {},
                writeLogAsync,
              );
              if (!decision.shouldContinue) {
                return accumulatedText;
              }

              turnTracker.currentTurnBudget = decision.newBudget;
              bumpTurnCapacity(agent, session, maxTurns);
              turnTracker.resetStepLatch();
              currentPrompt = 'Please continue working to complete the task based on your handoff checkpoint summary.';
              continue;
            }

            break;
          }
          return accumulatedText;
        });

        if (controller.signal.aborted) {
          writeLogAsync(`[Session Stopped] Agent session aborted cleanly.`);
          return accumulatedText;
        }

        return runResult ?? accumulatedText;
      } catch (err) {
        if (isQuotaError(err) && i < fallbackSequence.length - 1) {
          console.warn(
            `⚠️ Model ${currentModel} hit quota limit. Retrying with lesser model ${fallbackSequence[i + 1]}...`,
          );
          continue;
        }
        throw err;
      } finally {
        turnTracker?.dispose();
      }
    }
    throw new Error('All models in fallback sequence failed.');
  } finally {
    if (standalone) {
      await flushLogs();
    }
  }
}
