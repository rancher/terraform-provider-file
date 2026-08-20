import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, execSync, spawnSync } from 'child_process';
import { calculateDiffHash } from '../../../../agent-scripts/gating.js';

test('Claude Code native hook scripts E2E-grade Unit Tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(`/tmp/claude-hooks-test-home-${uniqueId}`);
  const repoName = path.basename(process.cwd());
  const tempTmpDir = path.resolve(tempHome, '.claude/tmp', repoName);

  // Setup pristine temp test directories
  fs.mkdirSync(tempTmpDir, { recursive: true });
  // Initialize a mock git repository in tempHome to test enforce-blueprint.js's git status checks.
  // A baseline commit that already tracks docs/development/ is required so that a later untracked
  // file added under it (docs/development/Plan.md) is reported by `git status --porcelain` as its
  // own line rather than collapsed into a single "?? docs/" line for the whole new directory tree.
  execSync('git init', { cwd: tempHome, stdio: 'ignore' });
  fs.mkdirSync(path.join(tempHome, 'docs/development'), { recursive: true });
  fs.writeFileSync(path.join(tempHome, 'docs/development/.gitkeep'), '');
  execSync('git add -A && git -c user.email=test@test.com -c user.name=test commit -m init', {
    cwd: tempHome,
    stdio: 'ignore',
  });

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  function runHook(hookFile, input, { argv = [], env = {} } = {}) {
    const result = spawnSync('node', [hookFile, ...argv], {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: tempHome, ...env },
      encoding: 'utf-8',
    });
    return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  }

  function writeValidPlanApproval() {
    const challengeToken = crypto.randomBytes(32).toString('hex');
    const challengeHash = crypto.createHash('sha256').update(challengeToken).digest('hex');
    const sessionPlansDir = path.join(tempTmpDir, `session-${crypto.randomBytes(4).toString('hex')}/plans`);
    fs.mkdirSync(sessionPlansDir, { recursive: true });
    const planFile = path.join(sessionPlansDir, 'TestPlan.md');
    fs.writeFileSync(planFile, '# Test Plan');
    const planHash = crypto.createHash('sha256').update('# Test Plan').digest('hex');

    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.json'),
      JSON.stringify({ status: 'approved', challenge_token: challengeToken, plan_file: planFile, plan_hash: planHash }),
    );
    fs.writeFileSync(
      path.join(tempTmpDir, 'plan-approval.challenge'),
      JSON.stringify({ challenge_hash: challengeHash }),
    );
    return planHash;
  }

  function writeValidTestApproval(planHash) {
    const diffHash = calculateDiffHash();
    fs.writeFileSync(
      path.join(tempTmpDir, 'test-approval.json'),
      JSON.stringify({ status: 'approved', diff_hash: diffHash, plan_hash: planHash }),
    );
    return diffHash;
  }

  function writeValidReviewApproval(planHash, diffHash) {
    fs.writeFileSync(
      path.join(tempTmpDir, 'review-approval.json'),
      JSON.stringify({ status: 'approved', diff_hash: diffHash, plan_hash: planHash }),
    );
  }

  function writeTranscript(finalText) {
    const transcriptPath = path.join(tempHome, `transcript-${crypto.randomBytes(4).toString('hex')}.jsonl`);
    fs.writeFileSync(transcriptPath, JSON.stringify({ message: { role: 'assistant', content: finalText } }) + '\n');
    return transcriptPath;
  }

  // --- block-direct-git.js ---

  await t.test('block-direct-git.js: denies a direct git commit', () => {
    const result = runHook('.claude/hooks/block-direct-git.js', {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "test"' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Security Policy Violation'));
  });

  await t.test('block-direct-git.js: denies a direct git push', () => {
    const result = runHook('.claude/hooks/block-direct-git.js', {
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 2);
  });

  await t.test('block-direct-git.js: denies manual execution of agent-scripts', () => {
    const result = runHook('.claude/hooks/block-direct-git.js', {
      tool_name: 'Bash',
      tool_input: { command: 'bash agent-scripts/verify-gates.sh' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Manual execution of enforcer hook or agent scripts'));
  });

  await t.test('block-direct-git.js: allows a plain git status', () => {
    const result = runHook('.claude/hooks/block-direct-git.js', {
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 0);
  });

  // --- enforce-blueprint.js ---

  await t.test('enforce-blueprint.js: allows writes inside .claude/', () => {
    const result = runHook('.claude/hooks/enforce-blueprint.js', {
      tool_name: 'Write',
      tool_input: { file_path: '.claude/hooks/test.js' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 0);
  });

  await t.test(
    'enforce-blueprint.js: blocks spoofing gate approval files even under the .claude allowlist (regression for C1)',
    () => {
      const target = path.join(tempTmpDir, 'plan-approval.json');
      const result = runHook('.claude/hooks/enforce-blueprint.js', {
        tool_name: 'Write',
        tool_input: { file_path: target },
        cwd: tempHome,
      });
      assert.strictEqual(result.code, 2);
      assert.ok(result.stderr.includes('Security Policy Violation'));
    },
  );

  await t.test('enforce-blueprint.js: blocks writes to source files if no active plan is in git status', () => {
    const result = runHook('.claude/hooks/enforce-blueprint.js', {
      tool_name: 'Write',
      tool_input: { file_path: 'main.go' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('active plan'));
  });

  await t.test(
    'enforce-blueprint.js: blocks writes to other docs/development/ files if no active plan is in git status (regression for M4)',
    () => {
      const result = runHook('.claude/hooks/enforce-blueprint.js', {
        tool_name: 'Write',
        tool_input: { file_path: 'docs/development/CodingStandards/Go.md' },
        cwd: tempHome,
      });
      assert.strictEqual(result.code, 2);
      assert.ok(result.stderr.includes('active plan'));
    },
  );

  await t.test('enforce-blueprint.js: allows writes to source files once an active plan is in git status', () => {
    fs.writeFileSync(path.join(tempHome, 'docs/development/Plan.md'), '# Plan');

    const result = runHook('.claude/hooks/enforce-blueprint.js', {
      tool_name: 'Write',
      tool_input: { file_path: 'main.go' },
      cwd: tempHome,
    });
    assert.strictEqual(result.code, 0);
  });

  // --- gate-before-subagent.js ---

  await t.test('gate-before-subagent.js: blocks testing-agent when Gate 1 (Planning Gate) is missing', () => {
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.json'), { force: true });
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.challenge'), { force: true });

    const result = runHook('.claude/hooks/gate-before-subagent.js', {
      tool_name: 'Task',
      tool_input: { subagent_type: 'testing-agent' },
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Gate 1 (Planning Gate) is missing or invalid'));
  });

  await t.test('gate-before-subagent.js: blocks review-agent when Gate 2 (Testing Gate) is missing', () => {
    writeValidPlanApproval();
    fs.rmSync(path.join(tempTmpDir, 'test-approval.json'), { force: true });

    const result = runHook('.claude/hooks/gate-before-subagent.js', {
      tool_name: 'Task',
      tool_input: { subagent_type: 'review-agent' },
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Gate 2 (Testing Gate) is missing or invalid'));
  });

  // --- gate-before-commit-ask.js ---

  await t.test('gate-before-commit-ask.js: ignores non-commit questions regardless of gate state', () => {
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.json'), { force: true });
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.challenge'), { force: true });

    const result = runHook('.claude/hooks/gate-before-commit-ask.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Which color do you prefer?' }] },
    });
    assert.strictEqual(result.code, 0);
  });

  await t.test('gate-before-commit-ask.js: denies the commit ask when Gate 1 (Planning Gate) is missing', () => {
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.json'), { force: true });
    fs.rmSync(path.join(tempTmpDir, 'plan-approval.challenge'), { force: true });

    const result = runHook('.claude/hooks/gate-before-commit-ask.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Gate 1 (Planning Gate) is missing or invalid'));
  });

  await t.test('gate-before-commit-ask.js: denies the commit ask when Gate 2 (Testing Gate) is missing', () => {
    writeValidPlanApproval();
    fs.rmSync(path.join(tempTmpDir, 'test-approval.json'), { force: true });

    const result = runHook('.claude/hooks/gate-before-commit-ask.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Gate 2 (Testing Gate) is missing or invalid'));
  });

  await t.test('gate-before-commit-ask.js: denies the commit ask when Gate 3 (Review Gate) is missing', () => {
    const planHash = writeValidPlanApproval();
    writeValidTestApproval(planHash);
    fs.rmSync(path.join(tempTmpDir, 'review-approval.json'), { force: true });

    const result = runHook('.claude/hooks/gate-before-commit-ask.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
    });
    assert.strictEqual(result.code, 2);
    assert.ok(result.stderr.includes('Gate 3 (Review Gate) is missing or invalid'));
  });

  await t.test('gate-before-commit-ask.js: allows the commit ask once Gates 1-3 are all valid', () => {
    const planHash = writeValidPlanApproval();
    const diffHash = writeValidTestApproval(planHash);
    writeValidReviewApproval(planHash, diffHash);

    const result = runHook('.claude/hooks/gate-before-commit-ask.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
    });
    assert.strictEqual(result.code, 0);
  });

  // --- subagent-report-gate.js ---

  await t.test(
    'subagent-report-gate.js: refuses to sign Gate 2 when the Gate 1 challenge has been tampered with (regression for C2)',
    () => {
      const challengeToken = crypto.randomBytes(32).toString('hex');
      const sessionPlansDir = path.join(tempTmpDir, 'tampered-session/plans');
      fs.mkdirSync(sessionPlansDir, { recursive: true });
      const planFile = path.join(sessionPlansDir, 'TamperedPlan.md');
      fs.writeFileSync(planFile, '# Tampered Plan');
      const planHash = crypto.createHash('sha256').update('# Tampered Plan').digest('hex');

      fs.writeFileSync(
        path.join(tempTmpDir, 'plan-approval.json'),
        JSON.stringify({
          status: 'approved',
          challenge_token: challengeToken,
          plan_file: planFile,
          plan_hash: planHash,
        }),
      );
      // Challenge hash intentionally does not match challengeToken's real SHA-256 — simulates a
      // tampered/forged approval file that a naive "trust the raw plan_hash field" implementation
      // (the pre-fix behavior) would have signed anyway.
      fs.writeFileSync(
        path.join(tempTmpDir, 'plan-approval.challenge'),
        JSON.stringify({ challenge_hash: 'deadbeef'.repeat(8) }),
      );
      fs.rmSync(path.join(tempTmpDir, 'test-approval.json'), { force: true });

      const transcriptPath = writeTranscript('TEST RUN status: 🟢 SUCCESS - All tests and linting passed.');
      const result = runHook(
        '.claude/hooks/subagent-report-gate.js',
        { transcript_path: transcriptPath },
        { argv: ['testing-agent'] },
      );

      assert.strictEqual(result.code, 0);
      assert.strictEqual(fs.existsSync(path.join(tempTmpDir, 'test-approval.json')), false);
    },
  );

  await t.test('subagent-report-gate.js: signs Gate 2 when Gate 1 is valid and the report reports success', () => {
    const planHash = writeValidPlanApproval();
    fs.rmSync(path.join(tempTmpDir, 'test-approval.json'), { force: true });

    const transcriptPath = writeTranscript('TEST RUN status: 🟢 SUCCESS - All tests and linting passed.');
    const result = runHook(
      '.claude/hooks/subagent-report-gate.js',
      { transcript_path: transcriptPath },
      { argv: ['testing-agent'] },
    );

    assert.strictEqual(result.code, 0);
    const approval = JSON.parse(fs.readFileSync(path.join(tempTmpDir, 'test-approval.json'), 'utf-8'));
    assert.strictEqual(approval.status, 'approved');
    assert.strictEqual(approval.plan_hash, planHash);
  });

  await t.test('subagent-report-gate.js: revokes Gate 2 when the report indicates failure', () => {
    writeValidPlanApproval();
    const transcriptPath = writeTranscript('TEST RUN status: 🔴 FAILED');
    const result = runHook(
      '.claude/hooks/subagent-report-gate.js',
      { transcript_path: transcriptPath },
      { argv: ['testing-agent'] },
    );

    assert.strictEqual(result.code, 0);
    assert.strictEqual(fs.existsSync(path.join(tempTmpDir, 'test-approval.json')), false);
  });

  // --- sign-plan-gate.js ---
  // (Safe to exercise end-to-end: unlike sign-commit-gate.js it never shells out to
  // commit/push/PR automation, only local file writes and `age` encrypt/decrypt.)

  await t.test('sign-plan-gate.js: persists the blueprint and signs Gate 1 with a real key pair', () => {
    const keysDir = path.join(tempHome, '.claude');
    fs.mkdirSync(keysDir, { recursive: true });
    const privKeyFile = path.join(keysDir, 'age-key.txt');
    const pubKeyFile = path.join(keysDir, 'age-key.pub');
    execFileSync('age-keygen', ['-o', privKeyFile]);
    const pubKeyLine = execFileSync('age-keygen', ['-y', privKeyFile]).toString().trim();
    fs.writeFileSync(pubKeyFile, `${pubKeyLine}\n`);

    const plansDir = path.join(tempHome, '.claude/plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, 'Bootstrap-Test.md'), '# Bootstrap Test\n\nSome plan content.');

    const projectDir = path.join(tempHome, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    const result = runHook('.claude/hooks/sign-plan-gate.js', { tool_name: 'ExitPlanMode', cwd: projectDir });

    assert.strictEqual(result.code, 0);
    assert.ok(fs.existsSync(path.join(projectDir, 'docs/development', 'Bootstrap-Test.md')));
    const approval = JSON.parse(fs.readFileSync(path.join(tempTmpDir, 'plan-approval.json'), 'utf-8'));
    assert.strictEqual(approval.status, 'approved');
  });

  // --- sign-commit-gate.js ---
  // Only the safe early-return paths are exercised here. The "approved" path shells out
  // directly to .gemini/skills/commit-push.sh and create-pr.sh with stdio inherited — that
  // is real commit/push/PR automation and must never be triggered from a test process.

  await t.test('sign-commit-gate.js: does not trigger automation for non-commit/push questions', () => {
    const result = runHook('.claude/hooks/sign-commit-gate.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Which color do you prefer?' }] },
      tool_response: { answers: { q1: 'yes' } },
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
  });

  await t.test('sign-commit-gate.js: does not trigger automation when the answer is not an affirmative', () => {
    const result = runHook('.claude/hooks/sign-commit-gate.js', {
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
      tool_response: { answers: { q1: 'no, hold off' } },
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
  });

  await t.test('sign-commit-gate.js: skips signing when no age key pair is present', () => {
    const noKeysHome = path.join(tempHome, 'alt-home-no-keys');
    fs.mkdirSync(noKeysHome, { recursive: true });

    const result = runHook(
      '.claude/hooks/sign-commit-gate.js',
      {
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Commit Message: "chore: test"' }] },
        tool_response: { answers: { q1: 'yes' } },
      },
      { env: { HOME: noKeysHome } },
    );

    assert.strictEqual(result.code, 0);
    assert.ok(result.stderr.includes('age key pair not found'));
  });
});
