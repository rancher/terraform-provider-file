import test from 'node:test';
import assert from 'node:assert';
import {
  getStandardsFile,
  getRepoDefaultBranch,
  filterExcludedFiles,
  parseJSONFromText,
  qaValidator,
} from '../../quality-assurance.js';

test('quality-assurance script unit tests', async (t) => {
  await t.test('getStandardsFile maps extensions correctly', () => {
    assert.strictEqual(getStandardsFile('main.go'), 'docs/development/reference/Go.md');
    assert.strictEqual(getStandardsFile('variables.tf'), 'docs/development/reference/Terraform.md');
    assert.strictEqual(getStandardsFile('script.sh'), 'docs/development/reference/ShellScripts.md');
    assert.strictEqual(getStandardsFile('app.js'), 'docs/development/reference/JavaScript.md');
    assert.strictEqual(getStandardsFile('doc.md'), 'docs/development/reference/Documentation.md');
    assert.strictEqual(getStandardsFile('unknown.file'), 'docs/development/reference/CodingStandards.md');
  });

  await t.test('getRepoDefaultBranch resolves default branch successfully', async () => {
    const branch = await getRepoDefaultBranch();
    assert.ok(typeof branch === 'string');
    assert.ok(branch.length > 0);
  });

  await t.test('filterExcludedFiles filters out files based on rules correctly', () => {
    const files = [
      'main.go',
      'logo.png',
      'agent-scripts/quality-assurance.js',
      'go.sum',
      'docs/development/explanation/AgenticFramework.md',
      'test-approval.json',
      'another.sig',
      'important-signature.sig',
    ];
    // Test extensions, directory patterns, exact literal, wildcards, and negations
    const rules = ['.png', 'agent-scripts/', 'go.sum', '*-approval.json', '*.sig', '!important-signature.sig'];

    const filtered = filterExcludedFiles(files, rules);

    assert.deepStrictEqual(filtered, [
      'main.go',
      'docs/development/explanation/AgenticFramework.md',
      'important-signature.sig',
    ]);
  });

  await t.test('parseJSONFromText extracts and parses JSON correctly', () => {
    const markdownPayload = '```json\n{\n  "test": "value"\n}\n```';
    const parsed = parseJSONFromText(markdownPayload);
    assert.deepStrictEqual(parsed, { test: 'value' });

    const rawPayload = '{\n  "test": "value"\n}';
    const parsedRaw = parseJSONFromText(rawPayload);
    assert.deepStrictEqual(parsedRaw, { test: 'value' });
  });

  await t.test('qaValidator validates schemas correctly', () => {
    const validApproved = JSON.stringify({
      approval_status: 'APPROVED',
      findings: [],
      suggested_commit: {
        title: 'chore: standard commit',
        message: 'A nice commit message body',
      },
    });

    const parsedApproved = qaValidator(validApproved);
    assert.strictEqual(parsedApproved.approval_status, 'APPROVED');

    const validUnapproved = JSON.stringify({
      approval_status: 'UNAPPROVED',
      findings: [
        {
          file: 'main.go',
          line_numbers: [12],
          narrative: 'A logical bug finding',
        },
      ],
      suggested_commit: {
        title: 'chore: fix logical bug',
        message: 'Fix unhandled nil pointer',
      },
    });

    const parsedUnapproved = qaValidator(validUnapproved);
    assert.strictEqual(parsedUnapproved.approval_status, 'UNAPPROVED');
    assert.strictEqual(parsedUnapproved.findings.length, 1);

    // Invalid schema payloads
    assert.throws(() => {
      qaValidator(JSON.stringify({ approval_status: 'INVALID_STATUS', findings: [] }));
    });

    assert.throws(() => {
      qaValidator(JSON.stringify({ approval_status: 'APPROVED', findings: 'not_an_array' }));
    });

    assert.throws(() => {
      qaValidator(
        JSON.stringify({
          approval_status: 'UNAPPROVED',
          findings: [{ file: 'main.go', line_numbers: 'not_an_array', narrative: 'Bug' }],
        }),
      );
    });
  });
});
