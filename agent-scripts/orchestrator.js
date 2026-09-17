#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import toml from '@iarna/toml';
import { GeminiCliAgent, tool, z } from '@google/gemini-cli-sdk';
import { promptIdContext } from '@google/gemini-cli-core';
import { validateCommitTitle } from '../.github/workflows/scripts/validate-commit-message.js';

const execAsync = promisify(exec);
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
    const userResponse = await rl.question('👉 Your Answer: ');
    return { answer: userResponse };
  },
);

// 1. Helper to run Gemini CLI via the native SDK
async function runGeminiSDK(initialPrompt, systemInstructions = '') {
  console.log(`\n[Initializing Gemini SDK Agentic Session]...`);

  const agent = new GeminiCliAgent({
    instructions: systemInstructions || 'You are a highly capable agentic assistant.',
    tools: [askUserTool],
  });

  const session = agent.session();
  const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');
  session.config.getWorkspaceContext().addDirectory(projectTempDir);
  await session.initialize();

  const controller = new globalThis.AbortController();

  await promptIdContext.run(session.id, async () => {
    const stream = session.sendStream(initialPrompt, controller.signal);

    for await (const chunk of stream) {
      // Standard text responses from the primary agent
      if (chunk.type === 'content') {
        process.stdout.write(chunk.value || '');
      }

      // Intercept when Gemini delegates work via 'invoke_agent'
      if (chunk.type === 'tool_call_request') {
        const toolCall = chunk.value;
        const toolName = toolCall.name;
        if (toolName === 'invoke_agent') {
          let args = toolCall.args;
          if (typeof args === 'string') {
            args = JSON.parse(args);
          }
          console.log('\n\n--- [SUB-AGENT DELEGATION DETECTED] ---');
          console.log(`Target Sub-Agent : ${args.agent_name}`);
          console.log(`Prompt Passed    : ${args.prompt || args.request?.prompt}`);
          console.log('---------------------------------------\n');
        }
      }
    }
  });
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

function parseJSONFromText(text) {
  const match = text.match(/```json\s*\n([\s\S]*?)\n\s*```/) || text.match(/```\s*\n([\s\S]*?)\n\s*```/);
  const clean = (match ? match[1] : text).trim();
  try {
    return JSON.parse(clean);
  } catch {
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

  console.log(`\n🚀 Starting Orchestrated Loop for Objective: "${objective}"`);

  // ==========================================
  // PHASE 1: PLANNING (Read-Only)
  // ==========================================
  console.log('\n--- 📂 Phase 1: Planning ---');
  console.log('Initiating research and planning session with read-only tools...');

  const planPrompt = `Objective: "${objective}".
You are strictly in PLANNING phase (Phase 1). Do NOT modify any source files. 
Research the codebase and construct a comprehensive development plan to satisfy the user's objective.
Your primary task is to write a detailed markdown plan under 'plans/current.md' describing:
1. Architectural direction.
2. Step-by-step implementation changes.
3. Verification/testing strategy (must explicitly mention tests and quality gates).`;

  const planSystemInstructions = `You are strictly in PLANNING phase (Phase 1). Do NOT modify any source files. 
Research the codebase and construct a comprehensive development plan to satisfy the user's objective.
Your primary task is to write a detailed markdown plan under 'plans/current.md'.`;
  await runGeminiSDK(planPrompt, planSystemInstructions);

  console.log('\n======================================');
  console.log('📋 Gating: Plan Approval Required');
  console.log('======================================');
  const planApproval = await rl.question('👉 Do you approve the plan in plans/current.md? (yes/no): ');
  if (planApproval.trim().toLowerCase() !== 'yes') {
    console.log('❌ Plan rejected. Exiting orchestrator.');
    rl.close();
    process.exit(0);
  }

  console.log('\n✅ Plan successfully approved by user!');

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
Implement the approved plan documented in 'plans/current.md' meticulously and surgically.`;
  await runGeminiSDK(implementPrompt, implementSystemInstructions);

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
      'node agent-scripts/compile-docs.js && bash .github/workflows/scripts/lint.sh all --fix && go test ./...',
    );
    if (buildResult.exit_code !== 0) {
      console.error('❌ Tests or linters failed. Initiating self-healing...');
      const qaPrompt = `The automated workspace testing or linting pipeline failed with the following errors/findings:
      
Stdout:
${buildResult.stdout}

Stderr:
${buildResult.stderr}

Please analyze these errors, fix the code surgically, and re-run tests.`;

      const qaSystemInstructions = `You are a QA/Self-Healing assistant. Resolve the test/linter failures reported by the QA pipeline.`;
      await runGeminiSDK(qaPrompt, qaSystemInstructions);
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
    const exclusions = ['go.sum', 'package-lock.json', '.png', '.jpg', '.svg', '.gif', '.lock'];
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

    // Instantiate agent for single-turn structured review
    const qaAgent = new GeminiCliAgent({
      model: qaConfig.model,
      instructions:
        (qaConfig.instructions || '') +
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
      }`,
    });

    const qaSession = qaAgent.session();
    const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');
    qaSession.config.getWorkspaceContext().addDirectory(projectTempDir);
    await qaSession.initialize();

    const qaController = new globalThis.AbortController();
    let accumulatedText = '';

    await promptIdContext.run(qaSession.id, async () => {
      const stream = qaSession.sendStream(qaPrompt, qaController.signal);

      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          const text = chunk.value || '';
          process.stdout.write(text);
          accumulatedText += text;
        }
      }
    });

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

      const healInstructions = `You are an implementation assistant. Meticulously resolve all findings and errors flagged by the QA review.`;
      await runGeminiSDK(healPrompt, healInstructions);
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
  try {
    const commitAgent = new GeminiCliAgent({
      instructions:
        'You are a professional software engineer. Generate a single-line, highly descriptive and concise git commit message conforming to Conventional Commits format (e.g., "feat: add feature X" or "fix: resolve bug Y") based strictly on the provided git diff. Do not include any preambles, explanations, quotes, or markdown wrappers.',
    });
    const commitSession = commitAgent.session();
    const projectTempDir = path.join(os.homedir(), '.gemini/tmp/terraform-provider-file');
    commitSession.config.getWorkspaceContext().addDirectory(projectTempDir);
    await commitSession.initialize();
    const controller = new globalThis.AbortController();
    let accumulatedMsg = '';
    await promptIdContext.run(commitSession.id, async () => {
      const stream = commitSession.sendStream(`Here is the git diff:\n\n${diffResult.stdout}`, controller.signal);
      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          accumulatedMsg += chunk.value || '';
        }
      }
    });
    const cleanMsg = accumulatedMsg.trim().replace(/^['"`]+|['"`]+$/g, '');
    if (cleanMsg) {
      defaultMsg = cleanMsg;
    }
  } catch (err) {
    console.warn(`⚠️ Failed to generate commit message with Gemini: ${err.message}. Falling back to default.`);
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
  const commitStatus = await handleRunShellCommand(`git commit -m "${finalMsg.replace(/"/g, '\\"')}"`);

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
