#!/usr/bin/env node
//
// Hook: subagent-report-gate.js
// Description: SubagentStop controller. Registered twice in settings.json (once per
//              matcher: "testing-agent" and "review-agent"), with the expected agent
//              name passed as argv[2] so we don't have to rely on an unconfirmed
//              payload field to know which subagent just finished. Reads the
//              subagent's own transcript, extracts its final report text, and
//              delegates to the shared, tool-agnostic agent-scripts/after-invoke.js
//              (unmodified) to write or revoke the Gate 2/3 signature.
//
// Note: the exact JSON shape of a subagent's transcript is less firmly documented
// than the PreToolUse/PostToolUse contract, so this is intentionally defensive:
// on any parse failure it fails closed (no signature written/revoked silently)
// rather than guessing.
//

import fs from 'fs';
import path from 'path';
import { calculateDiffHash, verifyPlanGate } from '../../agent-scripts/gating.js';
import { saveReport, verifyTestReport, verifyReviewReport } from '../../agent-scripts/after-invoke.js';
import { getStateDir } from './lib/state-dir.js';

const TARGET_DIR = getStateDir();
const LOGS_DIR = path.join(TARGET_DIR, 'logs');
const TEST_APPROVAL_FILE = path.join(TARGET_DIR, 'test-approval.json');
const REVIEW_APPROVAL_FILE = path.join(TARGET_DIR, 'review-approval.json');

function revokeGate(expectedAgent) {
  try {
    if (expectedAgent === 'testing-agent') {
      fs.unlinkSync(TEST_APPROVAL_FILE);
      console.error(
        '❌ Gate 2 Revoked: Stale testing signature deleted because the subagent run failed or was unparsable.',
      );
    } else if (expectedAgent === 'review-agent') {
      fs.unlinkSync(REVIEW_APPROVAL_FILE);
      console.error(
        '❌ Gate 3 Revoked: Stale review signature deleted because the subagent run failed or was unparsable.',
      );
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('🔒 Hook Error: Failed to revoke gate signature:', err.message || err);
    }
  }
}

function extractFinalAssistantText(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
  } catch (err) {
    console.error(`🔒 Hook Debug: Failed to read transcript at ${transcriptPath}:`, err.message || err);
    return null;
  }

  let lastText = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const message = entry.message || entry;
    const role = message.role || entry.role || entry.type;
    if (role !== 'assistant') {
      continue;
    }

    const content = message.content;
    if (typeof content === 'string') {
      lastText = content;
    } else if (Array.isArray(content)) {
      const textBlocks = content.filter((block) => block && block.type === 'text' && typeof block.text === 'string');
      if (textBlocks.length > 0) {
        lastText = textBlocks.map((block) => block.text).join('\n');
      }
    }
  }

  return lastText;
}

function main() {
  const expectedAgent = process.argv[2];

  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err.message || err);
    process.exit(0);
  }

  const declaredAgent = inputData.subagent_type || inputData.agent_type || inputData.agentType;
  if (declaredAgent && expectedAgent && declaredAgent !== expectedAgent) {
    process.exit(0);
  }

  const transcriptPath = inputData.transcript_path;
  if (!transcriptPath) {
    console.error('🔒 Hook Debug: No transcript_path provided; skipping gate signature and revoking stale states.');
    revokeGate(expectedAgent);
    process.exit(0);
  }

  const report = extractFinalAssistantText(transcriptPath);
  if (!report) {
    console.error(
      '🔒 Hook Debug: Could not extract a final report from the subagent transcript; revoking stale states.',
    );
    revokeGate(expectedAgent);
    process.exit(0);
  }

  saveReport(expectedAgent || 'subagent', report, LOGS_DIR);

  const planHash = verifyPlanGate(TARGET_DIR);
  if (!planHash) {
    console.error(
      `🔒 Hook Notification: Sub-agent ${expectedAgent} finished but no signature was written because Gate 1 (Planning Gate) is missing or invalid.`,
    );
    process.exit(0);
  }

  const diffHash = calculateDiffHash();

  let result;
  if (expectedAgent === 'testing-agent') {
    result = verifyTestReport(report, diffHash, planHash, TEST_APPROVAL_FILE);
  } else if (expectedAgent === 'review-agent') {
    result = verifyReviewReport(report, diffHash, planHash, REVIEW_APPROVAL_FILE, TEST_APPROVAL_FILE);
  } else {
    process.exit(0);
  }

  if (result && result.systemMessage) {
    console.error(result.systemMessage);
  }

  process.exit(0);
}

main();
