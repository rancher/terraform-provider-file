import { z } from '@google/gemini-cli-sdk';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  getRepoRoot,
  normalizePlanObject,
  parseJSONFromText,
  renderBox,
  savePlanFromJSON,
  stripAnsi,
  validateAgentOutput,
  wrapLine,
} from './utils.js';

test('parseJSONFromText resilient extraction', async (t) => {
  await t.test('extracts the last valid JSON block when followed by non-JSON code blocks', () => {
    const sample = [
      'Initial explanation.',
      '```json',
      '{"approval_status": "APPROVED", "findings": []}',
      '```',
      'Here is a command to verify:',
      '```',
      'go test ./...',
      '```',
    ].join('\n');

    const parsed = parseJSONFromText(sample, 'qa');
    assert.ok(parsed);
    assert.strictEqual(parsed.approval_status, 'APPROVED');
    assert.deepStrictEqual(parsed.findings, []);
  });

  await t.test('fails closed to UNAPPROVED when no valid JSON is present in QA output', () => {
    const text = 'The changes are APPROVED and ready to ship.';
    const parsed = parseJSONFromText(text, 'qa');
    assert.ok(parsed);
    assert.strictEqual(parsed.approval_status, 'UNAPPROVED');
    assert.strictEqual(parsed.findings.length, 1);

    // Empty string fallback
    const emptyParsed = parseJSONFromText('', 'qa');
    assert.ok(emptyParsed);
    assert.strictEqual(emptyParsed.approval_status, 'UNAPPROVED');
    assert.strictEqual(emptyParsed.findings[0].file, 'unknown');

    // Non-string inputs (null, undefined, number) fallback
    const nullParsed = parseJSONFromText(null, 'qa');
    assert.ok(nullParsed);
    assert.strictEqual(nullParsed.approval_status, 'UNAPPROVED');

    const undefParsed = parseJSONFromText(undefined, 'qa');
    assert.ok(undefParsed);
    assert.strictEqual(undefParsed.approval_status, 'UNAPPROVED');

    // Non-qa fallbackType returns null for invalid input
    assert.strictEqual(parseJSONFromText('', 'plan'), null);
    assert.strictEqual(parseJSONFromText(null, 'plan'), null);
  });

  await t.test('extracts raw JSON when unadorned by code blocks but surrounded by commentary', () => {
    const text = 'Here is the QA review result: {"approval_status": "APPROVED", "findings": []} and additional notes.';
    const parsed = parseJSONFromText(text, 'qa');
    assert.ok(parsed);
    assert.strictEqual(parsed.approval_status, 'APPROVED');
    assert.deepStrictEqual(parsed.findings, []);
  });

  await t.test('extracts latest JSON when multiple raw objects exist without code blocks', () => {
    const text = 'Draft: {"draft": true}. Final QA review: {"approval_status": "APPROVED", "findings": []}';
    const parsed = parseJSONFromText(text, 'qa');
    assert.ok(parsed);
    assert.strictEqual(parsed.approval_status, 'APPROVED');
    assert.deepStrictEqual(parsed.findings, []);
  });

  await t.test('extracts unadorned JSON containing nested objects and arrays', () => {
    const text =
      'Draft: {"draft": {"a": 1}}. Final: {"approval_status": "UNAPPROVED", "findings": [{"file": "foo.go", "line_numbers": [12]}]}';
    const parsed = parseJSONFromText(text, 'qa');
    assert.ok(parsed);
    assert.strictEqual(parsed.approval_status, 'UNAPPROVED');
    assert.strictEqual(parsed.findings.length, 1);
    assert.strictEqual(parsed.findings[0].file, 'foo.go');
  });

  await t.test('extracts top-level JSON when text contains intermingled array and object brackets', () => {
    const text = 'prefix [1, 2] middle {"plan": [{"file": "main.go", "steps": ["step 1"]}]} suffix';
    const parsed = parseJSONFromText(text, 'plan');
    assert.ok(parsed);
    assert.strictEqual(parsed.title, '[main.go] step 1');
  });

  await t.test('ignores trailing bracketed markdown citations when extracting plan object', () => {
    const text = 'Here is the plan: {"plan": [{"file": "main.go", "title": "Implement feature"}]}. See [1] and [2].';
    const parsed = parseJSONFromText(text, 'plan');
    assert.ok(parsed);
    assert.strictEqual(parsed.title, 'Implement feature');
    assert.deepStrictEqual(parsed.implementation_tasks, ['[main.go] Implement feature']);
  });

  await t.test('normalizes missing approval_status when findings array is provided in qa mode', () => {
    const approvedText = '{"findings": []}';
    const parsedApproved = parseJSONFromText(approvedText, 'qa');
    assert.ok(parsedApproved);
    assert.strictEqual(parsedApproved.approval_status, 'APPROVED');
    assert.deepStrictEqual(parsedApproved.findings, []);

    const unapprovedText = '{"findings": [{"file": "foo.go", "line_numbers": [12]}]}';
    const parsedUnapproved = parseJSONFromText(unapprovedText, 'qa');
    assert.ok(parsedUnapproved);
    assert.strictEqual(parsedUnapproved.approval_status, 'UNAPPROVED');
    assert.strictEqual(parsedUnapproved.findings.length, 1);
    assert.strictEqual(parsedUnapproved.findings[0].file, 'foo.go');
  });

  await t.test('normalizes planner output containing plan array into canonical plan schema', () => {
    const crashPayload = `\`\`\`json
{
  "plan": [
    {
      "file": "agent-scripts/lib/agent-runner.js",
      "description": "Enhance the tool execution logging to include key argument details for better visibility.",
      "steps": [
        "Locate the 'tool_call_request' handling block around line 609.",
        "Add logic to extract contextual information from args.",
        "Update the console.log statement."
      ]
    }
  ]
}
\`\`\``;

    const parsed = parseJSONFromText(crashPayload, 'plan');
    assert.ok(parsed);
    assert.strictEqual(
      parsed.title,
      'Enhance the tool execution logging to include key argument details for better visibility.',
    );
    assert.strictEqual(
      parsed.objective,
      'Enhance the tool execution logging to include key argument details for better visibility.',
    );
    assert.deepStrictEqual(parsed.scope_boundaries.in_scope, ['Modify agent-scripts/lib/agent-runner.js']);
    assert.ok(parsed.exit_criteria.length > 0);
    assert.strictEqual(parsed.implementation_tasks.length, 3);
    assert.strictEqual(
      parsed.implementation_tasks[0],
      "[agent-scripts/lib/agent-runner.js] Locate the 'tool_call_request' handling block around line 609.",
    );
  });

  await t.test('normalizes raw JSON array into canonical plan schema', () => {
    const rawArray = `[
      {"file": "main.go", "description": "Update main entrypoint"},
      {"file": "main_test.go", "description": "Add test coverage"}
    ]`;

    const parsed = parseJSONFromText(rawArray, 'plan');
    assert.ok(parsed);
    assert.strictEqual(parsed.title, 'Update main entrypoint');
    assert.deepStrictEqual(parsed.scope_boundaries.in_scope, ['Modify main.go', 'Modify main_test.go']);
    assert.strictEqual(parsed.implementation_tasks.length, 2);
    assert.strictEqual(parsed.implementation_tasks[0], '[main.go] Update main entrypoint');
  });

  await t.test('normalizes plan with alternate task and step keys', () => {
    const alternate = JSON.stringify({
      title: 'Custom Title',
      tasks: ['Task A', 'Task B'],
    });

    const parsed = parseJSONFromText(alternate, 'plan');
    assert.ok(parsed);
    assert.strictEqual(parsed.title, 'Custom Title');
    assert.deepStrictEqual(parsed.implementation_tasks, ['Task A', 'Task B']);
  });

  await t.test('normalizePlanObject fallback values when fields are empty', () => {
    const emptyObj = normalizePlanObject({}, 'Fallback Objective');
    assert.strictEqual(emptyObj.title, 'Fallback Objective');
    assert.strictEqual(emptyObj.objective, 'Fallback Objective');
    assert.deepStrictEqual(emptyObj.scope_boundaries.in_scope, ['Implement requested tasks as planned']);
    assert.strictEqual(emptyObj.implementation_tasks.length, 1);
  });
});

