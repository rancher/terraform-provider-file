#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Parses command-line arguments for get_diff_to_review.js.
 * Extracts flags (--staged/--cached, --unstaged/--working-tree, --stat, --name-only) and file paths.
 * @param {Array<string>} [args]
 * @returns {{files: Array<string>, stagedOnly: boolean, unstagedOnly: boolean, statOnly: boolean, nameOnly: boolean}}
 */
export function parseDiffArgs(args = []) {
  const files = [];
  let stagedOnly = false;
  let unstagedOnly = false;
  let statOnly = false;
  let nameOnly = false;
  let separatorReached = false;

  for (const arg of args) {
    if (separatorReached) {
      files.push(arg);
      continue;
    }
    if (arg === '--') {
      separatorReached = true;
      continue;
    }
    if (arg === '--staged' || arg === '--cached') {
      stagedOnly = true;
    } else if (arg === '--unstaged' || arg === '--working-tree') {
      unstagedOnly = true;
    } else if (arg === '--stat') {
      statOnly = true;
    } else if (arg === '--name-only') {
      nameOnly = true;
    } else if (arg && !arg.startsWith('-')) {
      files.push(arg);
    }
  }

  if (stagedOnly && unstagedOnly) {
    stagedOnly = false;
    unstagedOnly = false;
  }

  return { files, stagedOnly, unstagedOnly, statOnly, nameOnly };
}

/**
 * Gets staged and unstaged diffs for review.
 * @param {object} [params]
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {Array<string>} [params.files] - Optional list of file paths to inspect
 * @param {boolean} [params.stagedOnly] - Retrieve only staged changes
 * @param {boolean} [params.unstagedOnly] - Retrieve only unstaged changes
 * @param {boolean} [params.statOnly] - Retrieve diffstat summary instead of full diff
 * @param {boolean} [params.nameOnly] - Retrieve only changed file names
 * @returns {Promise<{staged: string, unstaged: string}>}
 */
export async function getDiffToReview({
  git = simpleGit(),
  files = [],
  stagedOnly = false,
  unstagedOnly = false,
  statOnly = false,
  nameOnly = false,
} = {}) {
  const extraFlags = [];
  if (statOnly) extraFlags.push('--stat');
  if (nameOnly) extraFlags.push('--name-only');

  const fileArgs = files && files.length > 0 ? files : [];

  let staged = '';
  if (!unstagedOnly) {
    staged = await git.raw([
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      ...extraFlags,
      '--staged',
      '--',
      ...fileArgs,
    ]);
  }

  let unstaged = '';
  if (!stagedOnly) {
    unstaged = await git.raw([
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      ...extraFlags,
      '--',
      ...fileArgs,
    ]);
  }

  return { staged, unstaged };
}

async function main() {
  const { files, stagedOnly, unstagedOnly, statOnly, nameOnly } = parseDiffArgs(process.argv.slice(2));
  try {
    const { staged, unstaged } = await getDiffToReview({ files, stagedOnly, unstagedOnly, statOnly, nameOnly });
    if (!unstagedOnly) {
      console.log('=== Staged Changes (to be committed) ===');
      console.log(staged.trim() ? staged : '(No staged changes)');
    }
    if (!stagedOnly && !unstagedOnly) {
      console.log('\n=== Unstaged Changes (working tree) ===');
      console.log(unstaged.trim() ? unstaged : '(No unstaged changes)');
    } else if (unstagedOnly) {
      console.log('=== Unstaged Changes (working tree) ===');
      console.log(unstaged.trim() ? unstaged : '(No unstaged changes)');
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
