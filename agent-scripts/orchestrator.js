#!/usr/bin/env node
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { promisify } from 'node:util';

import { tool, z } from '@google/gemini-cli-sdk';

// Import our deterministic modular libraries
import { flushLogs, initializeAgentRunner, isAbortError, runAgentSession } from './lib/agent-runner.js';
import { getGitDiff, stageAndCommit, stripDiffMetadata, validateMessage } from './lib/git-release.js';
import { getPRComments } from './lib/github-context.js';
import { runQAPipeline } from './lib/qa-runner.js';
import { exists, getRepoRoot, loadAgentInstructions, savePlanFromJSON, validateAgentOutput } from './lib/utils.js';

const execFileAsync = promisify(execFile);

const rl = readline.createInterface({ input, output });

// Prevent unhandled AbortError from crashing Node process when SDK streams abort
process.on('uncaughtException', (err, origin) => {
  if (isAbortError(err)) {
    return;
  }
  console.error(`❌ Uncaught exception (${origin}):`, err);
  process.exit(1);
});

const USE_CASES = {
  1: { name: 'Bugfix', desc: 'Address a problem the user is facing' },
  2: { name: 'Feature', desc: 'Add a new feature the user would like' },
  3: { name: 'Refactor', desc: 'Refactor something without changing behavior' },
  4: { name: 'Test', desc: 'Add new tests without changing behavior' },
  5: { name: 'PR Comments', desc: 'Address PR comments programmatically' },
  6: { name: 'Review Loop', desc: 'Iterative loop to review staged code until no changes exist' },
};

// Define custom tool for human-in-the-loop clarification during planning
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

/**
 * Main Orchestrated Workflow Execution
 */
