import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execSync } from 'child_process';
import { checkActivePlan } from '../planning.js';
import { resolveTargetDir } from '../workspace.js';

test('planning.js: checkActivePlan unit tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(os.homedir(), `.gemini/tmp/gemini-planning-test-${uniqueId}`);

  fs.mkdirSync(tempHome, { recursive: true });
  execSync('git init', { cwd: tempHome, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempHome, '.gitkeep'), '');
  execSync('git add -A && git -c user.email=test@test.com -c user.name=test commit -m init', {
    cwd: tempHome,
    stdio: 'ignore',
  });

  const targetDir = resolveTargetDir(tempHome);

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  await t.test('returns false when no plan is present in the session/plans directory', () => {
    const hasPlan = checkActivePlan(tempHome);
    assert.strictEqual(hasPlan, false);
  });

  await t.test('returns true when a plan is present in the session/plans directory', () => {
    const sessionPlansDir = path.join(targetDir, 'session-abc/plans');
    fs.mkdirSync(sessionPlansDir, { recursive: true });
    fs.writeFileSync(path.join(sessionPlansDir, 'MyPlan.md'), '# Active Plan');
    const hasPlan = checkActivePlan(tempHome);
    assert.strictEqual(hasPlan, true);
  });
});
