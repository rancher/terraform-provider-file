#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Gets staged and unstaged diffs for review.
 * @param {object} [params]
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {Array<string>} [params.files] - Optional list of file paths to inspect
 * @returns {Promise<{staged: string, unstaged: string}>}
 */
export async function getDiffToReview({ git = simpleGit(), files = [] } = {}) {
  const fileArgs = files && files.length > 0 ? files : [];
  const staged = await git.raw([
    '-c',
    'core.quotepath=false',
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--staged',
    '--',
    ...fileArgs,
  ]);
  const unstaged = await git.raw([
    '-c',
    'core.quotepath=false',
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--',
    ...fileArgs,
  ]);
  return { staged, unstaged };
}

async function main() {
  const files = process.argv.slice(2);
  try {
    const { staged, unstaged } = await getDiffToReview({ files });
    console.log('=== Staged Changes (to be committed) ===');
    console.log(staged.trim() ? staged : '(No staged changes)');
    console.log('\n=== Unstaged Changes (working tree) ===');
    console.log(unstaged.trim() ? unstaged : '(No unstaged changes)');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
