import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Saves a sub-agent execution report to disk.
 */
export function saveReport(agentName, report, logsDir) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const reportFile = path.join(logsDir, `${agentName}_report.md`);
    try {
      fs.unlinkSync(reportFile);
    } catch {
      // Ignored
    }
    fs.writeFileSync(reportFile, report, { mode: 0o600 });
  } catch (err) {
    console.error(`🔒 Hook Error: Failed to write sub-agent report for ${agentName}:`, err.message);
  }
}

/**
 * Verifies a test sub-agent report and writes the Gate 2 signature if successful.
 */
export function verifyTestReport(report, diffHash, planHash, testApprovalFile) {
  const isSuccess = report.includes('TEST RUN status: 🟢 SUCCESS');

  if (isSuccess) {
    const approvalData = {
      status: 'approved',
      diff_hash: diffHash,
      plan_hash: planHash,
      timestamp: new Date().toISOString(),
    };

    try {
      try {
        fs.unlinkSync(testApprovalFile);
      } catch {
        // Ignored
      }
      fs.writeFileSync(testApprovalFile, JSON.stringify(approvalData, null, 2), { mode: 0o600 });
      return {
        status: 'approved',
        systemMessage:
          '✅ Gate 2 Approved: Testing sub-agent report verified. Gate 2 signature successfully written and chained!',
      };
    } catch (err) {
      console.error('🔒 Hook Error: Failed to write Gate 2 signature:', err.message);
      return { status: 'error', error: err.message };
    }
  } else {
    // Self-Healing: Revoke existing signature if tests failed
    try {
      fs.unlinkSync(testApprovalFile);
    } catch {
      // Ignored
    }
    return {
      status: 'rejected',
      systemMessage: '❌ Gate 2 Rejected: Testing sub-agent reported failures. Gate 2 signature revoked/missing.',
    };
  }
}

/**
 * Verifies a review sub-agent report and writes the Gate 3 signature if successful.
 */
export function verifyReviewReport(report, diffHash, planHash, reviewApprovalFile, testApprovalFile) {
  const isSuccess = report.includes('PR Review status: 🟢 PERFECT - 0 findings.');

  if (isSuccess) {
    // Hook enforces Gate 2 must also be valid! (Review requires Tests to be passed)
    if (!fs.existsSync(testApprovalFile)) {
      return {
        status: 'gated',
        systemMessage:
          '🔒 Hook Notification: Review agent completed with 0 findings, but Gate 3 (Review Gate) cannot be signed because Gate 2 (Testing Gate) is missing!',
      };
    }

    try {
      const testContent = JSON.parse(fs.readFileSync(testApprovalFile, 'utf-8'));
      if (testContent.diff_hash !== diffHash || testContent.plan_hash !== planHash) {
        return {
          status: 'gated',
          systemMessage:
            '🔒 Hook Notification: Review agent completed with 0 findings, but Gate 3 cannot be signed because the current diff/plan does not match Gate 2 (Testing Gate).',
        };
      }

      const approvalData = {
        status: 'approved',
        message: 'PR Review status: 🟢 PERFECT - 0 findings.',
        commit_sha: execSync('git rev-parse HEAD 2>/dev/null || echo "unknown"', {
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim(),
        diff_hash: diffHash,
        plan_hash: planHash,
        timestamp: new Date().toISOString(),
      };

      try {
        fs.unlinkSync(reviewApprovalFile);
      } catch {
        // Ignored
      }
      fs.writeFileSync(reviewApprovalFile, JSON.stringify(approvalData, null, 2), { mode: 0o600 });
      return {
        status: 'approved',
        systemMessage:
          '✅ Gate 3 Approved: Review sub-agent report verified. Gate 3 signature successfully written and chained!',
      };
    } catch (err) {
      console.error('🔒 Hook Error: Failed to write Gate 3 signature:', err.message);
      return { status: 'error', error: err.message };
    }
  } else {
    // Self-Healing: Revoke existing signature if review failed
    try {
      fs.unlinkSync(reviewApprovalFile);
    } catch {
      // Ignored
    }
    return {
      status: 'rejected',
      systemMessage: '❌ Gate 3 Rejected: Review sub-agent reported violations. Gate 3 signature revoked/missing.',
    };
  }
}