test('savePlanFromJSON resilient saving', async (t) => {
  const repoRoot = await getRepoRoot();
  const planFile = path.join(repoRoot, 'plans/current.md');
  let originalContent = null;
  try {
    originalContent = await fs.readFile(planFile, 'utf8');
  } catch {
    // File did not exist prior to test
  }

  t.after(async () => {
    if (originalContent !== null) {
      await fs.writeFile(planFile, originalContent, 'utf8');
    } else {
      try {
        await fs.unlink(planFile);
      } catch {
        // Ignore if already deleted
      }
    }
  });

  await t.test('successfully saves normalized plan to plans/current.md', async () => {
    const crashPayload = `\`\`\`json
{
  "plan": [
    {
      "file": "agent-scripts/lib/agent-runner.js",
      "description": "Enhance tool execution logging",
      "steps": [
        "Step 1: Extract tool arguments",
        "Step 2: Log enriched tool details"
      ]
    }
  ]
}
\`\`\``;

    const saved = await savePlanFromJSON(crashPayload, 'Fallback Title');
    assert.strictEqual(saved, true);

    const content = await fs.readFile(planFile, 'utf8');

    assert.ok(content.includes('# IMPLEMENTATION PLAN: Enhance tool execution logging'));
    assert.ok(content.includes('## 🎯 OBJECTIVE'));
    assert.ok(content.includes('**IN SCOPE:**'));
    assert.ok(content.includes('- Modify agent-scripts/lib/agent-runner.js'));
    assert.ok(content.includes('## 🛠️ IMPLEMENTATION TASKS'));
    assert.ok(content.includes('- [ ] [agent-scripts/lib/agent-runner.js] Step 1: Extract tool arguments'));
  });

  await t.test('returns false when text contains no valid JSON', async () => {
    const saved = await savePlanFromJSON('This is not JSON at all.');
    assert.strictEqual(saved, false);
  });

  await t.test('successfully saves when passed a plan object directly', async () => {
    const planObj = { title: 'Direct Object Plan', implementation_tasks: ['Task 1'] };
    const saved = await savePlanFromJSON(planObj);
    assert.strictEqual(saved, true);
  });
});

