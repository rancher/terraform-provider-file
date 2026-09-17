import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';

function runHook(inputPayload) {
  return new Promise((resolve, reject) => {
    const hookPath = path.resolve('.gemini/hooks/block-restricted-commands.js');
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
  const parts = stdout.split('\n');
  let jsonStr = '';
  let braceCount = 0;
  let started = false;
  for (let i = parts.length - 1; i >= 0; i--) {
    const line = parts[i].trim();
    if (!line) {
      continue;
    }
    jsonStr = line + '\n' + jsonStr;
    if (line.includes('}')) {
      braceCount++;
      started = true;
    }
    if (line.includes('{')) {
      braceCount--;
    }
    if (started && braceCount === 0) {
      break;
    }
  }
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('Failed to parse JSON string: ' + jsonStr + '\nOriginal stdout: ' + stdout, { cause: err });
  }
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
});
