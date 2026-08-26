import fs from 'fs';
import path from 'path';
import { handleCommitApproval } from './agent-scripts/after-ask.js';
import {
  calculateDiffHash,
  checkAndRevokeStaleGates,
  verifyPlanGate,
  verifyReviewGate,
} from './agent-scripts/gating.js';
import { resolveTargetDir } from './agent-scripts/workspace.js';

const targetDir = '/Users/matt.trachier/.gemini/tmp/terraform-provider-file';
try {
  const planHash = verifyPlanGate(targetDir);
  console.log('Plan Hash:', planHash);
  const diffHash = calculateDiffHash();
  console.log('Diff Hash:', diffHash);
  checkAndRevokeStaleGates(targetDir, diffHash, planHash);
  const reviewPassed = verifyReviewGate(targetDir, diffHash, planHash);
  console.log('Review Passed:', reviewPassed);
} catch (err) {
  console.error('CRASH ERROR:', err.stack || err);
}
