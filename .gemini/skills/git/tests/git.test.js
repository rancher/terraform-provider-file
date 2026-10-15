import assert from 'node:assert';
import test from 'node:test';
import {
  checkSpelling,
  createCommit,
  parseCommitArgs,
  validateCommit,
  validateCommitMessage,
} from '../scripts/commit.js';
import { createBranch } from '../scripts/create-branch.js';
import { getBranchChanges } from '../scripts/get_branch_changes.js';
import { getCommitLog } from '../scripts/get_commit_log.js';
import { getDeletedFile } from '../scripts/get_deleted_file.js';
import { getDiffToReview } from '../scripts/get_diff_to_review.js';
import { getFilesChanged } from '../scripts/get_files_changed.js';
import { getModifiedPaths } from '../scripts/get_modified_paths.js';
import { getStagedFiles, parseStageOutput } from '../scripts/get_staged_files.js';
import { isExcludedByAIExclude, readIgnoredFile } from '../scripts/read-ignored-file.js';
import { stageFiles } from '../scripts/stage-files.js';
import { switchBranch } from '../scripts/switch-branch.js';
import { unstageFiles } from '../scripts/unstage-files.js';

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

  await t.test('throws when targetPath is outside repository root', async () => {
    await assert.rejects(async () => {
      await readIgnoredFile({ targetPath: '../../outside-repo-file.txt' });
    }, /Cannot read file outside repository root/);
  });
});

test('git skill - getModifiedPaths parsing', async (t) => {
  await t.test('parses porcelain status format cleanly', async () => {
    const mockGit = {
      raw: async (args) => {
        assert.deepStrictEqual(args, ['-c', 'core.quotepath=false', 'status', '--porcelain']);
        return ' M file1.js\n?? file2.txt\nR  old.js -> new.js\n';
      },
    };

    const paths = await getModifiedPaths({ git: mockGit });
    assert.deepStrictEqual(paths, ['file1.js', 'file2.txt', 'new.js']);
  });
});

test('git skill - isExcludedByAIExclude fail closed', async (t) => {
  await t.test('returns false when .aiexclude does not exist', async () => {
    // Non-existent repo directory without .aiexclude
    const result = await isExcludedByAIExclude('/tmp/somefile.txt', '/tmp');
    assert.strictEqual(result, false);
  });
});

test('git skill - stageFiles unit tests', async (t) => {
  await t.test('throws when no files are specified and all is false', async () => {
    const mockGit = {
      revparse: async () => '/mock/root',
    };
    await assert.rejects(async () => {
      await stageFiles({ git: mockGit, files: [], all: false });
    }, /No files specified to stage/);
  });

  await t.test('stages specified files when not blocked', async () => {
    let capturedAdd = null;
    const mockGit = {
      revparse: async () => process.cwd(),
      add: async (files) => {
        capturedAdd = files;
      },
    };

    const staged = await stageFiles({ git: mockGit, files: ['package.json'] });
    assert.deepStrictEqual(staged, ['package.json']);
    assert.deepStrictEqual(capturedAdd, ['package.json']);
  });

  await t.test('stages all tracked modified files when all is true', async () => {
    let capturedAdd = null;
    const mockGit = {
      revparse: async () => process.cwd(),
      raw: async (args) => {
        assert.deepStrictEqual(args, ['-c', 'core.quotepath=false', 'ls-files', '-m', '-d']);
        return 'package.json\n';
      },
      add: async (files) => {
        capturedAdd = files;
      },
    };

    const staged = await stageFiles({ git: mockGit, all: true });
    assert.deepStrictEqual(staged, ['package.json']);
    assert.deepStrictEqual(capturedAdd, ['package.json']);
  });
});

