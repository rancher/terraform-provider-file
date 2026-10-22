#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { GeminiCliAgent } from '@google/gemini-cli-sdk';
import { initializeAgentRunner } from './lib/agent-runner.js';
import { getRepoRoot, loadWorkspaceSkillsContext } from './lib/utils.js';

function hash(text) {
  return crypto
    .createHash('sha256')
    .update(text || '', 'utf8')
    .digest('hex');
}

/**
 * Dumps and compares the system prompt between interactive Gemini CLI sessions
 * and agents spawned by the orchestrator Ralph Loop.
 */
async function main() {
  await initializeAgentRunner();
  const repoRoot = await getRepoRoot();

  console.log('🔍 System Prompt Inspection & Comparison');
  console.log('==========================================');

  // 1. Interactive Session System Prompt
  const interactiveAgent = new GeminiCliAgent({
    model: 'gemini-3.8-flash',
  });
  const interactiveSession = interactiveAgent.session();
  await interactiveSession.initialize();
  const interactivePrompt = interactiveSession.client.getChat().getSystemInstruction() || '';

  // 2. Orchestrator Reviewer Agent (pro model, thinking reviewer)
  const reviewerInstructions =
    'You are a senior technical reviewer. Review the staged code against the active plan in plans/current.md. Output ONLY a numbered list of at least 5 suggestions with severity ratings [critical], [medium], or [minor]. Do NOT modify files or call mutating tools. You may use grep_search to inspect code.';
  const reviewerAgent = new GeminiCliAgent({
    model: 'gemini-3.1-pro-preview',
    max_turns: 5,
    instructions: reviewerInstructions,
    tools: [],
  });
  const reviewerSession = reviewerAgent.session();
  await reviewerSession.initialize();
  const reviewerPrompt = reviewerSession.client.getChat().getSystemInstruction() || '';

  // 3. Orchestrator Implementer Agent (flash model, single-suggestion Ralph loop)
  const skillsContext = await loadWorkspaceSkillsContext(repoRoot);
  const implementerInstructions =
    'You are an expert engineer in the IMPLEMENTATION phase of the review loop. Pick and implement JUST ONE suggestion from the remaining list. Ensure all tests and linters pass cleanly.' +
    (skillsContext ? `\n\n${skillsContext}` : '');
  const implementerAgent = new GeminiCliAgent({
    model: 'gemini-3.8-flash',
    max_turns: 20,
    instructions: implementerInstructions,
  });
  const implementerSession = implementerAgent.session();
  await implementerSession.initialize();
  const implementerPrompt = implementerSession.client.getChat().getSystemInstruction() || '';

  // Calculate Metrics
  const interactiveHash = hash(interactivePrompt);
  const reviewerHash = hash(reviewerPrompt);
  const implementerHash = hash(implementerPrompt);

  console.log('\n📊 Session Prompt Metrics:');
  console.log(`- Interactive Prompt:  ${interactivePrompt.length} chars | SHA256: ${interactiveHash.slice(0, 16)}...`);
  console.log(`- Reviewer Prompt:     ${reviewerPrompt.length} chars | SHA256: ${reviewerHash.slice(0, 16)}...`);
  console.log(`- Implementer Prompt:  ${implementerPrompt.length} chars | SHA256: ${implementerHash.slice(0, 16)}...`);

  const reviewerMatchesInteractive = interactivePrompt === reviewerPrompt;
  const implementerMatchesInteractive = interactivePrompt === implementerPrompt;
  const allMatch = reviewerMatchesInteractive && implementerMatchesInteractive;

  console.log('\n📋 Direct Equivalence Validation:');
  console.log(`- Reviewer === Interactive:    ${reviewerMatchesInteractive ? 'MATCH' : 'MISMATCH'}`);
  console.log(`- Implementer === Interactive: ${implementerMatchesInteractive ? 'MATCH' : 'MISMATCH'}`);
  console.log(`- Unified Baseline Enforced:   ${allMatch ? 'VALIDATED' : 'DISCREPANCY'}`);

  // Dump prompt contents to temporary snapshot
  const dumpFile = '/tmp/dumped-system-prompt.md';
  await fs.writeFile(dumpFile, interactivePrompt, 'utf8');
  console.log(`\n💾 Unified system prompt snapshot written to: ${dumpFile}`);
}

main().catch((err) => {
  console.error(`❌ Inspection failed: ${err.message}`);
  process.exitCode = 1;
});
