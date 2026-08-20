import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

// Calculate SHA-256 hash of a file's content
export function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateFileHash failed:', err.message || err);
    return null;
  }
}

// Calculate active local diff hash securely (staged + unstaged combined)
export function calculateDiffHash() {
  try {
    const diff = execSync('git diff HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return crypto.createHash('sha256').update(diff).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateDiffHash failed:', err.message || err);
    return null;
  }
}

// Automatically scans the Gemini tmp directories to find the latest active plan file
export function findLatestActivePlan(targetDir) {
  try {
    const activeSessions = fs.readdirSync(targetDir);
    const planFiles = [];

    for (const session of activeSessions) {
      const plansPath = path.join(targetDir, session, 'plans');
      if (fs.existsSync(plansPath) && fs.statSync(plansPath).isDirectory()) {
        const files = fs.readdirSync(plansPath);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(plansPath, file);
            planFiles.push({
              path: filePath,
              mtime: fs.statSync(filePath).mtimeMs,
            });
          }
        }
      }
    }

    if (planFiles.length === 0) {
      return null;
    }

    planFiles.sort((a, b) => b.mtime - a.mtime);
    return planFiles[0].path;
  } catch (err) {
    console.error('🔒 Hook Debug: findLatestActivePlan failed:', err.message || err);
    return null;
  }
}

// Verify Gate 1: Plan Gate and return plan_hash
export function verifyPlanGate(targetDir) {
  const planApprovalFile = path.join(targetDir, 'plan-approval.json');
  const planChallengeFile = path.join(targetDir, 'plan-approval.challenge');

  if (!fs.existsSync(planApprovalFile) || !fs.existsSync(planChallengeFile)) {
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(planApprovalFile, 'utf-8'));
    const challenge = JSON.parse(fs.readFileSync(planChallengeFile, 'utf-8'));

    if (content.status !== 'approved') {
      return null;
    }

    const token = content.challenge_token;
    if (!token) {
      return null;
    }

    const calculatedHash = crypto.createHash('sha256').update(token).digest('hex');
    if (calculatedHash !== challenge.challenge_hash) {
      return null;
    }

    const activePlan = findLatestActivePlan(targetDir);
    if (!activePlan) {
      return null;
    }

    const currentPlanHash = calculateFileHash(activePlan);
    if (content.plan_hash !== currentPlanHash) {
      return null;
    }

    return content.plan_hash;
  } catch (err) {
    console.error('🔒 Hook Debug: verifyPlanGate failed:', err.message || err);
    return null;
  }
}

// Verify Gate 2: Test Gate
export function verifyTestGate(targetDir, expectedPlanHash, activeDiffHash) {
  const testApprovalFile = path.join(targetDir, 'test-approval.json');

  if (!fs.existsSync(testApprovalFile)) {
    return false;
  }

  try {
    const content = JSON.parse(fs.readFileSync(testApprovalFile, 'utf-8'));
    if (content.status !== 'approved') {
      return false;
    }

    if (content.plan_hash !== expectedPlanHash) {
      return false;
    }

    if (content.diff_hash !== activeDiffHash) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('🔒 Hook Debug: verifyTestGate failed:', err.message || err);
    return false;
  }
}

// Verify Gate 3: Review Gate
export function verifyReviewGate(targetDir, expectedDiffHash, expectedPlanHash) {
  const reviewApprovalFile = path.join(targetDir, 'review-approval.json');

  if (!fs.existsSync(reviewApprovalFile)) {
    return false;
  }

  try {
    const content = JSON.parse(fs.readFileSync(reviewApprovalFile, 'utf-8'));
    if (content.status !== 'approved') {
      return false;
    }

    if (content.plan_hash !== expectedPlanHash) {
      return false;
    }
    if (content.diff_hash !== expectedDiffHash) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('🔒 Hook Debug: verifyReviewGate failed:', err.message || err);
    return false;
  }
}

// Check and actively revoke stale signatures (Gate 2/3) if the diff hash has changed
export function checkAndRevokeStaleGates(targetDir, activeDiffHash, expectedPlanHash) {
  const testApprovalFile = path.join(targetDir, 'test-approval.json');
  const reviewApprovalFile = path.join(targetDir, 'review-approval.json');

  let hasRevoked = false;

  // Check test approval
  if (fs.existsSync(testApprovalFile)) {
    try {
      const content = JSON.parse(fs.readFileSync(testApprovalFile, 'utf-8'));
      if (
        activeDiffHash &&
        expectedPlanHash &&
        (content.diff_hash !== activeDiffHash || content.plan_hash !== expectedPlanHash)
      ) {
        fs.unlinkSync(testApprovalFile);
        console.error(
          '❌ Active Gate Revocation: Stale testing signature deleted because workspace changes were modified since your last test run!',
        );
        hasRevoked = true;
      }
    } catch {
      // If unparsable, delete it
      try {
        fs.unlinkSync(testApprovalFile);
      } catch {}
      hasRevoked = true;
    }
  }

  // Check review approval
  if (fs.existsSync(reviewApprovalFile)) {
    try {
      const content = JSON.parse(fs.readFileSync(reviewApprovalFile, 'utf-8'));
      if (
        activeDiffHash &&
        expectedPlanHash &&
        (content.diff_hash !== activeDiffHash || content.plan_hash !== expectedPlanHash)
      ) {
        fs.unlinkSync(reviewApprovalFile);
        console.error(
          '❌ Active Gate Revocation: Stale review signature deleted because workspace changes were modified since your last review!',
        );
        hasRevoked = true;
      }
    } catch {
      // If unparsable, delete it
      try {
        fs.unlinkSync(reviewApprovalFile);
      } catch {}
      hasRevoked = true;
    }
  }

  return hasRevoked;
}
