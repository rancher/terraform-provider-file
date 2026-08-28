import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { calculateDiffHash, calculateFileHash, findLatestActivePlan } from './gating.js';

/**
 * Handles the Planning Gate 1 biometric GPG signing challenge and output.
 */
export function handlePlanApproval(targetDir, pubKeyFile, promptText) {
  let planContent = '';
  const matchCodeBlock = promptText.match(/```markdown\n([\s\S]*?)\n```/);
  if (matchCodeBlock) {
    planContent = matchCodeBlock[1];
  } else {
    const hashIdx = promptText.indexOf('# ');
    if (hashIdx !== -1) {
      planContent = promptText.substring(hashIdx);
    }
  }

  let activePlan = findLatestActivePlan(targetDir);
  if (!activePlan && planContent) {
    const activeSessions = fs.readdirSync(targetDir);
    let plansDir = null;
    for (const session of activeSessions) {
      const plansPath = path.join(targetDir, session, 'plans');
      if (fs.existsSync(plansPath) && fs.statSync(plansPath).isDirectory()) {
        plansDir = plansPath;
        break;
      }
    }
    if (plansDir) {
      const matchTitle = planContent.match(/^#\s+(.+)$/m);
      const title = matchTitle ? matchTitle[1].trim().replace(/[^a-zA-Z0-9-_]/g, '') : 'Plan';
      activePlan = path.join(plansDir, `${title}.md`);
    }
  }

  if (planContent && activePlan) {
    try {
      fs.writeFileSync(activePlan, planContent, { mode: 0o600 });
      console.error(`🔒 Hook Info: Successfully bypassed write block to save plan to ${activePlan}`);
    } catch (err) {
      console.error(`🔒 Hook Error: Failed to write plan to ${activePlan}:`, err.message);
    }
  }

  activePlan = activePlan || findLatestActivePlan(targetDir);
  if (!activePlan) {
    console.error('🔒 Cryptographic Pipeline Error: Active plan file not found.');
    process.exit(1);
  }
  const planHash = calculateFileHash(activePlan);
  if (!planHash) {
    console.error('🔒 Cryptographic Pipeline Error: Failed to calculate active plan hash.');
    process.exit(1);
  }

  const envelope = {
    status: 'approved',
    plan_file: activePlan,
    plan_hash: planHash,
    timestamp: new Date().toISOString(),
  };

  try {
    const envelopeJson = JSON.stringify(envelope, null, 2);
    const approvalFile = path.join(targetDir, 'plan-approval.json');
    const signatureFile = path.join(targetDir, 'plan-approval.json.sig');

    fs.rmSync(approvalFile, { force: true });
    fs.rmSync(signatureFile, { force: true });

    fs.writeFileSync(approvalFile, envelopeJson);
    const privKeyFile = pubKeyFile.endsWith('.pub') ? pubKeyFile.slice(0, -4) : pubKeyFile;
    const pubKeyPath = privKeyFile + '.pub';

    // Validate that public key exists, and either private key exists or SSH agent is running
    const hasPrivKey = fs.existsSync(privKeyFile);
    const hasPubKey = fs.existsSync(pubKeyPath);
    if (!hasPubKey || (!hasPrivKey && !process.env.SSH_AUTH_SOCK)) {
      console.error(
        `🔒 Cryptographic Pipeline Error: Missing key pair or active SSH agent. Public key (${pubKeyPath}) must exist, and either private key (${privKeyFile}) must exist or SSH_AUTH_SOCK must be active.`,
      );
      process.exit(1);
    }

    execFileSync('ssh-keygen', ['-Y', 'sign', '-f', privKeyFile, '-n', 'gemini', approvalFile]);

    return {
      status: 'approved',
      systemMessage: '✅ Gate 1 Approved: Secure Enclave Touch ID validated. Plan cryptographically signed!',
    };
  } catch (err) {
    console.error(
      '🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave plan decryption:',
      err.message || err,
    );
    process.exit(1);
  }
}

// Handles the Commit Gate 3 GPG/SSH signing challenge and automatic commit/push.
export function handleCommitApproval(targetDir, pubKeyFile, promptText) {
  const activePlan = findLatestActivePlan(targetDir);
  const planHash = activePlan ? calculateFileHash(activePlan) : 'unknown';
  const diffHash = calculateDiffHash();

  if (!diffHash) {
    console.error('🔒 Cryptographic Pipeline Error: Failed to calculate active diff hash.');
    process.exit(1);
  }

  const envelope = {
    status: 'approved',
    diff_hash: diffHash,
    plan_hash: planHash,
    timestamp: new Date().toISOString(),
  };

  try {
    const envelopeJson = JSON.stringify(envelope, null, 2);
    const approvalFile = path.join(targetDir, 'user-approval.json');
    const signatureFile = path.join(targetDir, 'user-approval.json.sig');

    fs.rmSync(approvalFile, { force: true });
    fs.rmSync(signatureFile, { force: true });

    fs.writeFileSync(approvalFile, envelopeJson);
    const privKeyFile = pubKeyFile.endsWith('.pub') ? pubKeyFile.slice(0, -4) : pubKeyFile;
    const pubKeyPath = privKeyFile + '.pub';

    // Validate that public key exists, and either private key exists or SSH agent is running
    const hasPrivKey = fs.existsSync(privKeyFile);
    const hasPubKey = fs.existsSync(pubKeyPath);
    if (!hasPubKey || (!hasPrivKey && !process.env.SSH_AUTH_SOCK)) {
      console.error(
        `🔒 Cryptographic Pipeline Error: Missing key pair or active SSH agent. Public key (${pubKeyPath}) must exist, and either private key (${privKeyFile}) must exist or SSH_AUTH_SOCK must be active.`,
      );
      process.exit(1);
    }

    execFileSync('ssh-keygen', ['-Y', 'sign', '-f', privKeyFile, '-n', 'gemini', approvalFile]);

    console.log(
      JSON.stringify({
        decision: 'allow',
        systemMessage:
          '✅ Gate 3 Approved: Secure Enclave Touch ID validated. Developer Commit cryptographically signed!',
      }),
    );

    // Run the automated execution in a decoupled block
    try {
      let commitMessage = '';
      const reviewApprovalFile = path.join(targetDir, 'review-approval.json');
      if (fs.existsSync(reviewApprovalFile)) {
        try {
          const approvalData = JSON.parse(fs.readFileSync(reviewApprovalFile, 'utf-8'));
          if (approvalData.suggested_commit_message) {
            commitMessage = approvalData.suggested_commit_message;
          }
        } catch (err) {
          console.error('🔒 Hook Debug: Failed to read suggested commit message from review approval:', err.message);
        }
      }

      if (!commitMessage) {
        // Extract suggested commit message from the report using a backreference to match quotes resiliently
        const matchCommit =
          promptText.match(/(?:Commit|Proposed) Message:\s*(["'`])(.*?)\1/i) ||
          promptText.match(/(?:Commit|Proposed) Message:\s*(.*)/i);

        if (matchCommit) {
          commitMessage = (matchCommit[2] !== undefined ? matchCommit[2] : matchCommit[1]).trim();
        } else if (promptText && promptText.trim() !== '') {
          commitMessage = promptText.trim();
        } else {
          commitMessage = 'chore: automated development commit';
        }
      }

      console.error(`\n🚀 AUTOMATION TRIGGERED: Initiating commit and push...`);

      const pushArgs = ['-m', commitMessage];
      try {
        const activeBranch = execFileSync('git', ['branch', '--show-current'], { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim();
        let hasTracking = '';
        try {
          hasTracking = execFileSync('git', ['rev-parse', '--verify', `origin/${activeBranch}`], {
            stdio: ['ignore', 'pipe', 'ignore'],
          })
            .toString()
            .trim();
        } catch (err) {
          // Tracking reference does not exist yet
          console.error(
            `🔒 Hook Debug: Tracking reference does not exist yet for branch ${activeBranch}:`,
            err.message,
          );
        }
        if (hasTracking) {
          try {
            let isOriginAncestorOfHead = false;
            try {
              execFileSync('git', ['merge-base', '--is-ancestor', `origin/${activeBranch}`, 'HEAD'], {
                stdio: 'ignore',
              });
              isOriginAncestorOfHead = true;
            } catch (err) {
              isOriginAncestorOfHead = false;
              console.error('🔒 Hook Debug: Origin tracking is not ancestor of HEAD:', err.message);
            }

            if (!isOriginAncestorOfHead) {
              console.error(
                '⚠️ [OUT-OF-SYNC] Local branch is out-of-sync with origin tracking ref. Enabling safe force-push (--force-with-lease) automatically.',
              );
              pushArgs.unshift('-f');
            }
          } catch (err) {
            // Ignore rebase detection errors, fallback to standard push args
            console.error('🔒 Hook Debug: Rebase detection failed, falling back to standard push args:', err.message);
          }
        }
      } catch (err) {
        // Fallback safely
        console.error('🔒 Hook Debug: Git tracking check failed, falling back safely:', err.message);
      }

      console.error('🔒 Hook Info: Triggering automated commit and push pipeline...');
      const rootDir = process.cwd();

      const skillScript = path.join(rootDir, '.gemini/skills/commit-push.sh');
      const commitRes = spawnSync('bash', [skillScript, ...pushArgs], {
        env: { ...process.env, COMMIT_LIMIT_OVERRIDE: '100' },
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });

      if (commitRes.stdout && commitRes.stdout.toString().trim()) {
        console.error(commitRes.stdout.toString().trim());
      }
      if (commitRes.stderr && commitRes.stderr.toString().trim()) {
        console.error(commitRes.stderr.toString().trim());
      }

      if (commitRes.status !== 0 || commitRes.error) {
        const errMsg = commitRes.error ? commitRes.error.message : `Command failed with status ${commitRes.status}`;
        const err = new Error(errMsg);
        err.stdout = commitRes.stdout;
        err.stderr = commitRes.stderr;
        throw err;
      }

      // Run PR automation as well
      const prScript = path.join(rootDir, '.gemini/skills/create-pr.sh');
      if (fs.existsSync(prScript)) {
        console.error('🔒 Hook Info: Triggering automated pull request creation pipeline...');
        const prRes = spawnSync('bash', [prScript, '--draft'], {
          env: { ...process.env },
          cwd: rootDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
        });

        if (prRes.stdout && prRes.stdout.toString().trim()) {
          console.error(prRes.stdout.toString().trim());
        }
        if (prRes.stderr && prRes.stderr.toString().trim()) {
          console.error(prRes.stderr.toString().trim());
        }

        if (prRes.status !== 0 || prRes.error) {
          const errMsg = prRes.error ? prRes.error.message : `Command failed with status ${prRes.status}`;
          const err = new Error(errMsg);
          err.stdout = prRes.stdout;
          err.stderr = prRes.stderr;
          throw err;
        }
      }

      process.exit(0);
    } catch (err) {
      const errorLog = path.join(targetDir, 'logs/commit-push-error.log');
      const stdErrText = err.stderr ? err.stderr.toString() : '';
      const stdOutText = err.stdout ? err.stdout.toString() : '';

      try {
        fs.mkdirSync(path.dirname(errorLog), { recursive: true });
        fs.writeFileSync(
          errorLog,
          `Error: ${err.message}\n\n` +
            `--- SCRIPT STDERR ---\n${stdErrText}\n\n` +
            `--- SCRIPT STDOUT ---\n${stdOutText}\n`,
        );
      } catch (logErr) {
        console.error('🔒 Hook Debug: Failed to write error log:', logErr.message || logErr);
      }

      console.error('\n======================================================================');
      console.error('❌ AUTOMATED COMMIT/PUSH PIPELINE FAILURE DETECTED!');
      console.error('======================================================================');
      console.error(`Error Message: ${err.message || err}`);
      console.error(`Script Stderr: ${stdErrText.trim() || 'None'}`);
      console.error(`Script Stdout: ${stdOutText.trim() || 'None'}`);
      console.error(`Full details written to: ${errorLog}`);
      console.error('\n🛠️ Troubleshooting Guide:');
      console.error('1. Check if your local branch has un-synchronized remote commits.');
      console.error('2. Ensure your GPG keys are unlocked and Touch ID biometrics are functioning.');
      console.error('3. Check GitHub API status and ensure your gh CLI is authenticated.');
      console.error('\n🔒 Zero-Trust Security Reset: Revoking all approvals and gating signatures...');

      const sigFiles = [
        path.join(targetDir, 'user-approval.json'),
        path.join(targetDir, 'user-approval.json.sig'),
        path.join(targetDir, 'review-approval.json'),
        path.join(targetDir, 'plan-approval.json'),
        path.join(targetDir, 'plan-approval.json.sig'),
      ];
      for (const file of sigFiles) {
        try {
          fs.unlinkSync(file);
          console.error(`  -> Revoked signature file: ${path.basename(file)}`);
        } catch (unlinkErr) {
          if (unlinkErr.code !== 'ENOENT') {
            console.error(`  -> Failed to delete ${path.basename(file)}:`, unlinkErr.message);
          }
        }
      }
      console.error('======================================================================\n');
      process.exit(1);
    }
  } catch (err) {
    console.error(
      '🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave commit decryption:',
      err.message || err,
    );
    process.exit(1);
  }
}
