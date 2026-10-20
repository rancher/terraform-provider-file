#!/usr/bin/env node
import fs from 'node:fs';
import { simpleGit } from 'simple-git';

/**
 * Gets diff between current branch and base branch (main/master).
 * @param {object} [params]
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} [params.baseBranch]
 * @param {Array<string>} [params.files]
 * @param {boolean} [params.statOnly]
 * @param {boolean} [params.nameOnly]
 * @returns {Promise<string>}
 */
export async function getBranchChanges({
  git = simpleGit(),
  baseBranch,
  files = [],
  statOnly = false,
  nameOnly = false,
} = {}) {
  let base = baseBranch;
  if (!base) {
    const branches = git.branch ? await git.branch() : await git.branchLocal();
    if (branches.all.includes('main')) {
      base = 'main';
    } else if (branches.all.includes('master')) {
      base = 'master';
    } else if (branches.all.includes('remotes/upstream/main') || branches.all.includes('upstream/main')) {
      base = 'upstream/main';
    } else if (branches.all.includes('remotes/origin/main') || branches.all.includes('origin/main')) {
      base = 'origin/main';
    } else if (branches.all.includes('remotes/upstream/master') || branches.all.includes('upstream/master')) {
      base = 'upstream/master';
    } else if (branches.all.includes('remotes/origin/master') || branches.all.includes('origin/master')) {
      base = 'origin/master';
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

  const extraFlags = [];
  if (statOnly) extraFlags.push('--stat');
  if (nameOnly) extraFlags.push('--name-only');

  const fileArgs = files && files.length > 0 ? files.filter((f) => f !== '--') : [];
  if (git.raw) {
    try {
      const rawDiff = await git.raw([
        '-c',
        'core.quotepath=false',
        'diff',
        '--no-ext-diff',
        '--no-color',
        ...extraFlags,
        mergeBase,
        '--',
        ...fileArgs,
      ]);
      if (rawDiff) {
        return rawDiff;
      }
    } catch {
      // Fallback to git.diff if raw diff fails
    }
  }
  if (git.diff) {
    return await git.diff(['--no-ext-diff', '--no-color', ...extraFlags, mergeBase, '--', ...fileArgs]);
  }
  return '';
}

/**
 * Parses command-line arguments for get_branch_changes.js.
 * Supports:
 * - [--stat|--name-only]
 * - [-b base_branch] or [--base base_branch] or [--base=base_branch]
 * - [base_branch] [file_path...]
 * @param {Array<string>} [args]
 * @returns {{baseBranch?: string, files: Array<string>, statOnly: boolean, nameOnly: boolean}}
 */
export function parseBranchChangesArgs(args = []) {
  let baseBranch;
  const files = [];
  let statOnly = false;
  let nameOnly = false;
  let separatorReached = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (separatorReached) {
      files.push(arg);
      continue;
    }
    if (arg === '--') {
      separatorReached = true;
      continue;
    }
    if (arg === '--stat') {
      statOnly = true;
    } else if (arg === '--name-only') {
      nameOnly = true;
    } else if ((arg === '-b' || arg === '--base') && i + 1 < args.length) {
      baseBranch = args[++i];
    } else if (arg.startsWith('-b=') || arg.startsWith('--base=')) {
      baseBranch = arg.slice(arg.indexOf('=') + 1);
    } else if (!baseBranch && !arg.startsWith('-')) {
      const isFileOnDisk = fs.existsSync(arg) && arg !== 'main' && arg !== 'master';
      const isBranchName =
        !isFileOnDisk &&
        !arg.includes('.') &&
        (!arg.includes('/') || arg.startsWith('origin/') || arg.startsWith('upstream/') || arg.startsWith('remotes/'));
      if (isBranchName) {
        baseBranch = arg;
      } else {
        files.push(arg);
      }
    } else if (!arg.startsWith('-')) {
      files.push(arg);
    }
  }

  return { baseBranch, files, statOnly, nameOnly };
}

async function main() {
  const { baseBranch, files, statOnly, nameOnly } = parseBranchChangesArgs(process.argv.slice(2));

  try {
    const diff = await getBranchChanges({ baseBranch, files, statOnly, nameOnly });
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
