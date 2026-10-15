#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Gets diff between current branch and base branch (main/master).
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @returns {Promise<string>}
 */
export async function getBranchChanges({ git = simpleGit() } = {}) {
  const branches = await git.branchLocal();
  const base = branches.all.includes('main') ? 'main' : branches.all.includes('master') ? 'master' : null;

  if (!base) {
    throw new Error('Neither main nor master branch exists.');
  }

  let mergeBase = '';
  try {
    mergeBase = (await git.raw(['merge-base', base, 'HEAD'])).trim();
  } catch {
    mergeBase = base;
  }

  const diff = await git.diff(['--no-ext-diff', '--no-color', mergeBase, '--']);
  return diff;
}

async function main() {
  try {
    const diff = await getBranchChanges();
    if (!diff.trim()) {
      console.log('No branch changes found relative to base branch.');
      return;
    }
    process.stdout.write(diff.endsWith('\n') ? diff : diff + '\n');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
