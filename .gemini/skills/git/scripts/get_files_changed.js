#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Lists modified files and branch diff status vs main/master.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @returns {Promise<{statusText: string, branchDiffText: string}>}
 */
export async function getFilesChanged({ git = simpleGit() } = {}) {
  const status = await git.raw(['status', '--short']);

  const branches = await git.branchLocal();
  const base = branches.all.includes('main') ? 'main' : branches.all.includes('master') ? 'master' : null;

  let branchDiff = '';
  if (base) {
    branchDiff = await git.raw(['diff', '--name-status', base]);
  }

  return { statusText: status, branchDiffText: branchDiff, baseBranch: base };
}

async function main() {
  try {
    const { statusText, branchDiffText, baseBranch } = await getFilesChanged();
    console.log('=== Current Working Tree Status ===');
    console.log(statusText.trim() ? statusText : '(Working tree clean)');
    console.log(`\n=== Files Changed in Current Branch vs ${baseBranch || 'base'} ===`);
    console.log(branchDiffText.trim() ? branchDiffText : '(No changes relative to base branch)');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
