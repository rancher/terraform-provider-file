import { promptIdContext, TerminalQuotaError } from '@google/gemini-cli-core';
import { GeminiCliAgent, tool, z } from '@google/gemini-cli-sdk';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';

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

const DEBUG_LOG_PATH = path.join(process.cwd(), 'orchestrator-debug.log');

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

// Set up console intercepts
const originalLog = console.log;
console.log = function (...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (shouldRedirectLog(msg)) {
    fsSync.appendFileSync(DEBUG_LOG_PATH, msg + '\n');
  } else {
    originalLog.apply(console, args);
  }
};

const MODEL_PRO = 'gemini-3.1-pro-preview';
const MODEL_FLASH = 'gemini-3.5-flash';
const MODEL_FLASH_LITE = 'gemini-3.1-flash-lite';
const MODEL_HIERARCHY = [MODEL_PRO, MODEL_FLASH, MODEL_FLASH_LITE];

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

function getMaxTurnsForModel(modelName) {
  if (modelName === MODEL_PRO) {
    return 10;
  }
  if (modelName === MODEL_FLASH) {
    return 5;
  }
  if (modelName === MODEL_FLASH_LITE) {
    return 2;
  }
  return 5;
}

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
 * @returns {Promise<string>} Accumulated text output from the agent
 */
export async function runAgentSession({
  initialPrompt,
  systemInstructions = '',
  requestedModel = MODEL_FLASH,
  blockTools = [],
  customTools = [],
  isolate = false,
}) {
  const fallbackSequence = getModelFallbackSequence(requestedModel);

  for (let i = 0; i < fallbackSequence.length; i++) {
    const currentModel = fallbackSequence[i];
    const maxTurns = getMaxTurnsForModel(currentModel);
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

      const controller = new globalThis.AbortController();
      let accumulatedText = '';

      await promptIdContext.run(session.id, async () => {
        const stream = session.sendStream(initialPrompt, controller.signal);

        for await (const chunk of stream) {
          if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
            throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
          }
          if (chunk.type === 'content') {
            const text = chunk.value || '';
            process.stdout.write(text);
            accumulatedText += text;
          } else if (chunk.type === 'tool_call_request') {
            const toolCall = chunk.value;
            const toolName = toolCall.name;
            if (toolName === 'invoke_agent') {
              throw new Error('Sub-agent delegation is blocked.');
            } else {
              let args = toolCall.args;
              if (typeof args === 'string') {
                try {
                  args = JSON.parse(args);
                } catch {
                  /* ignore */
                }
              }

              let formattedArgs;
              if (typeof args === 'object' && args !== null) {
                const cleanArgs = {};
                for (const [key, value] of Object.entries(args)) {
                  if (typeof value === 'string' && value.length > 500) {
                    cleanArgs[key] =
                      value.substring(0, 500) + `... [Truncated, total length: ${value.length} characters]`;
                  } else {
                    cleanArgs[key] = value;
                  }
                }
                formattedArgs = JSON.stringify(cleanArgs, null, 2);
              } else {
                formattedArgs = String(args);
              }

              console.log(`\n[Tool Call]: ${toolName}\nArguments:\n${formattedArgs}\n`);
            }
          } else if (chunk.type === 'tool_call_result') {
            try {
              fsSync.appendFileSync(
                DEBUG_LOG_PATH,
                `\n[Tool Result]: ${JSON.stringify(chunk.value).substring(0, 500)}\n`,
              );
            } catch {
              /* ignore */
            }
          }
        }
      });

      return accumulatedText;
    } catch (err) {
      if (isQuotaError(err) && i < fallbackSequence.length - 1) {
        console.warn(
          `⚠️ Model ${currentModel} hit quota limit. Retrying with lesser model ${fallbackSequence[i + 1]}...`,
        );
        continue;
      }
      throw err;
    }
  }
  throw new Error('All models in fallback sequence failed.');
}