test('git skill - unstageFiles unit tests', async (t) => {
  await t.test('throws when no files are specified and all is false', async () => {
    await assert.rejects(async () => {
      await unstageFiles({ files: [], all: false });
    }, /No files specified to unstage/);
  });

  await t.test('unstages specified files with git.reset', async () => {
    let capturedReset = null;
    const mockGit = {
      reset: async (args) => {
        capturedReset = args;
      },
    };

    const unstaged = await unstageFiles({ git: mockGit, files: ['package.json'] });
    assert.deepStrictEqual(unstaged, ['package.json']);
    assert.deepStrictEqual(capturedReset, ['HEAD', '--', 'package.json']);
  });

  await t.test('unstages all staged files when all is true', async () => {
    let capturedReset = null;
    const mockGit = {
      raw: async (args) => {
        assert.deepStrictEqual(args, ['-c', 'core.quotepath=false', 'diff', '--name-only', '--cached']);
        return 'package.json\nmain.go\n';
      },
      reset: async (args) => {
        capturedReset = args;
      },
    };

    const unstaged = await unstageFiles({ git: mockGit, all: true });
    assert.deepStrictEqual(unstaged, ['package.json', 'main.go']);
    assert.deepStrictEqual(capturedReset, ['HEAD', '--']);
  });

  await t.test('returns empty array when all is true but nothing is staged', async () => {
    const mockGit = {
      raw: async () => '',
    };
    const unstaged = await unstageFiles({ git: mockGit, all: true });
    assert.deepStrictEqual(unstaged, []);
  });
});

test('git skill - commit.js spell checking and validateCommit', async (t) => {
  await t.test('checkSpelling passes clean message', async () => {
    const res = await checkSpelling('fix: update documentation and comments');
    assert.strictEqual(res.valid, true);
  });

  await t.test('checkSpelling catches misspelled words', async () => {
    const misspelledWord = 'u' + 'pdte';
    const res = await checkSpelling(`fix: ${misspelledWord} documentation`);
    // If cspell CLI is installed, it identifies words; if skipped, valid is true
    if (!res.skipped) {
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /Commit message contains spelling errors on:/);
    }
  });

  await t.test('validateCommit validates format and spell check together', async () => {
    const misspelledWord = 'inccor' + 'rect';
    const mockCleanSpeller = async () => ({ valid: true });
    const mockDirtySpeller = async () => ({
      valid: false,
      reason: `Commit message contains spelling errors on: ${misspelledWord}`,
    });

    const resClean = await validateCommit({
      message: 'fix: correct typo in provider',
      affectsProduct: true,
      checkSpellingFn: mockCleanSpeller,
    });
    assert.strictEqual(resClean.valid, true);

    const resDirty = await validateCommit({
      message: `fix: ${misspelledWord} behavior in provider`,
      affectsProduct: true,
      checkSpellingFn: mockDirtySpeller,
    });
    assert.strictEqual(resDirty.valid, false);
    assert.match(resDirty.reason, /spelling errors on:/);
  });

  await t.test('validateCommit allows standard merge commits without spell check', async () => {
    let spellerCalled = false;
    const mockSpeller = async () => {
      spellerCalled = true;
      return { valid: true };
    };

    const res = await validateCommit({
      message: "Merge branch 'main' of github.com:rancher/terraform-provider-file",
      affectsProduct: true,
      checkSpellingFn: mockSpeller,
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(spellerCalled, false);
  });
});

test('git skill - parseCommitArgs unit tests', async (t) => {
  await t.test('returns empty string for empty args', () => {
    assert.strictEqual(parseCommitArgs([]), '');
    assert.strictEqual(parseCommitArgs(), '');
  });

  await t.test('parses positional words into space-separated string', () => {
    const msg = parseCommitArgs(['fix:', 'update', 'readme', 'docs']);
    assert.strictEqual(msg, 'fix: update readme docs');
  });

  await t.test('parses single -m flag', () => {
    const msg = parseCommitArgs(['-m', 'fix: update readme']);
    assert.strictEqual(msg, 'fix: update readme');
  });

  await t.test('joins multiple -m flags with double newlines as paragraphs', () => {
    const msg = parseCommitArgs([
      '-m',
      'fix: update readme',
      '-m',
      'Added detailed explanation of skills and CLI options.',
    ]);
    assert.strictEqual(msg, 'fix: update readme\n\nAdded detailed explanation of skills and CLI options.');
  });

  await t.test('parses -m=... and --message=... flags', () => {
    const msg = parseCommitArgs(['-m=fix: title', '--message=Paragraph 2']);
    assert.strictEqual(msg, 'fix: title\n\nParagraph 2');
  });
});

test('git skill - get_staged_files unit tests', async (t) => {
  await t.test('parseStageOutput parses git ls-files --stage output', () => {
    const sample =
      '100644 3716302c 0\t.gemini/settings.json\n' +
      '100644 a1b2c3d4 1\tfile_conflict.txt\n' +
      '100644 e5f6a7b8 2\tfile_conflict.txt\n' +
      '100644 99887766 0\t"file with spaces.txt"\n';

    const entries = parseStageOutput(sample);
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].path, '.gemini/settings.json');
    assert.strictEqual(entries[0].stage, 0);
    assert.strictEqual(entries[1].path, 'file_conflict.txt');
    assert.strictEqual(entries[1].stage, 1);
    assert.strictEqual(entries[2].path, 'file_conflict.txt');
    assert.strictEqual(entries[2].stage, 2);
    assert.strictEqual(entries[3].path, 'file with spaces.txt');
    assert.strictEqual(entries[3].stage, 0);
  });

  await t.test('getStagedFiles retrieves stages, statuses, and detects conflicts', async () => {
    const mockGit = {
      raw: async (args) => {
        if (args.includes('ls-files')) {
          return '100644 aabbcc 0\tfile1.js\n100755 ddeeff 1\tconflict.js\n100644 112233 0\tclean.js\n';
        }
        if (args.includes('diff')) {
          return 'M\tfile1.js\nU\tconflict.js\n';
        }
        return '';
      },
    };

    const result = await getStagedFiles({ git: mockGit });
    assert.strictEqual(result.hasConflicts, true);
    assert.deepStrictEqual(result.paths, ['file1.js', 'conflict.js']);
    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].status, 'M');
    assert.strictEqual(result.entries[1].status, 'U');
  });
});

