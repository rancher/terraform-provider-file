#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Gets diff between current branch and base branch (main/master).
 * @param {object} [params]
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} [params.baseBranch]
 * @returns {Promise<string>}
 */
export async function getBranchChanges({ git = simpleGit(), baseBranch } = {}) {
  let base = baseBranch;
  if (!base) {
    const branches = git.branch ? await git.branch() : await git.branchLocal();
    if (branches.all.includes('main')) {
      base = 'main';
    } else if (branches.all.includes('master')) {
      base = 'master';
    } else if (branches.all.includes('remotes/origin/main') || branches.all.includes('origin/main')) {
      base = 'origin/main';
    } else if (branches.all.includes('remotes/upstream/main') || branches.all.includes('upstream/main')) {
      base = 'upstream/main';
    } else if (branches.all.includes('remotes/origin/master') || branches.all.includes('origin/master')) {
      base = 'origin/master';
    } else if (branches.all.includes('remotes/upstream/master') || branches.all.includes('upstream/master')) {
      base = 'upstream/master';
    } else {
      base = 'main';
    }
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
  const baseBranch = process.argv[2];
  try {
    const diff = await getBranchChanges({ baseBranch });
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
