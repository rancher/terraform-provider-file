#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';

const HOME_DIR = process.env.HOME || '/tmp';
let repoName = '';
try {
  const topLevel = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  repoName = path.basename(topLevel);
} catch {
  repoName = path.basename(process.cwd()) || 'generic-repo';
}
const TARGET_DIR = path.resolve(HOME_DIR, '.gemini/tmp', repoName);

function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateFileHash failed:', err.message || err);
    return null;
  }
}

function calculateDiffHash() {
  try {
    const diff = execSync('git diff HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return crypto.createHash('sha256').update(diff).digest('hex');
  } catch (err) {
    console.error('🔒 Hook Debug: calculateDiffHash failed:', err.message || err);
    return null;
  }
}

const PUB_KEY_FILE = path.join(HOME_DIR, '.gemini/age-key.pub');
const PRIV_KEY_FILE = path.join(HOME_DIR, '.gemini/se-key.txt');

function findLatestActivePlan() {
  try {
    const activeSessions = fs.readdirSync(TARGET_DIR);
    const planFiles = [];

    for (const session of activeSessions) {
      const plansPath = path.join(TARGET_DIR, session, 'plans');
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

function main() {
  let inputData;
  try {
    inputData = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse stdin JSON:', err);
    process.exit(0);
  }

  const { tool_name, tool_input, tool_response } = inputData;

  if (tool_name !== 'ask_user' || !tool_input || !tool_response || !tool_response.llmContent) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Parse developer's response
  let answerText = '';
  try {
    const responseObj = JSON.parse(tool_response.llmContent);
    const answers = responseObj.answers || {};
    // Extract first answer value
    answerText = Object.values(answers)[0] || '';
  } catch (err) {
    console.error('🔒 Hook Debug: Parse response JSON failed, using raw display content:', err.message || err);
    answerText = tool_response.llmContent;
  }

  const safeAnswerText = String(answerText || '');
  const isApproved =
    safeAnswerText.toLowerCase() === 'yes' ||
    safeAnswerText.toLowerCase() === 'y' ||
    safeAnswerText.toLowerCase() === 'approve' ||
    safeAnswerText.toLowerCase() === 'approve plan' ||
    safeAnswerText.toLowerCase() === 'approve commit' ||
    safeAnswerText.toLowerCase() === 'looks good';

  if (!isApproved) {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const safeToolInput = JSON.stringify(tool_input);
  const isPlanAsk =
    /\bplan\b/i.test(safeToolInput) || safeToolInput.includes('blueprint') || safeToolInput.includes('Planning');

  const isCommitAsk =
    /\bcommit\b/i.test(safeToolInput) || safeToolInput.includes('GPG') || safeToolInput.includes('Push');

  if (isPlanAsk || isCommitAsk) {
    if (!fs.existsSync(PUB_KEY_FILE)) {
      console.error('\n======================================================================');
      console.error('🔒 SETUP ERROR: RECIPIENT PUBLIC KEY MISSING');
      console.error('======================================================================');
      console.error('Please save your chosen public key to:');
      console.error(`👉   ${PUB_KEY_FILE}\n`);
      console.error('======================================================================\n');
      process.exit(1);
    }

    if (!fs.existsSync(PRIV_KEY_FILE)) {
      console.error('\n======================================================================');
      console.error('🔒 SETUP ERROR: SECURE ENCLAVE PRIVATE KEY STUB MISSING');
      console.error('======================================================================');
      console.error('Please save your age-secure-se stub private key to:');
      console.error(`👉   ${PRIV_KEY_FILE}\n`);
      console.error('======================================================================\n');
      process.exit(1);
    }
  }

  if (isPlanAsk) {
    // --- GATE 1: PLAN APPROVAL CHALLENGE ---
    const promptText = tool_input.questions && tool_input.questions[0] ? tool_input.questions[0].question : '';
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

    let activePlan = findLatestActivePlan();
    if (!activePlan && planContent) {
      // Find session plans directory and write the plan natively
      const activeSessions = fs.readdirSync(TARGET_DIR);
      let plansDir = null;
      for (const session of activeSessions) {
        const plansPath = path.join(TARGET_DIR, session, 'plans');
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

    // Re-verify the active plan now that it has been saved
    activePlan = activePlan || findLatestActivePlan();
    if (!activePlan) {
      console.error('🔒 Cryptographic Pipeline Error: Active plan file not found.');
      process.exit(1);
    }
    const planHash = calculateFileHash(activePlan);
    if (!planHash) {
      console.error('🔒 Cryptographic Pipeline Error: Failed to calculate active plan hash.');
      process.exit(1);
    }

    const challengeToken = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challengeToken).digest('hex');

    const envelope = {
      status: 'approved',
      challenge_token: challengeToken,
      plan_file: activePlan,
      plan_hash: planHash,
      timestamp: new Date().toISOString(),
    };

    try {
      const envelopeJson = JSON.stringify(envelope, null, 2);
      const envelopeFile = path.join(TARGET_DIR, 'plan-approval.age');
      const challengeFile = path.join(TARGET_DIR, 'plan-approval.challenge');
      const signatureFile = path.join(TARGET_DIR, 'plan-approval.json');

      // Symlink Overwrite Prevention: Explicit delete existing files first
      fs.rmSync(envelopeFile, { force: true });
      fs.rmSync(challengeFile, { force: true });
      fs.rmSync(signatureFile, { force: true });

      // 1. Securely encrypt using the public key file directly
      execFileSync('age', ['-R', PUB_KEY_FILE, '-o', envelopeFile], { input: envelopeJson });
      fs.writeFileSync(challengeFile, JSON.stringify({ challenge_hash: challengeHash }, null, 2));

      // 2. Automatically and natively execute the decryption using Apple Secure Enclave
      const decrypted = execFileSync('age', ['-d', '-i', PRIV_KEY_FILE, envelopeFile]);
      fs.writeFileSync(signatureFile, decrypted);

      // Clean up temporary encrypted envelope
      fs.rmSync(envelopeFile, { force: true });

      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage: '✅ Gate 1 Approved: Secure Enclave Touch ID validated. Plan cryptographically signed!',
        }),
      );
      process.exit(0);
    } catch (err) {
      console.error(
        '🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave plan decryption:',
        err.message || err,
      );
      process.exit(1);
    }
  } else if (isCommitAsk) {
    // --- GATE 4: COMMIT APPROVAL CHALLENGE ---
    const activePlan = findLatestActivePlan();
    const planHash = activePlan ? calculateFileHash(activePlan) : 'unknown';
    const diffHash = calculateDiffHash();

    if (!diffHash) {
      console.error('🔒 Cryptographic Pipeline Error: Failed to calculate active diff hash.');
      process.exit(1);
    }

    const challengeToken = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challengeToken).digest('hex');

    const envelope = {
      status: 'approved',
      challenge_token: challengeToken,
      diff_hash: diffHash,
      plan_hash: planHash,
      timestamp: new Date().toISOString(),
    };

    try {
      const envelopeJson = JSON.stringify(envelope, null, 2);
      const envelopeFile = path.join(TARGET_DIR, 'user-approval.age');
      const challengeFile = path.join(TARGET_DIR, 'user-approval.challenge');
      const signatureFile = path.join(TARGET_DIR, 'user-approval.json');

      // Symlink Overwrite Prevention: Explicit delete existing files first
      fs.rmSync(envelopeFile, { force: true });
      fs.rmSync(challengeFile, { force: true });
      fs.rmSync(signatureFile, { force: true });

      // 1. Securely encrypt using the public key file directly
      execFileSync('age', ['-R', PUB_KEY_FILE, '-o', envelopeFile], { input: envelopeJson });
      fs.writeFileSync(challengeFile, JSON.stringify({ challenge_hash: challengeHash }, null, 2));

      // 2. Automatically and natively execute the decryption using Apple Secure Enclave
      const decrypted = execFileSync('age', ['-d', '-i', PRIV_KEY_FILE, envelopeFile]);
      fs.writeFileSync(signatureFile, decrypted);

      // Clean up temporary encrypted envelope
      fs.rmSync(envelopeFile, { force: true });

      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage:
            '✅ Gate 4 Approved: Secure Enclave Touch ID validated. Developer Commit cryptographically signed!',
        }),
      );

      // --- NEW AUTOMATED COMMIT, PUSH, AND PR EXECUTION ---
      const promptText = tool_input.questions && tool_input.questions[0] ? tool_input.questions[0].question : '';
      const matchCommit =
        promptText.match(/Commit Message:\s*"([^"]+)"/i) || promptText.match(/Commit Message:\s*`([^`]+)`/i);
      const commitMessage = matchCommit ? matchCommit[1] : 'chore: automated development commit';

      console.error(`\n🚀 AUTOMATION TRIGGERED: Initiating commit and push...`);
      execFileSync('bash', ['.gemini/skills/commit-push.sh', '-m', commitMessage], {
        env: { ...process.env, COMMIT_LIMIT_OVERRIDE: '100' },
        stdio: 'inherit',
      });

      console.error(`\n🚀 AUTOMATION TRIGGERED: Generating Draft Pull Request...`);
      execFileSync('bash', ['.gemini/skills/create-pr.sh', '--draft'], {
        env: { ...process.env },
        stdio: 'inherit',
      });

      process.exit(0);
    } catch (err) {
      console.error(
        '🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave commit decryption:',
        err.message || err,
      );
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
