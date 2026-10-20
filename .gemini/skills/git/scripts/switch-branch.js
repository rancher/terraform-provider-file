#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Switches to an existing local or remote branch safely.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} params.branchName
 * @returns {Promise<{branchName: string}>}
 */
export async function switchBranch({ git = simpleGit(), branchName }) {
  if (!branchName) {
    throw new Error('Branch name cannot be empty.');
  }

  if (branchName.startsWith('-')) {
    throw new Error('Branch name cannot start with a hyphen.');
  }

  const cleanBranch = branchName.replace(/^(?:remotes\/)?(?:upstream|origin)\//, '');

  const branches = await git.branch();
  const hasLocal = branches.all.includes(cleanBranch);
  const hasOrigin =
    branches.all.includes(`remotes/origin/${cleanBranch}`) || branches.all.includes(`origin/${cleanBranch}`);
  const hasUpstream =
    branches.all.includes(`remotes/upstream/${cleanBranch}`) || branches.all.includes(`upstream/${cleanBranch}`);

  const branchExists = hasLocal || hasOrigin || hasUpstream || branches.all.includes(branchName);

  if (!branchExists) {
    throw new Error(`Branch '${branchName}' does not exist.`);
  }

  if (!hasLocal && !hasOrigin && hasUpstream) {
    try {
      await git.checkout(['-b', cleanBranch, '--track', `upstream/${cleanBranch}`]);
    } catch {
      await git.checkout(cleanBranch);
    }
  } else {
    await git.checkout(cleanBranch);
  }
  return { branchName: cleanBranch };
}

async function main() {
  const branchName = process.argv[2];
  if (!branchName) {
    console.error('Usage: switch-branch.js <branch-name>');
    process.exit(1);
  }

  try {
    const result = await switchBranch({ branchName });
    console.log(`✅ Successfully switched to branch '${result.branchName}'.`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
