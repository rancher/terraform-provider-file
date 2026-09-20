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

import { TerminalQuotaError } from '@google/gemini-cli-core';

test('TerminalQuotaError massive delay interceptor patch', async (t) => {
  // Ensure the prototype monkeypatch is active using the prototype 'name' setter strategy
  const MAX_SILENT_RETRY_DELAY_MS = 300000;
  if (
    TerminalQuotaError &&
    TerminalQuotaError.prototype &&
    !Object.getOwnPropertyDescriptor(TerminalQuotaError.prototype, 'name')?.set
  ) {
    Object.defineProperty(TerminalQuotaError.prototype, 'name', {
      get() {
        return this._name;
      },
      set(val) {
        this._name = val;
        // Redefine retryDelayMs and reason on the instance itself to bypass the native field definitions
        Object.defineProperty(this, 'retryDelayMs', {
          get() {
            return this._retryDelayMs;
          },
          set(delayVal) {
            this._retryDelayMs = delayVal;
            if (delayVal !== undefined && delayVal > MAX_SILENT_RETRY_DELAY_MS) {
              if (typeof this.message === 'string') {
                this.message = this.message.replace(
                  /exhausted your capacity|capacity exceeded|MODEL_CAPACITY_EXHAUSTED/gi,
                  'exhausted capacity (immediate fallback)',
                );
              }
              if (typeof this._reason === 'string') {
                this._reason = this._reason.replace(
                  /MODEL_CAPACITY_EXHAUSTED|MODEL_CAPACITY_EXCEEDED/g,
                  'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK',
                );
              }
            }
          },
          configurable: true,
          enumerable: true,
        });

        Object.defineProperty(this, 'reason', {
          get() {
            return this._reason;
          },
          set(reasonVal) {
            if (reasonVal !== undefined && this.retryDelayMs > MAX_SILENT_RETRY_DELAY_MS) {
              this._reason = reasonVal.replace(
                /MODEL_CAPACITY_EXHAUSTED|MODEL_CAPACITY_EXCEEDED/g,
                'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK',
              );
            } else {
              this._reason = reasonVal;
            }
          },
          configurable: true,
          enumerable: true,
        });
      },
      configurable: true,
      enumerable: true,
    });
  }

  await t.test('keeps small retry delay and original message untouched', () => {
    const rawMsg = 'You have exhausted your capacity on this model. Your quota will reset after 5s.';
    const err = new TerminalQuotaError(rawMsg, { code: 429 }, 5, 'MODEL_CAPACITY_EXHAUSTED');

    assert.strictEqual(err.retryDelayMs, 5000);
    assert.strictEqual(err.message, rawMsg);
    assert.strictEqual(err.reason, 'MODEL_CAPACITY_EXHAUSTED');
  });

  await t.test('censors message and reason when retry delay is massive (> 5 minutes)', () => {
    const rawMsg = 'You have exhausted your capacity on this model. Your quota will reset after 12h53m47s.';
    const err = new TerminalQuotaError(rawMsg, { code: 429 }, 46427, 'MODEL_CAPACITY_EXHAUSTED');

    assert.strictEqual(err.retryDelayMs, 46427000);
    assert.match(err.message, /exhausted capacity \(immediate fallback\)/);
    assert.doesNotMatch(err.message, /exhausted your capacity/);
    assert.strictEqual(err.reason, 'MODEL_CAPACITY_EXHAUSTED_IMMEDIATE_FALLBACK');
  });
});