test('git skill - createBranch unit tests', async (t) => {
  await t.test('throws when branch name is empty', async () => {
    await assert.rejects(async () => {
      await createBranch({ branchName: '' });
    }, /Branch name cannot be empty/);
  });

  await t.test('throws when branch already exists', async () => {
    const mockGit = {
      branchLocal: async () => ({ all: ['main', 'existing-branch'] }),
      getRemotes: async () => [{ name: 'origin' }],
      fetch: async () => {},
      branch: async () => ({ current: 'main' }),
      merge: async () => {},
    };

    await assert.rejects(async () => {
      await createBranch({ git: mockGit, branchName: 'existing-branch' });
    }, /Branch 'existing-branch' already exists/);
  });

  await t.test('syncs upstream and checks out branch', async () => {
    let checkedOut = null;
    let syncedRemote = null;
    const mockGit = {
      branchLocal: async () => ({ all: ['main'] }),
      getRemotes: async () => [{ name: 'upstream' }, { name: 'origin' }],
      fetch: async (remote) => {
        syncedRemote = remote;
      },
      branch: async () => ({ current: 'main' }),
      merge: async () => {},
      checkoutBranch: async (branchName, base) => {
        checkedOut = { branchName, base };
      },
    };

    const result = await createBranch({ git: mockGit, branchName: 'new-feature' });
    assert.strictEqual(result.branchName, 'new-feature');
    assert.strictEqual(result.baseBranch, 'main');
    assert.strictEqual(result.syncedRemote, 'upstream');
    assert.strictEqual(syncedRemote, 'upstream');
    assert.deepStrictEqual(checkedOut, { branchName: 'new-feature', base: 'main' });
  });
});

