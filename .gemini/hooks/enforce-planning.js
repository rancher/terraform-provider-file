#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { checkActivePlan } from '../../agent-scripts/planning.js';

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = inputData;

  // We only inspect write_file and replace
  if (tool_name !== 'write_file' && tool_name !== 'replace') {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const filePath = tool_input.file_path;
  if (!filePath) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Anti-Bypass Guardrail: Unconditionally deny any manual writing, editing, or spoofing of all gate signature/challenge files
  if (/(plan-approval|test-approval|review-approval|user-approval)\.(json|challenge|age)$/.test(filePath)) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          'Security Policy Violation: Manually writing, editing, or spoofing gate approval/challenge files is strictly prohibited.\n\n' +
          'Gating files must ONLY be generated automatically and securely by our pipeline hooks and sub-agents.\n\n' +
          'To proceed:\n' +
          '1. Follow the proper zero-trust pipeline sequence (Plan -> Test -> Review -> Commit).\n' +
          '2. Never attempt to manually create, edit, or spoof gating JSON, challenge, or age files.',
        systemMessage: '🔒 Security Block: Direct modification of approval files is prohibited.',
      }),
    );
    process.exit(0);
  }

  // Resolve absolute path to check if it's within .gemini/ or .claude/
  const resolvedPath = path.resolve(cwd || process.cwd(), filePath);
  const relativePath = path.relative(cwd || process.cwd(), resolvedPath);
  const relativePathNormalized = relativePath.replace(/\\/g, '/');
  const homeDir = process.env.HOME || '/tmp';

  // If the file is inside the .gemini or .claude directories, we always allow.
  if (
    relativePathNormalized.startsWith('.gemini/') ||
    relativePathNormalized.startsWith('.claude/') ||
    resolvedPath.startsWith(path.join(homeDir, '.gemini')) ||
    resolvedPath.startsWith(path.join(homeDir, '.claude')) ||
    relativePathNormalized === 'AGENTS.md' ||
    relativePathNormalized === 'GEMINI.md'
  ) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Check if there is an active/modified plan in git status via generic utility call
  const hasActivePlan = checkActivePlan(cwd);

  if (!hasActivePlan) {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason:
          'Security Policy Violation: Modifying source code is strictly prohibited without an active plan.\n\n' +
          "In accordance with Phase 2, Steps 4-5 (Planning, Strategy & Blueprint Synchronization) of 'development-process.md', you MUST first create or update an active blueprint in 'docs/development/' before applying edits to source files.\n\n" +
          'To proceed:\n' +
          "1. Create or update a Component Specification (e.g. 'docs/development/MyTopic/MyComponent.md') containing a high-level abstract and a step-by-step '## Implementation Checklist' as detailed in 'blueprints.instructions.md'.\n" +
          '2. Present the plan in chat and obtain explicit developer approval to execute it (Phase 2, Step 5).\n' +
          "3. Once the plan file is created and visible in 'git status', you will be authorized to modify source files.",
        systemMessage:
          '🔒 Security Block: No active plan found. Please comply with Phase 2, Steps 4-5 of development-process.md.',
      }),
    );
    process.exit(0);
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
