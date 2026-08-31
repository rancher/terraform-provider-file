import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execFileSync } from 'child_process';
import { resolveTargetDir } from '../workspace.js';

test('Hooks End-to-End Integration Tests', async (t) => {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempHome = path.resolve(os.homedir(), `.gemini/tmp/gemini-hooks-e2e-test-${uniqueId}`);

  // Create temporary mock environment
  fs.mkdirSync(tempHome, { recursive: true });

  // Symlink node_modules into tempHome so that ESM imports can resolve dependencies in CI
  const projectNodeModules = path.resolve(process.cwd(), 'node_modules');
  const tempNodeModules = path.join(tempHome, 'node_modules');
  if (fs.existsSync(projectNodeModules)) {
    try {
      fs.symlinkSync(projectNodeModules, tempNodeModules, 'dir');
    } catch (err) {
      console.warn('🔒 Hook Test Warning: Failed to symlink node_modules, falling back:', err.message);
    }
  }

  execFileSync('git', ['init'], { cwd: tempHome, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempHome, '.gitkeep'), '');
  execFileSync('git', ['add', '-A'], { cwd: tempHome, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=test@test.com', '-c', 'user.name=test', 'commit', '-m', 'init'], {
    cwd: tempHome,
    stdio: 'ignore',
  });

  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const originalSock = process.env.SSH_AUTH_SOCK;
  const originalNodeEnv = process.env.NODE_ENV;

  // Setup env and change process HOME to mock home directory BEFORE resolving targetDir
  process.env.HOME = tempHome;

  // Unconditionally set SSH_AUTH_SOCK to mock path and set NODE_ENV to test so tests execute consistently with our bypassed check
  process.env.SSH_AUTH_SOCK = '/tmp/gemini-mock-ssh-agent.sock';
  process.env.NODE_ENV = 'test';

  const targetDir = resolveTargetDir(tempHome);
  fs.mkdirSync(targetDir, { recursive: true });

  // Generate real passwordless SSH key pair inside tempHome/.gemini so that signing and verification works realistically
  const geminiSshDir = path.join(tempHome, '.gemini');
  fs.mkdirSync(geminiSshDir, { recursive: true });
  const privKeyFile = path.join(geminiSshDir, 'ssh-key');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-C', 'gemini', '-N', '', '-f', privKeyFile], { stdio: 'ignore' });

  t.after(() => {
    process.env.HOME = originalHome;
    if (originalSock) {
      process.env.SSH_AUTH_SOCK = originalSock;
    } else {
      delete process.env.SSH_AUTH_SOCK;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    // Also remove targetDir if it's outside tempHome (just to be safe)
    if (!targetDir.startsWith(tempHome)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  // Helpers to execute hooks and capture JSON stdout
  function runHook(hookPath, stdinPayload, cmdArgs = []) {
    const absoluteHookPath = path.resolve(originalCwd, hookPath);
    try {
      const result = execFileSync('node', [absoluteHookPath, ...cmdArgs], {
        cwd: tempHome,
        input: JSON.stringify(stdinPayload),
        env: { ...process.env, HOME: tempHome },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return JSON.parse(result.toString());
    } catch (err) {
      if (err.stderr && err.stderr.toString().trim()) {
        console.error(`🔒 Hook test stderr: ${err.stderr.toString()}`);
      }
      if (err.stdout) {
        try {
          return JSON.parse(err.stdout.toString());
        } catch (parseErr) {
          throw new Error(`Hook execution failed with unparseable stdout: ${err.stdout.toString()}`, {
            cause: parseErr,
          });
        }
      }
      throw err;
    }
  }

  // --- block-restricted-commands.js E2E tests ---
  await t.test('block-restricted-commands.js: allows standard harmless commands', () => {
    const payload = {
      tool_name: 'run_shell_command',
      tool_input: { command: 'echo "hello world"' },
      cwd: tempHome,
    };
    const response = runHook('.gemini/hooks/block-restricted-commands.js', payload);
    assert.strictEqual(response.decision, 'allow');
  });

  await t.test('block-restricted-commands.js: denies direct git push', () => {
    const payload = {
      tool_name: 'run_shell_command',
      tool_input: { command: 'git push origin main' },
      cwd: tempHome,
    };
    const response = runHook('.gemini/hooks/block-restricted-commands.js', payload);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /Security Policy Violation: Direct manual git commit and push commands/);
  });

  await t.test('block-restricted-commands.js: denies manual execution of agent-scripts/', () => {
    const payload = {
      tool_name: 'run_shell_command',
      tool_input: { command: 'node agent-scripts/tests/planning.test.js' },
      cwd: tempHome,
    };
    const response = runHook('.gemini/hooks/block-restricted-commands.js', payload);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /Security Policy Violation: Manual execution of enforcer hook/);
  });

  // --- 02-plan-phase.js Plan Approval / TOML E2E tests ---
  await t.test('02-plan-phase.js: afterAskUserPlan allows approval with lowercase "yes"', () => {
    // Write phase-state to mock being in 'plan' phase
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'plan' }));

    // Mock an active plan file on disk
    const plansDir = path.join(targetDir, 'session1/plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(
      path.join(plansDir, 'Plan.md'),
      '# Complete Plan\n- [ ] Compliant plan checklist\n- [ ] run comprehensive tests\n- [ ] enforce standard quality gates\n- [ ] maintain the agentic framework\n- [ ] update documentation',
    );

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "plan approval"\nrequest = "Do you approve?"\nplan = """Checklist:\n- [ ] test\n- [ ] gate\n- [ ] framework\n- [ ] documentation"""`,
            type: 'yesno',
          },
        ],
      },
      tool_response: {
        answers: {
          0: 'yes',
        },
      },
    };

    // Run the hook in the after-ask execution phase
    const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--ask-proof']);
    assert.strictEqual(response.decision, 'allow');
  });

  await t.test('02-plan-phase.js: afterAskUserPlan is case-insensitive and allows uppercase "Yes"', () => {
    // Write phase-state to mock being in 'plan' phase
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'plan' }));

    // Mock an active plan file on disk
    const plansDir = path.join(targetDir, 'session1/plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(
      path.join(plansDir, 'Plan.md'),
      '# Complete Plan\n- [ ] Compliant plan checklist\n- [ ] run comprehensive tests\n- [ ] enforce standard quality gates\n- [ ] maintain the agentic framework\n- [ ] update documentation',
    );

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "plan approval"\nrequest = "Do you approve?"\nplan = """Checklist:\n- [ ] test\n- [ ] gate\n- [ ] framework\n- [ ] documentation"""`,
            type: 'yesno',
          },
        ],
      },
      tool_response: {
        answers: {
          0: 'Yes',
        },
      },
    };

    // Run the hook and verify the uppercase "Yes" is successfully accepted and allowed
    const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--ask-proof']);
    assert.strictEqual(response.decision, 'allow');
  });

  await t.test('02-plan-phase.js: afterAskUserPlan denies non-yes response', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'plan' }));

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "plan approval"\nrequest = "Do you approve?"\nplan = """Checklist:\n- [ ] test\n- [ ] gate\n- [ ] framework\n- [ ] documentation"""`,
            type: 'yesno',
          },
        ],
      },
      tool_response: {
        answers: {
          0: 'no',
        },
      },
    };

    const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--ask-proof']);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /User did not approve plan, they must select the 'yes' response/);
  });

  await t.test('validateAskUser: denies unrecognized intents', () => {
    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "unrecognized intent"\nrequest = "Do you approve?"`,
          },
        ],
      },
    };

    const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--before-ask-proof']);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /The TOML payload has an unrecognized 'intent'/);
  });

  await t.test('02-plan-phase.js: denies plan when intent is not plan approval', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'plan' }));

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "clarification"\nrequest = "Is this ok?"\nplan = "some plan"`,
          },
        ],
      },
    };

    const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--before-ask-proof']);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /The TOML payload contains a 'plan' field, but the intent is set to/);
  });

  await t.test('04-commit-phase.js: denies commit fields when intent is not commit approval', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'commit' }));

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "clarification"\nrequest = "Is this ok?"\nhash = "abc"`,
          },
        ],
      },
    };

    const response = runHook('.gemini/hooks/04-commit-phase.js', payload, ['--before-ask']);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /The TOML payload contains commit-specific fields, but the intent is set to/);
  });

  await t.test('02-plan-phase.js: afterAskUserPlan denies when SSH agent is offline', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'plan' }));

    // Mock an active plan file on disk
    const plansDir = path.join(targetDir, 'session1/plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(
      path.join(plansDir, 'Plan.md'),
      '# Complete Plan\n- [ ] Compliant plan checklist\n- [ ] run comprehensive tests\n- [ ] enforce standard quality gates\n- [ ] maintain the agentic framework\n- [ ] update documentation',
    );

    const payload = {
      tool_name: 'ask_user',
      tool_input: {
        questions: [
          {
            question: `intent = "plan approval"\nrequest = "Do you approve?"\nplan = """Checklist:\n- [ ] test\n- [ ] gate\n- [ ] framework\n- [ ] documentation"""`,
            type: 'yesno',
          },
        ],
      },
      tool_response: {
        answers: {
          0: 'yes',
        },
      },
    };

    // Temporarily clear SSH_AUTH_SOCK env to simulate missing keys/agent
    const origSock = process.env.SSH_AUTH_SOCK;
    delete process.env.SSH_AUTH_SOCK;

    try {
      const response = runHook('.gemini/hooks/02-plan-phase.js', payload, ['--ask-proof']);
      assert.strictEqual(response.decision, 'deny');
      assert.match(response.reason, /Gate 1 \(Planning Gate\) Cryptographic Setup Failure/);
      assert.match(response.reason, /SSH key signing is not configured properly or your SSH agent is offline/);
      assert.match(response.reason, /ssh-keygen/);
    } finally {
      process.env.SSH_AUTH_SOCK = origSock;
    }
  });

  await t.test('03-review-phase.js: afterInvoke allows when review report is complete and perfect', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'review' }));

    const payload = {
      tool_name: 'invoke_agent',
      tool_input: {
        agent_name: 'project_manager',
      },
      tool_response: {
        llmContent: `
          ## Intent Summary
          Aligning hooks.

          ## Review Agent Passes Checklist
          - [x] Pass 1
          - [x] Pass 2
          - [x] Pass 3
          - [x] Pass 4

          ## Findings & Comments
          ### 0 comments/findings

          ## Commit Metadata
          - Suggested Commit Title: Align hooks
          - Commit Message: "chore: align hooks"

          ## Topics Verification
          This report checks for security, standards, performance, logic, error handling, concurrency, edge cases, maintainability, and testability.
        `,
      },
    };

    const response = runHook('.gemini/hooks/03-review-phase.js', payload, ['--after-invoke']);
    assert.strictEqual(response.decision, 'allow');
    assert.match(response.systemMessage, /Gate 2 \(Review\) Cryptographically Signed/);
  });

  await t.test('03-review-phase.js: afterInvoke denies when review report is incomplete', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'review' }));

    const payload = {
      tool_name: 'invoke_agent',
      tool_input: {
        agent_name: 'project_manager',
      },
      tool_response: {
        llmContent: `
          ## Intent Summary
          Aligning hooks.

          ## Review Agent Passes Checklist
          - [ ] Pass 1 (Unchecked)
          - [x] Pass 2
          - [x] Pass 3
          - [x] Pass 4
        `,
      },
    };

    const response = runHook('.gemini/hooks/03-review-phase.js', payload, ['--after-invoke']);
    assert.strictEqual(response.decision, 'deny');
    assert.match(response.reason, /Gate 2 \(Review Gate\) Verification/);
  });

  await t.test('commit-push.sh: runs successfully and creates signed commit', () => {
    fs.writeFileSync(path.join(targetDir, 'phase-state.json'), JSON.stringify({ currentPhase: 'commit' }));

    // Write a dummy file to commit
    const dummyFile = path.join(tempHome, 'dummy_test_change.txt');
    fs.writeFileSync(dummyFile, 'Harmless testing edit.');

    // Write mock signatures to parent directory
    const planFile = path.join(targetDir, 'plan-approval.json');
    fs.writeFileSync(
      planFile,
      JSON.stringify({
        status: 'approved',
        plan_hash: '900b73c4dcb7c63ec9426fcd98918237de10bdfa3c94fcf1df9a2bb9cd76bbf1',
      }),
    );
    fs.writeFileSync(planFile + '.sig', 'mock signature');

    const reviewFile = path.join(targetDir, 'review-approval.json');
    fs.writeFileSync(
      reviewFile,
      JSON.stringify({
        status: 'approved',
        diff_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        plan_hash: '900b73c4dcb7c63ec9426fcd98918237de10bdfa3c94fcf1df9a2bb9cd76bbf1',
        suggested_commit_message: 'fix: testing commit',
      }),
    );

    // Copy agent-scripts/ to tempHome so commit-push.sh can find them
    const mockAgentScripts = path.join(tempHome, 'agent-scripts');
    fs.mkdirSync(mockAgentScripts, { recursive: true });
    fs.cpSync(path.join(originalCwd, 'agent-scripts'), mockAgentScripts, { recursive: true });

    // Copy .gemini/ to tempHome so commit-push.sh can find them
    const mockGemini = path.join(tempHome, '.gemini');
    fs.mkdirSync(mockGemini, { recursive: true });
    fs.cpSync(path.join(originalCwd, '.gemini'), mockGemini, { recursive: true });

    // Prepare mock git environment inside tempHome
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempHome });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tempHome });
    execFileSync('git', ['config', 'gpg.format', 'ssh'], { cwd: tempHome });
    execFileSync('git', ['config', 'user.signingkey', path.join(tempHome, '.gemini/ssh-key.pub')], { cwd: tempHome });

    // Create a mock origin remote that accepts force pushes (so push-helper doesn't fail)
    const mockOriginDir = path.resolve(os.homedir(), `.gemini/tmp/gemini-mock-origin-${uniqueId}`);
    fs.mkdirSync(mockOriginDir, { recursive: true });
    execFileSync('git', ['init', '--bare'], { cwd: mockOriginDir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', mockOriginDir], { cwd: tempHome });
    // Rename current branch to main for consistency
    execFileSync('git', ['branch', '-M', 'main'], { cwd: tempHome });
    // Push an initial commit to bare origin so tracking exists
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial commit'], { cwd: tempHome });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: tempHome, stdio: 'ignore' });

    // Mock active state env
    const env = {
      ...process.env,
      HOME: tempHome,
      AGENT_STATE_DIR: targetDir,
      COMMIT_LIMIT_OVERRIDE: '100',
    };

    const skillScript = path.join(tempHome, '.gemini/skills/commit-push.sh');
    try {
      execFileSync('bash', [skillScript, '-m', 'fix: resolve final inline review comments and mock SSH agent', '-f'], {
        cwd: tempHome,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Verify that the commit was successfully created
      const commitMsg = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: tempHome }).toString().trim();
      assert.strictEqual(commitMsg, 'fix: resolve final inline review comments and mock SSH agent');
    } catch (err) {
      const stdErr = err.stderr ? err.stderr.toString() : '';
      const stdOut = err.stdout ? err.stdout.toString() : '';
      throw new Error(
        `commit-push.sh failed to execute in E2E integration test.\nStderr: ${stdErr}\nStdout: ${stdOut}\nMessage: ${err.message}`,
        { cause: err },
      );
    } finally {
      fs.rmSync(mockOriginDir, { recursive: true, force: true });
    }
  });
});
