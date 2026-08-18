#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';

const HOME_DIR = process.env.HOME || '/tmp';
const TARGET_DIR = path.resolve(HOME_DIR, '.gemini/tmp/terraform-provider-file');

function calculateFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

function calculateDiffHash() {
  try {
    const diff = execSync('git diff HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return crypto.createHash('sha256').update(diff).digest('hex');
  } catch (err) {
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

    if (planFiles.length === 0) return null;

    planFiles.sort((a, b) => b.mtime - a.mtime);
    return planFiles[0].path;
  } catch (err) {
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
    // If not JSON, use raw display content
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
    const activePlan = findLatestActivePlan();
    if (!activePlan) {
      console.error('🔒 Cryptographic Pipeline Error: Active plan file not found.');
      process.exit(1);
    }
    const planHash = calculateFileHash(activePlan);

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

      // Symlink Overwrite Prevention: Explicitly delete existing files/symlinks first
      fs.rmSync(envelopeFile, { force: true });
      fs.rmSync(challengeFile, { force: true });
      fs.rmSync(signatureFile, { force: true });

      // 1. Securely encrypt using the public key file directly (bypassing shell interpreter)
      execFileSync('age', ['-R', PUB_KEY_FILE, '-o', envelopeFile], { input: envelopeJson });
      fs.writeFileSync(challengeFile, JSON.stringify({ challenge_hash: challengeHash }, null, 2));

      // 2. Automatically and natively execute the decryption using your Apple Secure Enclave
      const decrypted = execFileSync('age', ['-d', '-i', PRIV_KEY_FILE, envelopeFile]);
      fs.writeFileSync(signatureFile, decrypted);

      // Clean up the temporary encrypted envelope
      fs.rmSync(envelopeFile, { force: true });

      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage: '✅ Gate 1 Approved: Secure Enclave Touch ID validated. Plan cryptographically signed!',
        }),
      );
      process.exit(0);
    } catch (err) {
      console.error('🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave plan decryption:', err.message);
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

      // Symlink Overwrite Prevention: Explicitly delete existing files/symlinks first
      fs.rmSync(envelopeFile, { force: true });
      fs.rmSync(challengeFile, { force: true });
      fs.rmSync(signatureFile, { force: true });

      // 1. Securely encrypt using the public key file directly (bypassing shell interpreter)
      execFileSync('age', ['-R', PUB_KEY_FILE, '-o', envelopeFile], { input: envelopeJson });
      fs.writeFileSync(challengeFile, JSON.stringify({ challenge_hash: challengeHash }, null, 2));

      // 2. Automatically and natively execute the decryption using your Apple Secure Enclave
      const decrypted = execFileSync('age', ['-d', '-i', PRIV_KEY_FILE, envelopeFile]);
      fs.writeFileSync(signatureFile, decrypted);

      // Clean up the temporary encrypted envelope
      fs.rmSync(envelopeFile, { force: true });

      console.log(
        JSON.stringify({
          decision: 'allow',
          systemMessage:
            '✅ Gate 4 Approved: Secure Enclave Touch ID validated. Developer Commit cryptographically signed!',
        }),
      );
      process.exit(0);
    } catch (err) {
      console.error(
        '🔒 Cryptographic Pipeline Error: Failed to execute Secure Enclave commit decryption:',
        err.message,
      );
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

main();
