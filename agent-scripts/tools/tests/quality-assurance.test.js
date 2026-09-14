import test from 'node:test';
import assert from 'node:assert';
import { getStandardsFile, getRepoDefaultBranch, filterExcludedFiles } from '../../quality-assurance.js';

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
    ];
    const rules = ['.png', 'agent-scripts/', 'go.sum'];

    const filtered = filterExcludedFiles(files, rules);

    assert.deepStrictEqual(filtered, ['main.go', 'docs/development/explanation/AgenticFramework.md']);
  });
});