test('git skill - switchBranch unit tests', async (t) => {
  await t.test('throws when branch name is empty', async () => {
    await assert.rejects(async () => {
      await switchBranch({ branchName: '' });
    }, /Branch name cannot be empty/);
  });

  await t.test('throws when branch does not exist', async () => {
    const mockGit = {
      branch: async () => ({ all: ['main'] }),
    };

    await assert.rejects(async () => {
      await switchBranch({ git: mockGit, branchName: 'non-existent' });
    }, /Branch 'non-existent' does not exist/);
  });

  await t.test('switches when branch exists locally or remotely', async () => {
    let checkedOut = null;
    const mockGit = {
      branch: async () => ({ all: ['main', 'remotes/origin/feat-remote'] }),
      checkout: async (name) => {
        checkedOut = name;
      },
    };

    const result = await switchBranch({ git: mockGit, branchName: 'feat-remote' });
    assert.strictEqual(result.branchName, 'feat-remote');
    assert.strictEqual(checkedOut, 'feat-remote');
  });
});

test('git skill - getBranchChanges unit tests', async (t) => {
  await t.test('gets diff relative to base branch using merge-base', async () => {
    let capturedArgs = null;
    const mockGit = {
      branchLocal: async () => ({ all: ['main'] }),
      raw: async (args) => {
        if (args[0] === 'merge-base') {
          return 'abc1234\n';
        }
        return '';
      },
      diff: async (args) => {
        capturedArgs = args;
        return 'diff --git a/file.go b/file.go\n+new line\n';
      },
    };

    const diff = await getBranchChanges({ git: mockGit });
    assert.match(diff, /\+new line/);
    assert.deepStrictEqual(capturedArgs, ['--no-ext-diff', '--no-color', 'abc1234', '--']);
  });

  await t.test('uses specified baseBranch when provided', async () => {
    let capturedArgs = null;
    const mockGit = {
      raw: async (args) => {
        if (args[0] === 'merge-base') {
          assert.strictEqual(args[1], 'upstream/main');
          return 'def5678\n';
        }
        return '';
      },
      diff: async (args) => {
        capturedArgs = args;
        return 'diff output';
      },
    };

    const diff = await getBranchChanges({ git: mockGit, baseBranch: 'upstream/main' });
    assert.strictEqual(diff, 'diff output');
    assert.deepStrictEqual(capturedArgs, ['--no-ext-diff', '--no-color', 'def5678', '--']);
  });
});

test('git skill - getCommitLog unit tests', async (t) => {
  await t.test('formats commit log with limit', async () => {
    let capturedLimit = null;
    const mockGit = {
      log: async (opts) => {
        capturedLimit = opts.maxCount;
        return {
          all: [
            { hash: '1234567890abcdef', message: 'feat: add feature', date: '2026-10-15' },
            { hash: 'abcdef1234567890', message: 'fix: resolve bug', date: '2026-10-14' },
          ],
        };
      },
    };

    const commits = await getCommitLog({ git: mockGit, limit: 2 });
    assert.strictEqual(capturedLimit, 2);
    assert.strictEqual(commits.length, 2);
    assert.strictEqual(commits[0].hash, '1234567');
    assert.strictEqual(commits[0].message, 'feat: add feature');
  });
});

test('git skill - getDeletedFile unit tests', async (t) => {
  await t.test('throws when file path is missing', async () => {
    await assert.rejects(async () => {
      await getDeletedFile({ filePath: '' });
    }, /Missing file path/);
  });

  await t.test('throws when file was never found in git history', async () => {
    const mockGit = {
      log: async () => ({ all: [] }),
    };

    await assert.rejects(async () => {
      await getDeletedFile({ git: mockGit, filePath: 'missing.go' });
    }, /never found in git history/);
  });

  await t.test('retrieves file contents from last commit show', async () => {
    const mockGit = {
      log: async () => ({ all: [{ hash: 'commit-hash-123' }] }),
      show: async (args) => {
        assert.deepStrictEqual(args, ['commit-hash-123:old-file.txt']);
        return 'historical content';
      },
    };

    const content = await getDeletedFile({ git: mockGit, filePath: 'old-file.txt' });
    assert.strictEqual(content, 'historical content');
  });
});

