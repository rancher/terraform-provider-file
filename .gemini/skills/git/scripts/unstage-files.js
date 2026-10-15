#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Unstages files from the git index safely.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {Array<string>} [params.files]
 * @param {boolean} [params.all]
 * @returns {Promise<Array<string>>} List of unstaged files
 */
export async function unstageFiles({ git = simpleGit(), files = [], all = false }) {
  if (all) {
    const rawStaged = await git.raw(['-c', 'core.quotepath=false', 'diff', '--name-only', '--cached']);
    const stagedFiles = rawStaged
      .split('\n')
      .map((l) => l.trim().replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);

    if (stagedFiles.length === 0) {
      return [];
    }

    await git.reset(['HEAD', '--']);
    return stagedFiles;
  }

  if (!files || files.length === 0) {
    throw new Error('No files specified to unstage.');
  }

  await git.reset(['HEAD', '--', ...files]);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: unstage-files.js <file1> [file2...] | --all');
    process.exit(1);
  }

  const all = args.includes('--all') || args.includes('-A');
  const files = args.filter((a) => a !== '--all' && a !== '-A');

  try {
    const unstaged = await unstageFiles({ files, all });
    if (unstaged.length === 0) {
      console.log('No staged files to unstage.');
      return;
    }
    console.log(`✅ Successfully unstaged: ${unstaged.join(', ')}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
