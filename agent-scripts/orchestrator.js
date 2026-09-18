#!/usr/bin/env node
import { promptIdContext, TerminalQuotaError } from '@google/gemini-cli-core';
import { GeminiCliAgent, tool, z } from '@google/gemini-cli-sdk';
import toml from '@iarna/toml';
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { promisify } from 'node:util';
import { validateCommitTitle } from '../.github/workflows/scripts/validate-commit-message.js';

import fsSync from 'node:fs';

// Intercept retryDelayMs of TerminalQuotaError to prevent massive retry hangs (> 5 minutes)
const MAX_SILENT_RETRY_DELAY_MS = 300000; // 5 minutes

if (TerminalQuotaError && TerminalQuotaError.prototype) {
  Object.defineProperty(TerminalQuotaError.prototype, 'name', {
    get() {
      return this._name;
    },
    set(val) {
      this._name = val;
      // Redefine retryDelayMs and reason on the instance itself to bypass the native field definitions
      Object.defineProperty(this, 'retryDelayMs', {
        get() {
          return this._retryDelayMs;
        },
        set(delayVal) {
          this._retryDelayMs = delayVal;
          if (delayVal !== undefined && delayVal > MAX_SILENT_RETRY_DELAY_MS) {
            // Censor the message/reason so that isCapacityExceeded evaluates to false in retry.js.
            // This ensures retryWithBackoff immediately throws and bubbles up the quota error,
            // allowing the orchestrator's outer fallback loop to retry with a lesser model instantly.
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

// Clear the log on startup
try {
  fsSync.writeFileSync(DEBUG_LOG_PATH, `--- Orchestrator Debug Log Started at ${new Date().toISOString()} ---\n`);
} catch {
  // Ignore logging initialization error if any
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

const originalLog = console.log;
console.log = function (...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (shouldRedirectLog(msg)) {
    fsSync.appendFileSync(DEBUG_LOG_PATH, msg + '\n');
  } else {
    originalLog.apply(console, args);
  }
};

const originalDebug = console.debug;
console.debug = function (...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (shouldRedirectLog(msg)) {
    fsSync.appendFileSync(DEBUG_LOG_PATH, msg + '\n');
  } else {
    originalDebug.apply(console, args);
  }
};

const originalInfo = console.info;
console.info = function (...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (shouldRedirectLog(msg)) {
    fsSync.appendFileSync(DEBUG_LOG_PATH, msg + '\n');
  } else {
    originalInfo.apply(console, args);
  }
};

const originalWarn = console.warn;
console.warn = function (...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (shouldRedirectLog(msg)) {
    fsSync.appendFileSync(DEBUG_LOG_PATH, msg + '\n');
  } else {
    originalWarn.apply(console, args);
  }
};

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const rl = readline.createInterface({ input, output });

// Define the ask_user tool using the SDK tool utility
const askUserTool = tool(
  {
    name: 'ask_user',
    description: 'Ask the human user a clarifying question when critical setup or context details are missing.',
    inputSchema: z.object({
      question: z.string().describe('The exact clarifying question to prompt the user with.'),
    }),
  },
  async (params) => {
    console.log(`\n\n🤖 [Agent requested input]: ${params.question}`);
    const answer = await rl.question('👉 Your Answer: ');
    return { answer };
  },
);

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

// 1. Helper to run Gemini CLI via the native SDK
async function runGeminiSDK(initialPrompt, systemInstructions = '', requestedModel = MODEL_FLASH) {
  const fallbackSequence = getModelFallbackSequence(requestedModel);

  for (let i = 0; i < fallbackSequence.length; i++) {
    const currentModel = fallbackSequence[i];
    const maxTurns = getMaxTurnsForModel(currentModel);
    console.log(`\n[Initializing Gemini SDK Agentic Session] (Model: ${currentModel}, Max Turns: ${maxTurns})...`);

    const modelInstructions =
      (systemInstructions || 'You are a highly capable agentic assistant.') +
      `\n\n⚠️ IMPORTANT TURN BUDGET: You are allowed a MAXIMUM of ${maxTurns} turns/iterations for this entire run. Conduct yourself efficiently, use tools in parallel, avoid unnecessary turns, and complete your task before reaching this limit.`;

    try {
      const agent = new GeminiCliAgent({
        model: currentModel,
        max_turns: maxTurns,
        instructions: modelInstructions,
        tools: [askUserTool],
      });

      const session = agent.session();
      const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');
      session.config.getWorkspaceContext().addDirectory(projectTempDir);
      await session.initialize();
      session.config.toolRegistry.unregisterTool('invoke_agent');

      const controller = new globalThis.AbortController();
      let accumulatedText = '';

      await promptIdContext.run(session.id, async () => {
        const stream = session.sendStream(initialPrompt, controller.signal);

        for await (const chunk of stream) {
          if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
            throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
          }
          // Standard text responses from the primary agent
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
              // Log other tool calls cleanly
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
            // Optionally log tool results to debug log
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

      // Succeeded! Return control.
      return accumulatedText;
    } catch (err) {
      if (isQuotaError(err) && i < fallbackSequence.length - 1) {
        console.warn(
          `⚠️ Model ${currentModel} hit quota limit. Retrying with lesser model ${fallbackSequence[i + 1]}...`,
        );
        continue;
      }
      throw err; // Hard error if not a quota error or we ran out of models
    }
  }
}

// 2. Helper to run shell commands (for tests and Git review)
async function handleRunShellCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600000,
    });
    return { stdout, stderr, exit_code: 0 };
  } catch (err) {
    if (err.killed && err.signal === 'SIGTERM') {
      return {
        stdout: err.stdout || '',
        stderr: `❌ Command execution timed out after 600000ms.`,
        exit_code: 124,
      };
    }
    return { stdout: err.stdout || '', stderr: err.stderr || err.message, exit_code: err.code || 1 };
  }
}

// Helper to check if a file exists without throwing
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// 3. Helpers for QA agent
async function loadAgentInstructions(agentName) {
  const filePath = path.join(process.cwd(), `.gemini/agents/${agentName}.toml`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = toml.parse(content);
    return {
      instructions: parsed.instructions || '',
      model: parsed.model,
      max_turns: parsed.max_turns,
      temperature: parsed.temperature,
    };
  } catch (err) {
    console.warn(`⚠️ Could not load custom instructions for agent ${agentName}: ${err.message}`);
    return { instructions: '' };
  }
}

function getStandardsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mappings = {
    '.go': 'docs/development/reference/Go.toml',
    '.tf': 'docs/development/reference/Terraform.toml',
    '.sh': 'docs/development/reference/ShellScripts.toml',
    '.bash': 'docs/development/reference/ShellScripts.toml',
    '.js': 'docs/development/reference/JavaScript.toml',
    '.mjs': 'docs/development/reference/JavaScript.toml',
    '.cjs': 'docs/development/reference/JavaScript.toml',
    '.ts': 'docs/development/reference/JavaScript.toml',
    '.md': 'docs/development/reference/DocumentationFormatting.toml',
    '.toml': 'docs/development/reference/DocumentationFormatting.toml',
    '.yml': 'docs/development/reference/Workflows.toml',
    '.yaml': 'docs/development/reference/Workflows.toml',
    default: 'docs/development/reference/CodingStandards.toml',
  };
  return mappings[ext] || mappings['default'];
}

function parseJSONFromText(text, fallbackType = 'qa') {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.warn(`⚠️ JSON parsing failed: ${err.message}. Attempting graceful fallback structure.`);
    // Item 20: Fallback to standard strings / default structure when parsing fails
    if (fallbackType === 'qa') {
      const containsApproved = text.toUpperCase().includes('APPROVED') && !text.toUpperCase().includes('UNAPPROVED');
      return {
        approval_status: containsApproved ? 'APPROVED' : 'UNAPPROVED',
        findings: containsApproved
          ? []
          : [
              {
                file: 'unknown',
                line_numbers: [],
                narrative: text.trim() || 'No detail provided in raw text response.',
              },
            ],
      };
    }
    return null;
  }
}

function printHelp() {
  console.log(`
🤖 [Gemini CLI Orchestrator] - Usage Guide
=========================================

The orchestrator guides an agentic session through a standard four-phase development lifecycle:
Phase 1: Planning (Read-only research & generating a plan under 'plans/current.md')
Phase 2: Implementation (Applying surgical writes to files to complete the task)
Phase 3: Automated QA Review (Tests/linters and self-healing auditing via subagents)
Phase 4: Final User Review & Commit (Generating conventional commit and finalizing changes)

Usage:
  node agent-scripts/orchestrator.js "<objective>"      Run orchestrator with an objective
  node agent-scripts/orchestrator.js                    Interactive prompt for an objective
  node agent-scripts/orchestrator.js -h, --help         Show this help menu

Examples:
  node agent-scripts/orchestrator.js "Fix the cache timeout bug in file_client.go"
  node agent-scripts/orchestrator.js "Add a new local_snapshot directory resource test"
`);
}

async function savePlanFromJSON(text) {
  const planJSON = parseJSONFromText(text, 'plan');
  if (planJSON && planJSON.title) {
    const mdPlan = [
      `# IMPLEMENTATION PLAN: ${planJSON.title}`,
      '',
      `## 🎯 OBJECTIVE`,
      planJSON.objective || '',
      '',
      `## 🚧 SCOPE BOUNDARIES`,
      `**IN SCOPE:**`,
      ...(planJSON.scope_boundaries?.in_scope || []).map((i) => `- ${i}`),
      '',
      `**OUT OF SCOPE (Do NOT attempt):**`,
      ...(planJSON.scope_boundaries?.out_of_scope || []).map((i) => `- ${i}`),
      '',
      `## ✅ EXIT CRITERIA (Definition of Done)`,
      ...(planJSON.exit_criteria || []).map((i) => `- [ ] ${i}`),
      '',
      `## 🛠️ IMPLEMENTATION TASKS`,
      ...(planJSON.implementation_tasks || []).map((i) => `- [ ] ${i}`),
      '',
    ].join('\n');
    await fs.mkdir(path.join(process.cwd(), 'plans'), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), 'plans/current.md'), mdPlan, 'utf8');
    return true;
  }
  return false;
}

// 4. MAIN SYSTEM FLOW
async function main() {
  const firstArg = process.argv[2];
  if (firstArg === '-h' || firstArg === '--help') {
    printHelp();
    rl.close();
    process.exit(0);
  }

  const objective = firstArg || (await rl.question('\n🎯 Enter your objective/task: '));
  if (!objective || objective.trim() === '') {
    console.error('❌ Error: An objective is required.');
    process.exit(1);
  }

  const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');

  console.log(`\n🚀 Starting Orchestrated Loop for Objective: "${objective}"`);

  // ==========================================
  // PHASE 1: PLANNING (Read-Only)
  // ==========================================
  console.log('\n--- 📂 Phase 1: Planning ---');
  console.log('Initiating research and planning session with read-only tools...');

  const planConfig = await loadAgentInstructions('planner');
  const planModel = planConfig.model || MODEL_PRO;

  const planPrompt = `Objective: "${objective}".\nPlease conduct your user interview using the \`ask_user\` tool (intent = "clarification"). Once you have all the context you need, generate the implementation plan as a strict JSON block according to your system instructions. Do not write any files to disk yourself.`;

  const planSystemInstructions =
    planConfig.instructions ||
    `You are strictly in PLANNING phase (Phase 1). Do NOT modify any source files.\nImportant: Always use the installed skills ('git-readonly', 'github-ci', 'github-pr') for Git and GitHub operations instead of raw commands (e.g. 'git branch', 'gh pr view') or web fetching GitHub URLs.`;

  // Initialize the stateful Gemini SDK session with fallback
  const planFallbackSequence = getModelFallbackSequence(planModel);
  let planSession = null;
  let initialPlanRunSuccessful = false;
  let accumulatedPlanText = '';

  for (let i = 0; i < planFallbackSequence.length; i++) {
    const currentModel = planFallbackSequence[i];
    const maxTurns = getMaxTurnsForModel(currentModel);
    console.log(`\n[Initializing Gemini SDK Agentic Session] (Model: ${currentModel}, Max Turns: ${maxTurns})...`);

    const modelInstructions =
      planSystemInstructions +
      `\n\n⚠️ IMPORTANT TURN BUDGET: You are allowed a MAXIMUM of ${maxTurns} turns/iterations for this entire run. Conduct yourself efficiently, use tools in parallel, avoid unnecessary turns, and complete your task before reaching this limit.`;

    try {
      const agent = new GeminiCliAgent({
        model: currentModel,
        max_turns: maxTurns,
        instructions: modelInstructions,
        tools: [askUserTool],
      });

      planSession = agent.session();
      planSession.config.getWorkspaceContext().addDirectory(projectTempDir);
      await planSession.initialize();

      // Item 17: Read-Only Tool Area during Planning
      const planReadonlyTools = [
        'write_file',
        'replace',
        'create_file',
        'edit_file',
        'run_shell_command',
        'invoke_agent',
      ];
      for (const toolName of planReadonlyTools) {
        planSession.config.toolRegistry.unregisterTool(toolName);
      }

      const planController = new globalThis.AbortController();
      accumulatedPlanText = '';
      await promptIdContext.run(planSession.id, async () => {
        const stream = planSession.sendStream(planPrompt, planController.signal);

        for await (const chunk of stream) {
          if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
            throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
          }
          if (chunk.type === 'content') {
            const text = chunk.value || '';
            process.stdout.write(text);
            accumulatedPlanText += text;
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

      initialPlanRunSuccessful = true;
      break;
    } catch (err) {
      if (isQuotaError(err) && i < planFallbackSequence.length - 1) {
        console.warn(
          `⚠️ Model ${currentModel} hit quota limit during initial planning. Retrying with lesser model ${planFallbackSequence[i + 1]}...`,
        );
        continue;
      }
      console.error(`❌ Plan generation failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (!initialPlanRunSuccessful) {
    console.error(`❌ Plan generation failed on all models in fallback sequence.`);
    process.exit(1);
  }

  await savePlanFromJSON(accumulatedPlanText);

  const planController = new globalThis.AbortController();

  let currentPrompt = planPrompt;
  let sessionHealthy = true;
  let planApproved = false;
  let planningIteration = 1;

  while (!planApproved) {
    if (sessionHealthy && planningIteration > 1) {
      try {
        console.log(`\n--- 📂 Phase 1: Planning (Refinement Iteration ${planningIteration}) ---`);
        console.log(`Relaying feedback to existing agent session...`);

        await promptIdContext.run(planSession.id, async () => {
          accumulatedPlanText = '';
          const stream = planSession.sendStream(currentPrompt, planController.signal);

          for await (const chunk of stream) {
            if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
              throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
            }
            if (chunk.type === 'content') {
              const text = chunk.value || '';
              process.stdout.write(text);
              accumulatedPlanText += text;
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
        await savePlanFromJSON(accumulatedPlanText);
      } catch (err) {
        console.warn(`⚠️ Warning: Stateful session error: ${err.message}. Switching to new session fallback.`);
        sessionHealthy = false;
      }
    }

    if (!sessionHealthy) {
      // Fallback: Start a new agent session with the objective, current plan, and user feedback
      console.log(`\n[Starting a new planning agent session for refinement...]`);
      const possiblePlanPaths = [
        path.join(process.cwd(), 'plans/current.md'),
        path.join(projectTempDir, 'plans/current.md'),
      ];
      let currentPlanContent = '';
      for (const p of possiblePlanPaths) {
        if (await exists(p)) {
          currentPlanContent = await fs.readFile(p, 'utf8');
          break;
        }
      }

      const refinedPrompt = `Objective: "${objective}".
We are refining the existing development plan based on user feedback.
Do NOT modify any source files.

Current Plan:
\`\`\`markdown
${currentPlanContent}
\`\`\`

User Feedback:
"${currentPrompt}"

Please revise and refine the development plan, outputting the final plan as a strict JSON block to incorporate the user's feedback. Do not write any files to disk yourself.`;

      try {
        accumulatedPlanText = await runGeminiSDK(refinedPrompt, planSystemInstructions, MODEL_FLASH);
        await savePlanFromJSON(accumulatedPlanText);
      } catch (err) {
        console.error(`❌ Failed to run refined planning agent: ${err.message}`);
        process.exit(1);
      }
    }

    // Locate the plan file and print its contents to stdout
    const possiblePlanPaths = [
      path.join(process.cwd(), 'plans/current.md'),
      path.join(projectTempDir, 'plans/current.md'),
    ];
    let planFileFound = null;
    for (const p of possiblePlanPaths) {
      if (await exists(p)) {
        planFileFound = p;
        break;
      }
    }

    if (planFileFound) {
      console.log('\n======================================');
      console.log(`📄 CURRENT PLAN (${path.relative(process.cwd(), planFileFound)}):`);
      console.log('======================================');
      const planContent = await fs.readFile(planFileFound, 'utf8');
      console.log(planContent);
      console.log('======================================\n');
    } else {
      console.warn('⚠️ Warning: plans/current.md not found after planning session.');
    }

    // Gating approval / refinement comment
    console.log('\n======================================');
    console.log('📋 Gating: Plan Approval Required');
    console.log('======================================');

    let validResponse = false;
    while (!validResponse) {
      const userInput = await rl.question('👉 Do you approve the plan? (yes / no / <comment> to refine): ');
      const trimmedInput = userInput.trim();

      if (trimmedInput.toLowerCase() === 'yes') {
        planApproved = true;
        validResponse = true;
        console.log('\n✅ Plan successfully approved by user!');
      } else if (trimmedInput.toLowerCase() === 'no') {
        console.log('❌ Plan rejected. Exiting orchestrator.');
        rl.close();
        process.exit(0);
      } else if (trimmedInput.length > 0) {
        currentPrompt = trimmedInput;
        validResponse = true;
        planningIteration++;
      } else {
        console.log('⚠️ Empty response. Please type "yes", "no", or provide feedback comment.');
      }
    }
  }

  // ==========================================
  // PHASE 2: IMPLEMENTATION (Write Access)
  // ==========================================
  console.log('\n--- 🔨 Phase 2: Implementation ---');
  console.log('Transitioning to Implementation phase with write tools...');

  const implementPrompt = `Objective: "${objective}".
You are now in the IMPLEMENTATION phase (Phase 2).
Please implement the approved plan documented in 'plans/current.md' meticulously.
Modify the files surgically. Maintain the agentic framework, respect project standards, and write/run robust tests to verify your edits.
Once you have fully finished your implementation, run the project's tests to ensure they are clean.`;

  const implementSystemInstructions = `You are in the IMPLEMENTATION phase (Phase 2). 
Implement the approved plan documented in 'plans/current.md' meticulously and surgically.
Important: Always use the installed skills ('git-readonly', 'github-ci', 'github-pr') for Git and GitHub operations instead of raw commands (e.g. 'git branch', 'gh pr view') or web fetching GitHub URLs.`;
  await runGeminiSDK(implementPrompt, implementSystemInstructions, MODEL_PRO);

  console.log('\n✅ Implementation session closed. Moving to automated QA review...');

  // ==========================================
  // PHASE 3: AUTOMATED QA REVIEW (Self-Healing Loop)
  // ==========================================
  console.log('\n--- 🛡️ Phase 3: Automated QA Review ---');
  let qaAttempts = 0;
  const maxQAAttempts = 3;
  let qaSuccess = false;

  while (qaAttempts < maxQAAttempts && !qaSuccess) {
    qaAttempts++;
    console.log(`\nRunning automated QA pipeline (Attempt ${qaAttempts}/${maxQAAttempts})...`);

    // 1. Run local tests and linters
    console.log('Running tests and workspace linters...');
    const buildResult = await handleRunShellCommand(
      'npm run test && bash .github/workflows/scripts/lint.sh all --fix && go test ./...',
    );
    if (buildResult.exit_code !== 0) {
      console.error('❌ Tests or linters failed. Initiating self-healing...');
      const qaPrompt = `The automated workspace testing or linting pipeline failed with the following errors/findings:
      
Stdout:
${buildResult.stdout}

Stderr:
${buildResult.stderr}

Please analyze these errors, fix the code surgically, and re-run tests.`;

      const qaSystemInstructions = `You are a QA/Self-Healing assistant. Resolve the test/linter failures reported by the QA pipeline.
Important: Always use the installed skills ('git-readonly', 'github-ci', 'github-pr') for Git and GitHub operations instead of raw commands (e.g. 'git branch', 'gh pr view') or web fetching GitHub URLs.`;
      await runGeminiSDK(qaPrompt, qaSystemInstructions, MODEL_FLASH);
      continue;
    }

    console.log('🟢 All tests and linters passed! Invoking QA agent for final audit...');

    // 2. Load context for QA Review Agent
    console.log('Gathering changed files and git difference...');
    await execAsync('git add -A');
    const { stdout: diffFiles } = await execAsync('git diff --name-only --cached');
    const changedFiles = diffFiles
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    const exclusions = ['.png', '.jpg', '.svg', '.gif']; // PR 431: Do not auto-approve lockfiles
    const filteredFiles = changedFiles.filter((f) => !exclusions.some((ext) => f.endsWith(ext) || f.includes(ext)));

    if (filteredFiles.length === 0) {
      console.log('🟢 No significant changes detected in git. QA approved!');
      qaSuccess = true;
      break;
    }

    const { stdout: activeDiff } = await execAsync('git diff --cached');

    let codingStandardsText = '';
    const standardsFilesLoaded = new Set();
    for (const file of filteredFiles) {
      const stdFile = getStandardsFile(file);
      if (!standardsFilesLoaded.has(stdFile)) {
        standardsFilesLoaded.add(stdFile);
        const stdPath = path.join(process.cwd(), stdFile);
        if (await exists(stdPath)) {
          try {
            const content = await fs.readFile(stdPath, 'utf8');
            codingStandardsText += `\n\n--- CODING STANDARDS REFERENCE: ${stdFile} ---\n${content}`;
          } catch (err) {
            console.error(`❌ Failed to read coding standards file at ${stdPath}: ${err.message}`);
            throw err;
          }
        }
      }
    }

    let priorDecisions = [];
    const stateFile = path.join(process.cwd(), '.gemini/project-report.json');
    if (await exists(stateFile)) {
      try {
        const stateContent = await fs.readFile(stateFile, 'utf8');
        priorDecisions = JSON.parse(stateContent);
      } catch (err) {
        console.error(`❌ Failed to load or parse project-report.json: ${err.message}`);
        throw err;
      }
    }

    let activePlan = '';
    const planFile = path.join(process.cwd(), 'plans/current.md');
    if (await exists(planFile)) {
      try {
        activePlan = await fs.readFile(planFile, 'utf8');
      } catch (err) {
        console.error(`❌ Failed to read plan file plans/current.md: ${err.message}`);
        throw err;
      }
    } else {
      console.warn('⚠️ Warning: plans/current.md not found.');
    }

    // 3. Construct QA Review Prompt and run the QA Agent
    const qaPrompt = `Please perform a single-pass quality assurance review of the staged code changes in <git_diff> by applying your system instructions to evaluate Plan congruence, security, concurrency, and style correctness.

<active_plan>
${activePlan}
</active_plan>

<prior_decisions>
${JSON.stringify(priorDecisions, null, 2)}
</prior_decisions>

<coding_standards>
${codingStandardsText}
</coding_standards>

<git_diff>
${activeDiff}
</git_diff>`;

    console.log('\n--- 🛡️ Invoking @quality_assurance Subagent ---');
    const qaConfig = await loadAgentInstructions('quality_assurance');
    const qaModel = qaConfig.model || MODEL_PRO;
    const qaFallbackSequence = getModelFallbackSequence(qaModel);

    let qaSuccessRun = false;
    let accumulatedText = '';

    for (let i = 0; i < qaFallbackSequence.length; i++) {
      const currentModel = qaFallbackSequence[i];
      const maxTurns = getMaxTurnsForModel(currentModel);
      console.log(`\n[Initializing QA Agent Session] (Model: ${currentModel}, Max Turns: ${maxTurns})...`);

      const modelInstructions =
        (qaConfig.instructions || '') +
        `\n\n⚠️ IMPORTANT TURN BUDGET: You are allowed a MAXIMUM of ${maxTurns} turns/iterations for this entire run. Conduct yourself efficiently, use tools in parallel, avoid unnecessary turns, and complete your task before reaching this limit.` +
        `\n\nYou MUST format your entire response strictly as a single valid JSON object. Do not include any conversational preambles or additional explanations. Ensure the JSON conforms to this structure:
      {
        "approval_status": "APPROVED" or "UNAPPROVED",
        "findings": [
          {
            "file": "relative_filepath",
            "line_numbers": [12, 13],
            "narrative": "Detailed narrative of active/unresolved violations (this array MUST be empty if approval_status is APPROVED)"
          }
        ]
      }`;

      try {
        const qaAgent = new GeminiCliAgent({
          model: currentModel,
          max_turns: maxTurns,
          instructions: modelInstructions,
        });

        const qaSession = qaAgent.session();
        qaSession.config.getWorkspaceContext().addDirectory(projectTempDir);
        await qaSession.initialize();

        // Item 18: QA Review Read-Only Sandbox
        const qaReadonlyTools = [
          'write_file',
          'replace',
          'create_file',
          'edit_file',
          'run_shell_command',
          'invoke_agent',
        ];
        for (const toolName of qaReadonlyTools) {
          qaSession.config.toolRegistry.unregisterTool(toolName);
        }

        const qaController = new globalThis.AbortController();
        accumulatedText = '';

        await promptIdContext.run(qaSession.id, async () => {
          const stream = qaSession.sendStream(qaPrompt, qaController.signal);

          for await (const chunk of stream) {
            if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
              throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
            }
            if (chunk.type === 'content') {
              const text = chunk.value || '';
              process.stdout.write(text);
              accumulatedText += text;
            }
          }
        });

        qaSuccessRun = true;
        break;
      } catch (err) {
        if (isQuotaError(err) && i < qaFallbackSequence.length - 1) {
          console.warn(
            `⚠️ QA Agent model ${currentModel} hit quota limit. Retrying with lesser model ${qaFallbackSequence[i + 1]}...`,
          );
          continue;
        }
        console.error(`❌ QA Agent execution failed: ${err.message}`);
        process.exit(1);
      }
    }

    if (!qaSuccessRun) {
      console.error(`❌ QA Agent failed on all models in fallback sequence.`);
      process.exit(1);
    }

    const qaReportObj = parseJSONFromText(accumulatedText);
    if (!qaReportObj) {
      console.warn('⚠️ Could not parse QA agent output as JSON. Retrying...');
      continue;
    }

    const isApproved =
      qaReportObj.approval_status === 'APPROVED' &&
      (!Array.isArray(qaReportObj.findings) || qaReportObj.findings.length === 0);

    if (isApproved) {
      console.log('\n🟢 QA Review Approved! No issues detected.');
      qaSuccess = true;
    } else {
      console.error('\n❌ QA Review Unapproved. Initiating self-healing loop...');
      console.log(`Actionable Findings:\n${JSON.stringify(qaReportObj.findings, null, 2)}`);

      const healPrompt = `The QA Review has findings that must be resolved:
      
Findings:
${JSON.stringify(qaReportObj.findings, null, 2)}

Please analyze these findings, fix the code surgically, and re-run tests.`;

      const healInstructions = `You are an implementation assistant. Meticulously resolve all findings and errors flagged by the QA review.
Important: Always use the installed skills ('git-readonly', 'github-ci', 'github-pr') for Git and GitHub operations instead of raw commands (e.g. 'git branch', 'gh pr view') or web fetching GitHub URLs.`;
      await runGeminiSDK(healPrompt, healInstructions, MODEL_FLASH);
    }
  }

  if (!qaSuccess) {
    console.error('❌ Error: Automated QA Review failed after maximum retry attempts. Exiting.');
    process.exit(1);
  }

  // ==========================================
  // PHASE 4: FINAL USER REVIEW & COMMIT
  // ==========================================
  console.log('\n--- 📦 Phase 4: Final User Review & Commit ---');

  const diffResult = await handleRunShellCommand('git diff HEAD');
  if (!diffResult.stdout || diffResult.stdout.trim() === '') {
    console.log('🟢 QA passed but no changes were detected in Git. Session complete!');
    rl.close();
    process.exit(0);
  }

  console.log('\n======================================');
  console.log('🔍 PROPOSED CHANGES (git diff):');
  console.log('======================================');
  console.log(diffResult.stdout);
  console.log('======================================\n');

  const finalApproval = await rl.question('👉 Do you approve these changes for commit? (yes/no): ');
  if (finalApproval.trim().toLowerCase() !== 'yes') {
    console.log('❌ Commit cancelled by developer. Sourcing/modifications are left in working directory.');
    rl.close();
    process.exit(0);
  }

  console.log('Staging changes and preparing commit...');
  await handleRunShellCommand('git add -A');

  console.log('Asking Gemini to generate a commit message based on your diff...');
  let defaultMsg = 'chore: overhaul hooks and phases with simplified orchestrator';

  const commitFallbackSequence = getModelFallbackSequence(MODEL_FLASH_LITE);

  for (let i = 0; i < commitFallbackSequence.length; i++) {
    const currentModel = commitFallbackSequence[i];
    const maxTurns = getMaxTurnsForModel(currentModel);
    console.log(`\n[Generating Commit Message] (Model: ${currentModel}, Max Turns: ${maxTurns})...`);

    try {
      const modelInstructions =
        'You are a professional software engineer. Generate a single-line, highly descriptive and concise git commit message conforming to Conventional Commits format (e.g., "feat: add feature X" or "fix: resolve bug Y") based strictly on the provided git diff. Do not include any preambles, explanations, quotes, or markdown wrappers.' +
        `\n\n⚠️ IMPORTANT TURN BUDGET: You are allowed a MAXIMUM of ${maxTurns} turns/iterations for this entire run. Conduct yourself efficiently, use tools in parallel, avoid unnecessary turns, and complete your task before reaching this limit.`;

      const commitAgent = new GeminiCliAgent({
        model: currentModel,
        max_turns: maxTurns,
        instructions: modelInstructions,
      });

      const commitSession = commitAgent.session();
      commitSession.config.getWorkspaceContext().addDirectory(projectTempDir);
      await commitSession.initialize();
      commitSession.config.toolRegistry.unregisterTool('invoke_agent');
      const commitController = new globalThis.AbortController();
      let accumulatedMsg = '';

      await promptIdContext.run(commitSession.id, async () => {
        const stream = commitSession.sendStream(
          `Here is the git diff:\n\n${diffResult.stdout}`,
          commitController.signal,
        );
        for await (const chunk of stream) {
          if (chunk.type === 'error' || chunk.type === 'invalid_stream' || chunk.type === 'agent_execution_blocked') {
            throw new Error(`Agent execution failed: ${chunk.type}. Details: ${JSON.stringify(chunk.value || '')}`);
          }
          if (chunk.type === 'content') {
            accumulatedMsg += chunk.value || '';
          }
        }
      });

      const cleanMsg = accumulatedMsg.trim().replace(/^['"`]+|['"`]+$/g, '');
      if (cleanMsg) {
        defaultMsg = cleanMsg;
      }
      break;
    } catch (err) {
      if (isQuotaError(err) && i < commitFallbackSequence.length - 1) {
        console.warn(
          `⚠️ Commit generation model ${currentModel} hit quota limit. Retrying with lesser model ${commitFallbackSequence[i + 1]}...`,
        );
        continue;
      }
      console.warn(`⚠️ Failed to generate commit message with Gemini model ${currentModel}: ${err.message}.`);
      break; // Exit loop if it's not a quota error or we hit the end
    }
  }

  // Determine if the changes affect product files (inside internal/)
  const { stdout: diffFiles } = await execAsync('git diff --name-only --cached');
  const changedFiles = diffFiles
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  const affectsProduct = changedFiles.some((f) => f.startsWith('internal/'));

  let commitApproved = false;
  let finalMsg = '';

  while (!commitApproved) {
    console.log(`\nProposed commit message: "${defaultMsg}"`);
    const userMsg = await rl.question('Enter commit message (or press enter for default): ');
    const candidateMsg = userMsg.trim() || defaultMsg;

    // 1. Empty Check
    if (!candidateMsg) {
      console.error('❌ Error: Commit message is empty. Please enter a valid commit message.');
      continue;
    }

    // 2. Length Check
    if (candidateMsg.length > 100) {
      console.error(
        `❌ Error: Commit message should be less than 100 characters (currently ${candidateMsg.length}). Please write a shorter message.`,
      );
      continue;
    }

    // 3. Prefix & Semver Check
    const { valid, reason } = validateCommitTitle(candidateMsg, affectsProduct, false);
    if (!valid) {
      console.error(`❌ Error: ${reason}`);
      console.log('Please adjust your commit type or description according to conventional commit guidelines.');
      continue;
    }

    finalMsg = candidateMsg;
    commitApproved = true;
  }

  console.log(`Committing: ${finalMsg}`);
  let commitStatus;
  try {
    const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', finalMsg], { maxBuffer: 10 * 1024 * 1024 });
    commitStatus = { stdout, stderr, exit_code: 0 };
  } catch (err) {
    commitStatus = { stdout: err.stdout || '', stderr: err.stderr || err.message, exit_code: err.code || 1 };
  }

  if (commitStatus.exit_code === 0) {
    console.log('🟢 Changes committed successfully!');
  } else {
    console.error(`❌ Commit failed:\n${commitStatus.stderr || commitStatus.stdout}`);
  }

  rl.close();
}

main().catch((err) => {
  console.error('❌ Fatal Orchestrator Error:', err.stack || err.message);
  if (rl) {
    rl.close();
  }
  process.exit(1);
});
