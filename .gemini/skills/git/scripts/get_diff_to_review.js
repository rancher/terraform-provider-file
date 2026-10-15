#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Gets staged and unstaged diffs for review.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @returns {Promise<{staged: string, unstaged: string}>}
 */
export async function getDiffToReview({ git = simpleGit() } = {}) {
  const staged = await git.diff(['--no-ext-diff', '--staged']);
  const unstaged = await git.diff(['--no-ext-diff']);
  return { staged, unstaged };
}

async function main() {
  try {
    const { staged, unstaged } = await getDiffToReview();
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