test('git skill - getFilesChanged unit tests', async (t) => {
  await t.test('returns status and branch diff text', async () => {
    const mockGit = {
      branchLocal: async () => ({ all: ['main'] }),
      raw: async (args) => {
        if (args.includes('status')) {
          return ' M internal/provider.go\n';
        }
        if (args.includes('diff')) {
          return 'M\tinternal/provider.go\n';
        }
        return '';
      },
    };

    const result = await getFilesChanged({ git: mockGit });
    assert.strictEqual(result.baseBranch, 'main');
    assert.strictEqual(result.statusText, ' M internal/provider.go\n');
    assert.strictEqual(result.branchDiffText, 'M\tinternal/provider.go\n');
  });
});

test('git skill - getDiffToReview unit tests', async (t) => {
  await t.test('calls git raw with --no-ext-diff, --no-color, and core.quotepath=false', async () => {
    const calls = [];
    const mockGit = {
      raw: async (args) => {
        calls.push(args);
        if (args.includes('--staged')) {
          return 'staged diff output';
        }
        return 'unstaged diff output';
      },
    };

    const result = await getDiffToReview({ git: mockGit });
    assert.strictEqual(result.staged, 'staged diff output');
    assert.strictEqual(result.unstaged, 'unstaged diff output');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], [
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--staged',
      '--',
    ]);
    assert.deepStrictEqual(calls[1], ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--']);
  });

  await t.test('passes specific file paths when provided', async () => {
    const calls = [];
    const mockGit = {
      raw: async (args) => {
        calls.push(args);
        return 'file diff';
      },
    };

    const result = await getDiffToReview({ git: mockGit, files: ['main.go', 'README.md'] });
    assert.strictEqual(result.staged, 'file diff');
    assert.deepStrictEqual(calls[0], [
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--staged',
      '--',
      'main.go',
      'README.md',
    ]);
  });
});

test('git skill - createCommit unit tests', async (t) => {
  await t.test('throws when on a detached HEAD', async () => {
    const mockGit = {
      branch: async () => ({ current: 'HEAD' }),
    };

    await assert.rejects(async () => {
      await createCommit({ git: mockGit, message: 'fix: test message' });
    }, /Cannot commit on a detached HEAD/);
  });

  await t.test('throws when on protected branch main or master', async () => {
    const mockGitMain = {
      branch: async () => ({ current: 'main' }),
    };
    await assert.rejects(async () => {
      await createCommit({ git: mockGitMain, message: 'fix: test message' });
    }, /Commits directly to the 'main' branch are not allowed/);

    const mockGitMaster = {
      branch: async () => ({ current: 'master' }),
    };
    await assert.rejects(async () => {
      await createCommit({ git: mockGitMaster, message: 'fix: test message' });
    }, /Commits directly to the 'master' branch are not allowed/);
  });

  await t.test('throws when staging area is empty', async () => {
    const mockGit = {
      branch: async () => ({ current: 'feature/test-branch' }),
      diffSummary: async (args) => {
        if (args && args.includes('--cached')) {
          return { files: [] };
        }
        return { files: [{ file: 'modified.js' }] };
      },
    };

    await assert.rejects(async () => {
      await createCommit({ git: mockGit, message: 'fix: test message' });
    }, /No staged changes found/);
  });

  await t.test('creates signed commit when staged changes exist and validation passes', async () => {
    let capturedCommit = null;
    const mockGit = {
      branch: async () => ({ current: 'feature/test-branch' }),
      diffSummary: async (args) => {
        if (args && args.includes('--cached')) {
          return { files: [{ file: 'internal/provider.go' }] };
        }
        return { files: [] };
      },
      commit: async (msg, paths, opts) => {
        capturedCommit = { msg, paths, opts };
        return { commit: 'abc1234', branch: 'feature/test-branch' };
      },
    };

    const mockSpeller = async () => ({ valid: true });
    const result = await createCommit({
      git: mockGit,
      message: 'feat: add support for new option',
      checkSpellingFn: mockSpeller,
    });

    assert.strictEqual(result.commit, 'abc1234');
    assert.strictEqual(result.branch, 'feature/test-branch');
    assert.strictEqual(capturedCommit.msg, 'feat: add support for new option');
    assert.deepStrictEqual(capturedCommit.opts, { '-s': null });
  });
});