test('validateAgentOutput schema validation and error handling', async (t) => {
  const schema = z.object({
    name: z.string(),
    count: z.number(),
  });

  await t.test('successfully validates and returns parsed object matching schema', async () => {
    const raw = '```json\n{"name": "test-agent", "count": 42}\n```';
    const result = await validateAgentOutput(raw, schema);
    assert.deepStrictEqual(result, { name: 'test-agent', count: 42 });
  });

  await t.test('successfully validates when passed a JavaScript object directly', async () => {
    const obj = { name: 'direct-object', count: 7 };
    const result = await validateAgentOutput(obj, schema);
    assert.deepStrictEqual(result, { name: 'direct-object', count: 7 });
  });

  await t.test('re-formats and recovers successfully when session runner returns valid schema JSON', async () => {
    const invalidRaw = 'This is invalid text';
    let calls = 0;
    const mockRunner = async () => {
      calls++;
      return '```json\n{"name": "recovered-agent", "count": 99}\n```';
    };
    const result = await validateAgentOutput(invalidRaw, schema, mockRunner);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(result, { name: 'recovered-agent', count: 99 });
  });

  await t.test('gracefully returns null when validation fails and session errors', async () => {
    const invalidRaw = 'This is completely invalid and not JSON';
    const mockRunner = async () => {
      throw new Error('SDK session failed');
    };
    const result = await validateAgentOutput(invalidRaw, schema, mockRunner);
    assert.strictEqual(result, null);
  });

  await t.test('gracefully returns null after initial parse and 4 validator agent retries fail', async () => {
    const invalidRaw = 'This is completely invalid and not JSON';
    let calls = 0;
    const mockRunner = async () => {
      calls++;
      return 'Still invalid';
    };
    const result = await validateAgentOutput(invalidRaw, schema, mockRunner);
    assert.strictEqual(calls, 4); // Initial try failed, then 4 retries via validator agent
    assert.strictEqual(result, null);
  });

  await t.test('passes isolate: true and maxTurns: 5 options to the validator session runner', async () => {
    let receivedOptions = null;
    const mockRunner = async (opts) => {
      receivedOptions = opts;
      return '```json\n{"name": "isolated-agent", "count": 10}\n```';
    };
    const result = await validateAgentOutput('invalid text', schema, mockRunner);
    assert.strictEqual(receivedOptions.isolate, true);
    assert.strictEqual(receivedOptions.maxTurns, 5);
    assert.deepStrictEqual(result, { name: 'isolated-agent', count: 10 });
  });

  await t.test('handles nested schemas and unwraps optional inner types during retry', async () => {
    const nestedSchema = z.object({
      meta: z.object({
        tag: z.string().optional(),
      }),
    });
    const mockRunner = async (opts) => {
      assert.ok(opts.initialPrompt.includes('Expected Schema Structure:'));
      return '```json\n{"meta": {"tag": "beta"}}\n```';
    };
    const result = await validateAgentOutput('not json', nestedSchema, mockRunner);
    assert.deepStrictEqual(result, { meta: { tag: 'beta' } });
  });

  await t.test('generates expected schema structure for top-level array schemas during retry', async () => {
    const arraySchema = z.array(z.string());
    const mockRunner = async (opts) => {
      assert.ok(opts.initialPrompt.includes('Expected Schema Structure:'));
      return '```json\n["item1", "item2"]\n```';
    };
    const result = await validateAgentOutput('invalid', arraySchema, mockRunner);
    assert.deepStrictEqual(result, ['item1', 'item2']);
  });

  await t.test('throws TypeError when schema is missing or invalid', async () => {
    await assert.rejects(async () => validateAgentOutput('data', null), {
      name: 'TypeError',
      message: /valid Zod schema/,
    });
  });

  await t.test('introspects ZodLiteral and ZodUnion schemas in retry prompts', async () => {
    const unionSchema = z.object({
      status: z.union([z.literal('APPROVED'), z.literal('REJECTED')]),
    });
    const mockRunner = async (opts) => {
      assert.ok(
        opts.initialPrompt.includes('"APPROVED" | "REJECTED"') ||
          opts.initialPrompt.includes('\\"APPROVED\\" | \\"REJECTED\\"'),
      );
      return '```json\n{"status": "APPROVED"}\n```';
    };
    const result = await validateAgentOutput('invalid', unionSchema, mockRunner);
    assert.deepStrictEqual(result, { status: 'APPROVED' });
  });
});

