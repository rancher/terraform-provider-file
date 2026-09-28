import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { getRepoRoot, normalizePlanObject, parseJSONFromText, savePlanFromJSON } from './utils.js';

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
    assert.deepStrictEqual(parsed.scope_boundaries.in_scope, [
      'Modify agent-scripts/lib/agent-runner.js',
    ]);
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
    assert.deepStrictEqual(parsed.scope_boundaries.in_scope, [
      'Modify main.go',
      'Modify main_test.go',
    ]);
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

    const repoRoot = await getRepoRoot();
    const planFile = path.join(repoRoot, 'plans/current.md');
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
});
