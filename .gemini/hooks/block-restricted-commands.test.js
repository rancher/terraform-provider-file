import assert from 'node:assert';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

function runHook(inputPayload) {
  return new Promise((resolve, reject) => {
    const hookPath = fileURLToPath(new URL('./block-restricted-commands.js', import.meta.url));
    const child = spawn('node', [hookPath]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.stdin.write(JSON.stringify(inputPayload));
    child.stdin.end();
  });
}

function parseJSON(stdout) {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Continue scanning upward
    }
  }
  throw new Error(`Failed to parse JSON from stdout:\n${stdout}`);
}

test('block-restricted-commands.js offline fallback blacklist', async (t) => {
  await t.test('blocks blacklisted paths like /var/ or /usr/ in write_file', async () => {
    const payload = {
      tool_name: 'write_file',
      tool_input: { file_path: '/usr/local/bin/some-script' },
      is_offline: true,
    };
    const res = await runHook(payload);
    const parsed = parseJSON(res.stdout);
    assert.strictEqual(parsed.decision, 'deny');
  });

  await t.test('blocks id_rsa accesses', async () => {
    const payload = {
      tool_name: 'read_file',
      tool_input: { file_path: '~/.ssh/id_rsa' },
      is_offline: true,
    };
    const res = await runHook(payload);
    const parsed = parseJSON(res.stdout);
    assert.strictEqual(parsed.decision, 'deny');
  });

  await t.test('blocks raw git commands', async () => {
    const payload = {
      tool_name: 'run_shell_command',
      tool_input: { command: 'git status' },
      is_offline: true,
    };
    const res = await runHook(payload);
    const parsed = parseJSON(res.stdout);
    assert.strictEqual(parsed.decision, 'deny');
  });

  await t.test('allows normal harmless commands', async () => {
    const payload = {
      tool_name: 'run_shell_command',
      tool_input: { command: 'echo "hello"' },
      is_offline: true,
    };
    const res = await runHook(payload);
    const parsed = parseJSON(res.stdout);
    assert.strictEqual(parsed.decision, 'allow');
  });

  await t.test('blocks invoke_agent tool calls', async () => {
    const payload = {
      tool_name: 'invoke_agent',
      tool_input: { agent_name: 'quality_assurance', prompt: 'test' },
      is_offline: true,
    };
    const res = await runHook(payload);
    const parsed = parseJSON(res.stdout);
    assert.strictEqual(parsed.decision, 'deny');
    assert.match(parsed.reason, /potentially destructive|Subagent invocation is disabled/);
  });
});
