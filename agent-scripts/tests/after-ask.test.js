import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { handlePlanApproval } from '../after-ask.js';

test('after-ask.js: Touch ID gate signing unit tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(`/tmp/gemini-after-ask-test-${uniqueId}`);
  const tempTmpDir = path.resolve(tempHome, '.gemini/tmp/terraform-provider-file');

  fs.mkdirSync(tempTmpDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  await t.test('handlePlanApproval signs Gate 1 with age keys', () => {
    const keysDir = path.join(tempHome, '.gemini');
    fs.mkdirSync(keysDir, { recursive: true });
    const privKeyFile = path.join(keysDir, 'age-key.txt');
    const pubKeyFile = path.join(keysDir, 'age-key.pub');

    // Create a real age key-pair for testing
    execFileSync('age-keygen', ['-o', privKeyFile]);
    const pubKeyLine = execFileSync('age-keygen', ['-y', privKeyFile]).toString().trim();
    fs.writeFileSync(pubKeyFile, `${pubKeyLine}\n`);

    const sessionPlansDir = path.join(tempTmpDir, 'session1/plans');
    fs.mkdirSync(sessionPlansDir, { recursive: true });
    const planFile = path.join(sessionPlansDir, 'PR404-Resolution.md');
    fs.writeFileSync(planFile, '# Bootstrap Test');

    const result = handlePlanApproval(
      tempTmpDir,
      pubKeyFile,
      privKeyFile,
      'Do you approve the plan?\n```markdown\n# Bootstrap Test\n```',
    );

    assert.strictEqual(result.status, 'approved');
    const planApprovalFile = path.join(tempTmpDir, 'plan-approval.json');
    assert.strictEqual(fs.existsSync(planApprovalFile), true);
    const approval = JSON.parse(fs.readFileSync(planApprovalFile, 'utf-8'));
    assert.strictEqual(approval.status, 'approved');
  });
});