test('renderBox and cli formatting utilities', async (t) => {
  await t.test('stripAnsi removes ANSI escape codes from styled text', () => {
    assert.strictEqual(stripAnsi('\u001b[32m' + 'hello' + '\u001b[0m world'), 'hello world');
    assert.strictEqual(stripAnsi('plain text'), 'plain text');
    assert.strictEqual(stripAnsi(123), '123');
  });

  await t.test('wrapLine wraps long strings while preserving indentation', () => {
    const line = '  this is a long line that needs to wrap into multiple parts';
    const wrapped = wrapLine(line, 25);
    assert.ok(wrapped.length > 1);
    assert.ok(wrapped[0].startsWith('  '));
    assert.ok(wrapped[1].startsWith('  '));
  });

  await t.test('renderBox leaves single-line text untouched', () => {
    const single = 'agent used run_shell_command';
    assert.strictEqual(renderBox(single), single);
  });

  await t.test('renderBox wraps multi-line text in unicode box borders', () => {
    const multiline = 'line 1\nline 2 longer';
    const boxed = renderBox(multiline);
    assert.ok(boxed.startsWith('┌─'));
    assert.ok(boxed.endsWith('─┘'));
    assert.ok(boxed.includes('│ line 1'));
    assert.ok(boxed.includes('│ line 2 longer │'));
  });
});