async function main() {
  try {
    const { models } = await initializeAgentRunner();
    const repoRoot = await getRepoRoot();
    console.log('\n==================================================');
    console.log('🤖 [Gemini CLI Orchestrator] - Modular Pipeline');
    console.log('==================================================');

    // Step 1: Use Case Selection
    console.log('\n🎯 Select your interaction use case:');
    for (const [key, uc] of Object.entries(USE_CASES)) {
      console.log(`  ${key}) [${uc.name}] - ${uc.desc}`);
    }

    let selection = '';
    while (!USE_CASES[selection]) {
      const inputSel = await rl.question('\n👉 Selection (1-6): ');
      selection = inputSel.trim();
      if (!USE_CASES[selection]) {
        console.log('⚠️ Invalid selection. Please enter a number between 1 and 6.');
      }
    }

    const useCase = USE_CASES[selection];
    console.log(`\n🚀 Starting Tailored Workflow for: [${useCase.name}]`);

    let objective = '';
    if (selection === '6') {
      const currentPlanPath = path.join(repoRoot, 'plans/current.md');
      if (!(await exists(currentPlanPath))) {
        console.error('❌ Error: plans/current.md not found. An existing plan is required to run the review loop.');
        process.exitCode = 1;
        return;
      }
      const planText = await fs.readFile(currentPlanPath, 'utf8');
      const match = planText.match(/## 🎯 OBJECTIVE\s+([\s\S]*?)(?=\n## |$)/);
      objective = match ? match[1].trim() : 'Review staged code against existing plan in plans/current.md';
      console.log(
        `ℹ️ Review Loop will use existing plan from plans/current.md (Objective: "${objective.slice(0, 80)}...")`,
      );
    } else {
      objective = await rl.question('\n🎯 Enter your objective/task: ');
      if (!objective || objective.trim() === '') {
        console.error('❌ Error: An objective is required.');
        process.exitCode = 1;
        return;
      }
    }

    const planSchema = z.object({
      title: z.string(),
      objective: z.string(),
      scope_boundaries: z.object({
        in_scope: z.array(z.string()),
        out_of_scope: z.array(z.string()),
      }),
      exit_criteria: z.array(z.string()),
      implementation_tasks: z.array(z.string()),
    });

    const qaSchema = z.object({
      approval_status: z.preprocess(
        (val) => (typeof val === 'string' ? val.toUpperCase() : val),
        z.enum(['APPROVED', 'UNAPPROVED', 'REJECTED']).transform((val) => (val === 'REJECTED' ? 'UNAPPROVED' : val)),
      ),
      findings: z.array(
        z.object({
          file: z.string(),
          line_numbers: z.array(z.number()),
          narrative: z.string(),
        }),
      ),
    });

    // ==========================================
    // PHASE 1: PLANNING (Read-Only)
    // ==========================================
    console.log('\n--- 📂 Phase 1: Planning ---');
    let planApproved = false;
    let planFileFound = null;

    // Tailored planning logic per Use Case
    if (selection === '5') {
      // PR COMMENTS: Skip planning completely and fetch comments programmatically
      console.log('PR Comments workflow selected. Fetching comments programmatically via script...');
      try {
        const comments = await getPRComments();
        console.log('\n=== RETRIEVED PR COMMENTS ===');
        console.log(comments);
        console.log('==============================\n');

        const autoPlan = {
          title: `Address PR Comments: ${objective}`,
          objective: objective,
          scope_boundaries: {
            in_scope: ['Address review findings and conversation comments in the fetched list.'],
            out_of_scope: ['Any changes unrelated to the requested PR review feedback.'],
          },
          exit_criteria: ['All identified issues in the comments are resolved.', 'Tests and linters pass cleanly.'],
          implementation_tasks: ['Analyze review feedback.', 'Surgically update corresponding source files.'],
        };
        await savePlanFromJSON(autoPlan);
        planApproved = true;
        console.log('✅ Generated deterministic implementation plan from PR Comments context.');
      } catch (err) {
        console.error(`❌ Failed to fetch PR comments: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    } else if (selection === '3') {
      // REFACTOR: Generate a deterministic refactor plan programmatically
      console.log('Refactor workflow selected. Generating deterministic plan...');
      const autoPlan = {
        title: `Refactor: ${objective}`,
        objective: objective,
        scope_boundaries: {
          in_scope: [
            'Refactor targeted components to improve readability or structure.',
            'Ensure exact same behavioral outputs.',
          ],
          out_of_scope: ['Changing public APIs.', 'Adding new features or fixing unrelated bugs.'],
        },
        exit_criteria: [
          'Behavioral coverage remains identical.',
          'All tests and linters pass cleanly with zero new warnings.',
        ],
        implementation_tasks: [
          'Examine existing target modules.',
          'Apply clean architecture and DRY principles surgically.',
        ],
      };
      await savePlanFromJSON(autoPlan);
      planApproved = true;
      console.log('✅ Generated deterministic Refactor implementation plan.');
    } else if (selection === '4') {
      // TEST: Generate a deterministic testing plan programmatically
      console.log('Add Tests workflow selected. Generating deterministic plan...');
      const autoPlan = {
        title: `Add Tests: ${objective}`,
        objective: objective,
        scope_boundaries: {
          in_scope: ['Adding or expanding automated tests inside test folders or *_test.go files.'],
          out_of_scope: ['Modifying any non-test product files (files outside of test files).'],
        },
        exit_criteria: [
          'Test coverage is expanded successfully.',
          'New tests pass cleanly.',
          'No changes made to product code.',
        ],
        implementation_tasks: [
          'Analyze target code paths requiring test coverage.',
          'Write or expand unit / integration tests.',
        ],
      };
      await savePlanFromJSON(autoPlan);
      planApproved = true;
      console.log('✅ Generated deterministic Testing implementation plan.');
    } else if (selection === '6') {
      // REVIEW LOOP: Preserve existing plans/current.md and proceed directly to review
      console.log('Review Loop workflow selected. Preserving existing plans/current.md...');
      planApproved = true;
    } else {
      // BUGFIX & FEATURE: Run standard agent planning with user-interview capabilities
      console.log('Bugfix/Feature workflow selected. Invoking @planner agent...');
      const planConfig = await loadAgentInstructions('planner');
      const planPrompt = `Objective: "${objective}".\nPlease conduct your user interview using the \`ask_user\` tool (intent = "clarification"). Once you have all the context you need, generate the implementation plan as a strict JSON block according to your system instructions. Do not write any files to disk yourself.

Your final JSON response must strictly conform to this schema:
\`\`\`json
{
  "title": "Clear implementation plan title",
  "objective": ${JSON.stringify(objective)},
  "scope_boundaries": {
    "in_scope": ["Specific files or components to touch"],
    "out_of_scope": ["Things not to touch or refactor"]
  },
  "exit_criteria": ["Testable definition of done criteria"],
  "implementation_tasks": ["Actionable step 1", "Actionable step 2"]
}
\`\`\``;

      const planSystemInstructions =
        planConfig.instructions ||
        `You are strictly in PLANNING phase (Phase 1). Do NOT modify any source files. You must formulate a complete plan JSON and output it directly.`;

      try {
        const planResult = await runAgentSession({
          initialPrompt: planPrompt,
          systemInstructions: planSystemInstructions,
          requestedModel: planConfig.model,
          blockTools: ['write_file', 'replace', 'create_file', 'edit_file', 'run_shell_command'],
          customTools: [askUserTool],
          rl,
        });

        const validatedPlan = await validateAgentOutput(planResult, planSchema, planConfig?.model || models?.flash);
        if (!validatedPlan) {
          console.error('❌ Failed to parse plan JSON output from planner agent.');
          process.exitCode = 1;
          return;
        }
        const success = await savePlanFromJSON(validatedPlan, objective);
        if (!success) {
          console.error('❌ Failed to save plan file to disk.');
          process.exitCode = 1;
          return;
        }
      } catch (err) {
        console.error(`❌ Plan generation failed: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }

    // Display the plan and gate approval
    const possiblePlanPaths = [path.join(repoRoot, 'plans/current.md')];
    for (const p of possiblePlanPaths) {
      if (await exists(p)) {
        planFileFound = p;
        break;
      }
    }

    if (planFileFound) {
      console.log('\n======================================');
      console.log(`📄 CURRENT PLAN (${path.relative(repoRoot, planFileFound)}):`);
      console.log('======================================');
      const planContent = await fs.readFile(planFileFound, 'utf8');
      console.log(planContent);
      console.log('======================================\n');
    } else {
      console.error('❌ Error: plans/current.md not found. Gating fails-closed.');
      process.exitCode = 1;
      return;
    }

    while (!planApproved) {
      const userApprove = await rl.question('👉 Do you approve the plan? (yes/no): ');
      if (userApprove.trim().toLowerCase() === 'yes') {
        planApproved = true;
        console.log('\n✅ Plan approved by developer!');
      } else {
        console.log('❌ Plan rejected. Exiting orchestrator.');
        return;
      }
    }

    // Check if on main, sync, and branch out
    try {
      const { stdout: branchOutput } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (branchOutput.trim() === 'main') {
        console.log('\n🌿 Currently on "main" branch. Syncing and creating a new working branch...');
        console.log('Fetching latest from origin main...');
        await execFileAsync('git', ['pull', 'origin', 'main']);

        const prefixMap = {
          1: 'bugfix',
          2: 'feature',
          3: 'refactor',
          4: 'test',
          5: 'pr-comments',
          6: 'review-loop',
        };
        const prefix = prefixMap[selection] || 'task';
        const sanitizedObjective =
          objective
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 50) || 'working-branch';
        let newBranch = `${prefix}/${sanitizedObjective}`;

        // If the branch already exists, append a random ID
        try {
          await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${newBranch}`]);
          const randomId = crypto.randomBytes(4).toString('hex');
          newBranch = `${newBranch}-${randomId}`;
        } catch (err) {
          // Branch does not exist, safe to use as is
          console.debug(`[DEBUG] Branch refs/heads/${newBranch} does not exist: ${err.message}`);
        }

        await execFileAsync('git', ['checkout', '-b', newBranch]);
        console.log(`✅ Checked out new branch: ${newBranch}`);
      }
    } catch (err) {
      console.error(`❌ Branch creation failed: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    // ==========================================
    // PHASE 2: IMPLEMENTATION (Write Access)
    // ==========================================
    console.log('\n--- 🔨 Phase 2: Implementation ---');
    console.log('Transitioning to Implementation phase with write tools...');

    let implementInstructions = `You are in the IMPLEMENTATION phase (Phase 2). 
Implement the approved plan documented in 'plans/current.md' meticulously and surgically.`;

    if (selection === '4') {
      // Strictly restrict the agent to test files
      implementInstructions += `\n⚠️ STRICT CONSTRAINT: You are ONLY allowed to write or modify test files (e.g. *_test.go, *.test.js, or files under test directories). DO NOT modify any product files.`;
    } else if (selection === '6') {
      implementInstructions = `You are in the REVIEW LOOP phase. Review the staged code and the approved plan documented in 'plans/current.md', make surgical improvements within scope if necessary, and ensure all tests and linters pass. If no changes or improvements are needed, make no modifications.`;
    }

    const implementPrompt = `Objective: "${objective}".
Please implement the approved plan documented in 'plans/current.md' meticulously and surgically.
Once you have fully finished your implementation, stop.`;

    try {
      if (selection === '6') {
        let iteration = 0;
        let hasChanges = true;
        const maxIterations = 15;
        const planPath = planFileFound || path.join(repoRoot, 'plans/current.md');
        let activePlan = '';
        if (await exists(planPath)) {
          activePlan = await fs.readFile(planPath, 'utf8');
        }

        while (iteration < maxIterations && hasChanges) {
          iteration++;
          console.log(`\n🔄 Review Loop Iteration ${iteration}/${maxIterations}...`);

          // Stage all files and capture baseline state before running the agent
          await execFileAsync('git', ['add', '-A']);
          const { stdout: beforeStatus } = await execFileAsync('git', ['status', '--porcelain']);
          const beforeDiff = await getGitDiff();

          if (!beforeDiff || beforeDiff.trim() === '') {
            console.log('\n✅ No staged changes found to review. Breaking loop.');
            hasChanges = false;
            break;
          }

          // Programmatically retrieve modified files and their full contents
          const { stdout: diffFilesRaw } = await execFileAsync('git', ['diff', '--no-ext-diff', '--name-only', 'HEAD']);
          const changedFiles = diffFilesRaw
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);

          let modifiedFilesContext = '';
          for (const relPath of changedFiles) {
            const fullPath = path.join(repoRoot, relPath);
            if (await exists(fullPath)) {
              try {
                const content = await fs.readFile(fullPath, 'utf8');
                modifiedFilesContext += `\n<file path="${relPath}">\n${content}\n</file>\n`;
              } catch (err) {
                console.debug(`[DEBUG] Could not read modified file ${relPath}: ${err.message}`);
              }
            }
          }

          const reviewPrompt = `Please review the staged code and the active plan, then implement any surgical improvements or suggestions you have that are strictly within scope of the plan. If you don't have any suggestions, respond stating that the code looks good and make no file modifications. Don't plan, invoke, or commit. Make sure lint.sh and test.sh workflow scripts pass with the 'all' option.

<active_plan>
${activePlan}
</active_plan>

<git_diff>
${beforeDiff}
</git_diff>

<modified_files>
${modifiedFilesContext.trim()}
</modified_files>`;

          // Run thinking agent
          await runAgentSession({
            initialPrompt: reviewPrompt,
            systemInstructions: implementInstructions,
            requestedModel: models.pro,
            maxTurnsOverride: 20,
            rl,
          });

          // Check for new modifications by comparing against baseline state
          const { stdout: afterStatus } = await execFileAsync('git', ['status', '--porcelain']);
          const afterDiff = await getGitDiff();
          if (beforeStatus.trim() === afterStatus.trim() && beforeDiff === afterDiff) {
            console.log('\n✅ No further changes suggested by agent. Breaking loop.');
            hasChanges = false;
          } else {
            console.log('\n📝 Agent made changes. Looping again...');
          }
        }

        if (hasChanges) {
          console.log('\n⚠️ Reached maximum iterations (15) without resolving all changes.');
        }
      } else {
        await runAgentSession({
          initialPrompt: implementPrompt,
          systemInstructions: implementInstructions,
          requestedModel: models.pro,
          rl,
        });
      }
      console.log('\n✅ Implementation session completed.');
    } catch (err) {
      console.error(`❌ Implementation failed: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    // Programmatic verification of scope boundaries
    if (selection === '4') {
      // Check if any product files were altered using git diff
      const modifiedList = await getGitDiff();
      const modifiedFiles = new Set();

      modifiedList.split('\n').forEach((line) => {
        if (line.startsWith('+++ b/')) {
          modifiedFiles.add(line.substring(6));
        }
        if (line.startsWith('--- a/')) {
          modifiedFiles.add(line.substring(6));
        }
      });

      const invalidChanges = Array.from(modifiedFiles).filter((f) => {
        if (f === 'dev/null') {
          return false;
        }
        const parts = f.split('/');
        const isInTestDir = parts.slice(0, -1).some((p) => p === 'test' || p === 'tests');
        const isGoTest = f.endsWith('_test.go');
        const isJsTest =
          (f.endsWith('.test.js') || f.endsWith('.spec.js')) &&
          (f.startsWith('agent-scripts/') || f.startsWith('.github/workflows/scripts/'));

        return !isInTestDir && !isGoTest && !isJsTest;
      });

      if (invalidChanges.length > 0) {
        console.error(
          `❌ Safety violation: Product files were modified during a Test-only task: ${invalidChanges.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
    }

    if (selection === '6') {
      console.log('\n--- 📦 Phase 3: Final Review & Summary ---');
      await execFileAsync('git', ['add', '-A']);
      const diffText = await getGitDiff();
      if (!diffText || diffText.trim() === '') {
        console.log('✅ No changes were made in the review loop.');
        return;
      }

      console.log('Asking Gemini to generate a summary, commit message, and PR description...');
      const summaryPrompt = `Based on the following git diff, please generate a final summary of all changes made, a proposed single-line conventional commit message, and a PR description. Do NOT make any further code changes. Output the response clearly formatted:\n\n${diffText}`;

      const summaryMsg = await runAgentSession({
        initialPrompt: summaryPrompt,
        systemInstructions:
          'You are a technical reviewer. Summarize the changes provided without modifying any files or calling tools.',
        requestedModel: models.flash_lite,
        blockTools: ['write_file', 'replace', 'create_file', 'edit_file', 'run_shell_command'],
        rl,
      });

      console.log('\n======================================');
      console.log('📝 FINAL REVIEW SUMMARY:');
      console.log('======================================');
      console.log(summaryMsg);
      console.log('======================================\n');
      console.log('✅ Review loop complete. Please review the changes, commit, and push manually.');
      return;
    }

    // ==========================================
    // PHASE 3: AUTOMATED QA REVIEW
    // ==========================================
    console.log('\n--- 🛡️ Phase 3: Automated QA Review ---');
    let qaAttempts = 0;
    const maxQAAttempts = 3;
    let qaSuccess = false;

    while (qaAttempts < maxQAAttempts && !qaSuccess) {
      qaAttempts++;
      console.log(`\nRunning automated QA pipeline (Attempt ${qaAttempts}/${maxQAAttempts})...`);

      const buildResult = await runQAPipeline();
      if (!buildResult.success) {
        console.error('❌ Tests or linters failed. Initiating self-healing...');
        const healPrompt = `The automated workspace testing or linting pipeline failed with the following errors/findings:
      
Stdout:
${buildResult.stdout}

Stderr:
${buildResult.stderr}

Please analyze these errors and fix the code surgically.`;

        await runAgentSession({
          initialPrompt: healPrompt,
          systemInstructions:
            'You are a QA/Self-Healing assistant. Resolve the test/linter failures reported by the QA pipeline.',
          requestedModel: models.flash,
          blockTools: ['run_shell_command'],
          rl,
        });
        continue;
      }

      console.log('🟢 All tests and linters passed! Invoking QA Agent for safety review...');

      const qaConfig = await loadAgentInstructions('quality_assurance');
      const diffText = await getGitDiff();
      const planPath = planFileFound || path.join(repoRoot, 'plans/current.md');
      let activePlan = '';
      if (await exists(planPath)) {
        activePlan = await fs.readFile(planPath, 'utf8');
      }

      const qaPrompt = `Please review the proposed changes for code quality, strict adherence to the project conventions, and security. Output a strict JSON object with 'approval_status': 'APPROVED' | 'UNAPPROVED' and a 'findings' array detailing any issues, or an empty array if approved.

<active_plan>
${activePlan}
</active_plan>

<git_diff>
${diffText}
</git_diff>`;

      try {
        const qaResultText = await runAgentSession({
          initialPrompt: qaPrompt,
          systemInstructions: qaConfig.instructions || 'You are a strict QA Review Agent. Output JSON.',
          requestedModel: qaConfig.model || models.flash,
          blockTools: ['write_file', 'replace', 'create_file', 'edit_file', 'run_shell_command'],
          rl,
        });

        const qaReportObj = await validateAgentOutput(qaResultText, qaSchema, qaConfig?.model || models?.flash);
        if (!qaReportObj) {
          console.error('❌ Failed to parse QA Agent JSON report.');
          continue;
        }

        const isApproved =
          qaReportObj.approval_status === 'APPROVED' &&
          Array.isArray(qaReportObj.findings) &&
          qaReportObj.findings.length === 0;

        if (isApproved) {
          console.log('🟢 QA Agent approved the changes!');
          qaSuccess = true;
        } else {
          console.error('❌ QA Agent found issues:', JSON.stringify(qaReportObj.findings, null, 2));
          const healPrompt = `The QA Agent rejected the changes with these findings:\n${JSON.stringify(qaReportObj.findings, null, 2)}\nPlease analyze and fix the code surgically.`;

          await runAgentSession({
            initialPrompt: healPrompt,
            systemInstructions: 'You are a QA/Self-Healing assistant. Resolve the issues reported by QA.',
            requestedModel: models.flash,
            blockTools: ['run_shell_command'],
            rl,
          });
        }
      } catch (err) {
        console.error(`❌ QA Agent execution failed: ${err.message}`);
        continue;
      }
    }

    if (!qaSuccess) {
      console.error('❌ Error: Automated QA Review failed after maximum retry attempts. Exiting.');
      process.exitCode = 1;
      return;
    }

    // ==========================================
    // PHASE 4: FINAL USER REVIEW & COMMIT
    // ==========================================
    console.log('\n--- 📦 Phase 4: Final User Review & Commit ---');

    const diffText = await getGitDiff();
    if (!diffText || diffText.trim() === '') {
      console.log('🟢 QA passed but no changes were detected in Git. Session complete!');
      return;
    }

    const initialDiffHash = crypto.createHash('sha256').update(stripDiffMetadata(diffText)).digest('hex');

    console.log('\n======================================');
    console.log('🔍 PROPOSED CHANGES (git diff):');
    console.log('======================================');
    console.log(diffText);
    console.log('======================================\n');
    console.log(`🔐 Cryptographic Diff Hash (SHA-256): ${initialDiffHash}\n`);

    const finalApproval = await rl.question('👉 Do you approve these changes for commit? (yes/no): ');
    if (finalApproval.trim().toLowerCase() !== 'yes') {
      console.log('❌ Commit cancelled by developer. Sourcing/modifications are left in working directory.');
      return;
    }

    // Cryptographic Verification: Calculate the hash again right before staging
    const preStagingDiff = await getGitDiff();
    const preStagingDiffHash = crypto.createHash('sha256').update(stripDiffMetadata(preStagingDiff)).digest('hex');

    if (preStagingDiffHash !== initialDiffHash) {
      console.error('❌ Cryptographic Verification Error: Active diff hash changed after user approval!');
      process.exitCode = 1;
      return;
    }
    console.log('🔒 Cryptographic diff hash successfully verified!');

    console.log('Asking Gemini to generate a commit message candidate...');
    const commitPrompt = `Generate a single-line, highly descriptive and concise git commit message conforming to Conventional Commits format (e.g., "feat: add feature X" or "fix: resolve bug Y") based strictly on this diff:
\n\n${diffText}`;

    const defaultMsgRaw = await runAgentSession({
      initialPrompt: commitPrompt,
      systemInstructions:
        'You are a professional software engineer. Generate a single-line conventional commit message with NO quotes, markdown, or preambles.',
      requestedModel: models.flash_lite,
      blockTools: ['write_file', 'replace', 'create_file', 'edit_file'],
      rl,
    });

    const defaultMsg = defaultMsgRaw.trim().replace(/^['"`]+|['"`]+$/g, '');

    let commitApproved = false;
    let finalMsg = '';

    while (!commitApproved) {
      console.log(`\nProposed commit message: "${defaultMsg}"`);
      const userMsg = await rl.question('Enter commit message (or press enter for default): ');
      const candidateMsg = userMsg.trim() || defaultMsg;

      if (!candidateMsg) {
        console.error('❌ Error: Commit message is empty. Please enter a valid commit message.');
        continue;
      }

      if (candidateMsg.length > 100) {
        console.error(
          `❌ Error: Commit message should be less than 100 characters (currently ${candidateMsg.length}).`,
        );
        continue;
      }

      // Programmatically validate message
      const validation = await validateMessage(candidateMsg);
      if (!validation.valid) {
        console.error(`❌ Error: ${validation.reason}`);
        console.log('Please adjust your commit type or description according to conventional commit guidelines.');
        continue;
      }

      finalMsg = candidateMsg;
      commitApproved = true;
    }

    console.log(`Committing: ${finalMsg}`);
    try {
      await stageAndCommit(finalMsg);
      console.log('🟢 Changes committed successfully!');
    } catch (err) {
      console.error(`❌ Commit failed:\n${err.message}`);
      process.exitCode = 1;
      return;
    }
  } finally {
    await flushLogs();
    rl.close();
  }
}

main().catch(async (err) => {
  console.error('❌ Fatal Orchestrator Error:', err.stack || err.message);
  if (rl) {
    rl.close();
  }
  await flushLogs();
  process.exitCode = 1;
});
