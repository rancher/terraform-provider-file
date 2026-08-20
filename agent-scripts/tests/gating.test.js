import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { calculateFileHash, findLatestActivePlan, verifyPlanGate } from '../gating.js';

test('gating.js: verification unit tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(`/tmp/gemini-gating-test-${uniqueId}`);
  const tempTmpDir = path.resolve(tempHome, '.gemini/tmp/terraform-provider-file');

  fs.mkdirSync(tempTmpDir, { recursive: true });
  execSync('git init', { cwd: tempHome, stdio: 'ignore' });

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  await t.test('calculateFileHash hashes file content correctly', () => {
    const file = path.join(tempHome, 'test.txt');
    fs.writeFileSync(file, 'hello world');
    const hash = calculateFileHash(file);
    const expected = crypto.createHash('sha256').update('hello world').digest('hex');
    assert.strictEqual(hash, expected);
  });

  await t.test('findLatestActivePlan returns latest plan file', () => {
    const session1 = path.join(tempTmpDir, 'session1/plans');
    const session2 = path.join(tempTmpDir, 'session2/plans');
    fs.mkdirSync(session1, { recursive: true });
    fs.mkdirSync(session2, { recursive: true });

    const plan1 = path.join(session1, 'Plan1.md');
    const plan2 = path.join(session2, 'Plan2.md');

    fs.writeFileSync(plan1, '# Plan 1');
    // Ensure separate mtimes
    execSync('touch -d "2 hours ago" ' + plan1);
    fs.writeFileSync(plan2, '# Plan 2');

    const latest = findLatestActivePlan(tempTmpDir);
    assert.strictEqual(latest, plan2);
  });

  await t.test('verifyPlanGate checks signatures correctly', () => {
    const challengeToken = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challengeToken).digest('hex');
    const session1 = path.join(tempTmpDir, 'session1/plans');
    fs.mkdirSync(session1, { recursive: true });
    const plan1 = path.join(session1, 'Plan1.md');
    fs.writeFileSync(plan1, '# Plan 1');
    const planHash = crypto.createHash('sha256').update('# Plan 1').digest('hex');

    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.json'),
      JSON.stringify({
        status: 'approved',
        challenge_token: challengeToken,
        plan_file: plan1,
        plan_hash: planHash,
      }),
    );
    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.challenge'),
      JSON.stringify({ challenge_hash: challengeHash }),
    );

    const verifiedHash = verifyPlanGate(tempTmpDir);
    assert.strictEqual(verifiedHash, planHash);
  });
});
