import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, execSync } from 'child_process';

test('Native Hook scripts E2E-grade Unit Tests', async (t) => {
  const tempHome = path.resolve('/tmp/gemini-hooks-test-home');
  const tempTmpDir = path.resolve(tempHome, '.gemini/tmp/terraform-provider-file');

  // Setup pristine temp test directories
  fs.mkdirSync(tempTmpDir, { recursive: true });
  // Initialize a mock git repository in tempHome to test enforce-planning.js's git status checks
  execSync('git init', { cwd: tempHome, stdio: 'ignore' });

  // Cleanup after tests
  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  await t.test('block-secrets.js: allows normal tool usage', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: { file_path: 'main.go' },
    };

    const result = execFileSync('node', ['.agent/hooks/block-secrets.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'allow');
  });

  await t.test('block-secrets.js: strictly blocks TOTP secret access', () => {
    const input = {
      tool_name: 'read_file',
      tool_input: { file_path: 'totp_secret.key' },
    };

    const result = execFileSync('node', ['.agent/hooks/block-secrets.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'deny');
    assert.ok(response.reason.includes('Security Policy Violation'));
  });

  await t.test('enforce-planning.js: allows writes/replaces inside .agent and .gemini folders', () => {
    const input = {
      tool_name: 'write_file',
      tool_input: { file_path: '.agent/hooks/test.js' },
      cwd: tempHome,
    };

    const result = execFileSync('node', ['.agent/hooks/enforce-planning.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'allow');
  });

  await t.test('enforce-planning.js: blocks manual writing/editing of approval files', () => {
    const input = {
      tool_name: 'write_file',
      tool_input: { file_path: 'review-approval.json' },
      cwd: tempHome,
    };

    const result = execFileSync('node', ['.agent/hooks/enforce-planning.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'deny');
    assert.ok(response.reason.includes('Security Policy Violation'));
  });

  await t.test('enforce-planning.js: blocks writes to source files if no active plan is in git status', () => {
    const input = {
      tool_name: 'write_file',
      tool_input: { file_path: 'main.go' },
      cwd: tempHome,
    };

    const result = execFileSync('node', ['.agent/hooks/enforce-planning.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'deny');
    const isPlanDeny =
      response.systemMessage.includes('No active plan found') ||
      response.reason.includes('Failed to verify active plan status in Git');
    assert.ok(isPlanDeny, 'Reason should indicate no active plan or git check failure');
  });

  await t.test('before-invoke-agent.js: blocks testing_agent if Gate 1 (Planning Gate) is missing', () => {
    const planApprovalFile = path.join(tempTmpDir, 'plan-approval.json');
    if (fs.existsSync(planApprovalFile)) {
      fs.unlinkSync(planApprovalFile);
    }

    const input = {
      tool_name: 'invoke_agent',
      tool_input: { agent_name: 'testing_agent' },
    };

    const result = execFileSync('node', ['.agent/hooks/before-invoke-agent.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'deny');
    assert.ok(response.reason.includes('Gate 1 (Planning Gate) is missing or invalid'));
  });

  await t.test('before-invoke-agent.js: blocks review_agent if Gate 2 (Testing Gate) is missing', () => {
    // Write valid plan approval to satisfy Gate 1
    const challengeToken = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challengeToken).digest('hex');

    const mockPlanFile = path.join(tempTmpDir, 'test-plan.md');
    fs.mkdirSync(path.dirname(mockPlanFile), { recursive: true });
    fs.writeFileSync(mockPlanFile, '# Test Plan');

    // Create a mock session dir structure to satisfy findLatestActivePlan
    const mockSessionPlansDir = path.join(tempTmpDir, '99de7e6a-3e4f-4645-93e7-7ec975fcc6ff/plans');
    fs.mkdirSync(mockSessionPlansDir, { recursive: true });
    fs.writeFileSync(path.join(mockSessionPlansDir, 'SubAgentIsolationHooks.md'), '# Test Plan');

    const planHash = crypto.createHash('sha256').update('# Test Plan').digest('hex');

    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.json'),
      JSON.stringify({
        status: 'approved',
        challenge_token: challengeToken,
        plan_file: path.join(mockSessionPlansDir, 'SubAgentIsolationHooks.md'),
        plan_hash: planHash,
      }),
    );

    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.challenge'),
      JSON.stringify({ challenge_hash: challengeHash }),
    );

    // Ensure test-approval.json is missing
    const testApprovalFile = path.join(tempTmpDir, 'test-approval.json');
    if (fs.existsSync(testApprovalFile)) {
      fs.unlinkSync(testApprovalFile);
    }

    const input = {
      tool_name: 'invoke_agent',
      tool_input: { agent_name: 'review_agent' },
    };

    const result = execFileSync('node', ['.agent/hooks/before-invoke-agent.js'], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome },
    }).toString();

    const response = JSON.parse(result);
    assert.strictEqual(response.decision, 'deny');
    assert.ok(response.reason.includes('Gate 2 (Testing Gate) is missing or invalid'));
  });
});
