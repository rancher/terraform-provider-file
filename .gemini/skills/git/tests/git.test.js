import assert from 'node:assert';
import test from 'node:test';
import { validateCommitMessage } from '../scripts/commit.js';
import { getModifiedPaths } from '../scripts/get_modified_paths.js';
import { readIgnoredFile } from '../scripts/read-ignored-file.js';

test('git skill - commit message validation', async (t) => {
  await t.test('rejects empty or missing commit messages', () => {
    const res1 = validateCommitMessage({ message: '', affectsProduct: true });
    assert.strictEqual(res1.valid, false);
    assert.match(res1.reason, /Missing commit message/);

    const res2 = validateCommitMessage({ message: '   ', affectsProduct: true });
    assert.strictEqual(res2.valid, false);
  });

  await t.test('rejects non-conventional commit messages', () => {
    const res = validateCommitMessage({ message: 'just a commit message', affectsProduct: true });
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /Conventional Commits format/);
  });

  await t.test('rejects subject lines longer than 72 characters', () => {
    const longSubject = 'fix: ' + 'a'.repeat(70);
    const res = validateCommitMessage({ message: longSubject, affectsProduct: true });
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /exceeds 72 characters/);
  });

  await t.test('enforces product boundary rules for non-product changes', () => {
    // Non-product changes (outside internal/) cannot use feat, refactor, or !
    const resFeat = validateCommitMessage({ message: 'feat: add new feature', affectsProduct: false });
    assert.strictEqual(resFeat.valid, false);
    assert.match(resFeat.reason, /Non-product change/);

    const resRefactor = validateCommitMessage({ message: 'refactor: clean docs', affectsProduct: false });
    assert.strictEqual(resRefactor.valid, false);
    assert.match(resRefactor.reason, /Non-product change/);

    const resBreaking = validateCommitMessage({ message: 'fix!: critical break', affectsProduct: false });
    assert.strictEqual(resBreaking.valid, false);
    assert.match(resBreaking.reason, /Non-product change/);

    // Non-product changes CAN use fix, docs, ci, chore, test
    const resFix = validateCommitMessage({ message: 'fix: address typo in docs', affectsProduct: false });
    assert.strictEqual(resFix.valid, true);

    const resChore = validateCommitMessage({ message: 'chore: bump dependencies', affectsProduct: false });
    assert.strictEqual(resChore.valid, true);
  });

  await t.test('allows feat and breaking changes when product files are affected', () => {
    const resFeat = validateCommitMessage({ message: 'feat: new local provider option', affectsProduct: true });
    assert.strictEqual(resFeat.valid, true);

    const resBreaking = validateCommitMessage({ message: 'feat!: breaking change to provider', affectsProduct: true });
    assert.strictEqual(resBreaking.valid, true);
  });
});

test('git skill - readIgnoredFile with line slicing', async (t) => {
  await t.test('throws an error if file does not exist', async () => {
    await assert.rejects(async () => {
      await readIgnoredFile({ targetPath: 'non-existent-file-xyz.txt' });
    }, /not found/);
  });

  await t.test('reads full file content when no lines are specified', async () => {
    const content = await readIgnoredFile({ targetPath: 'package.json' });
    assert.match(content, /"name":\s*"terraform-provider-file"/);
  });

  await t.test('slices specific lines when startLine and endLine are provided', async () => {
    const content = await readIgnoredFile({
      targetPath: 'package.json',
      startLine: 1,
      endLine: 3,
    });
    const lines = content.split('\n');
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0].trim(), '{');
  });
});

test('git skill - getModifiedPaths parsing', async (t) => {
  await t.test('parses porcelain status format cleanly', async () => {
    const mockGit = {
      raw: async (args) => {
        assert.deepStrictEqual(args, ['status', '--porcelain']);
        return ' M file1.js\n?? file2.txt\nR  old.js -> new.js\n';
      },
    };

    const paths = await getModifiedPaths({ git: mockGit });
    assert.deepStrictEqual(paths, ['file1.js', 'file2.txt', 'new.js']);
  });
});
