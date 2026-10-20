#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Lists modified files and branch diff status vs main/master.
 * @param {object} [params]
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} [params.baseBranch]
 * @returns {Promise<{statusText: string, branchDiffText: string, baseBranch: string}>}
 */
export async function getFilesChanged({ git = simpleGit(), baseBranch } = {}) {
  const status = await git.raw(['-c', 'core.quotepath=false', 'status', '--short']);

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
  if (!mergeBase) {
    mergeBase = base;
  }

  let branchDiff = '';
  if (mergeBase) {
    branchDiff = await git.raw(['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--name-status', mergeBase]);
  }

  return { statusText: status, branchDiffText: branchDiff, baseBranch: base };
}

/**
 * Parses command-line arguments for get_files_changed.js.
 * Supports:
 * - [base_branch]
 * - [-b base_branch] or [--base base_branch] or [--base=base_branch]
 * @param {Array<string>} [args]
 * @returns {{baseBranch?: string}}
 */
export function parseFilesChangedArgs(args = []) {
  let baseBranch = undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-b' || a === '--base') && i + 1 < args.length) {
      baseBranch = args[++i];
    } else if (a.startsWith('-b=') || a.startsWith('--base=')) {
      baseBranch = a.slice(a.indexOf('=') + 1);
    } else if (a && a !== '--' && !a.startsWith('-')) {
      baseBranch = a;
    }
  }
  return { baseBranch };
}

async function main() {
  const { baseBranch } = parseFilesChangedArgs(process.argv.slice(2));
  try {
    const { statusText, branchDiffText, baseBranch: detectedBase } = await getFilesChanged({ baseBranch });
    console.log('=== Current Working Tree Status ===');
    console.log(statusText.trim() ? statusText : '(Working tree clean)');
    console.log(`\n=== Files Changed in Current Branch vs ${detectedBase || 'base'} ===`);
    console.log(branchDiffText.trim() ? branchDiffText : '(No changes relative to base branch)');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
