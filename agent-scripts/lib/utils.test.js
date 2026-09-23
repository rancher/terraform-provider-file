import assert from 'node:assert';
import test from 'node:test';
import { parseJSONFromText } from './utils.js';

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
});
