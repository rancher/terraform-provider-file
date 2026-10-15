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

  const branches = await git.branch();
  const branchExists =
    branches.all.includes(branchName) ||
    branches.all.includes(`remotes/origin/${branchName}`) ||
    branches.all.includes(`remotes/upstream/${branchName}`);

  if (!branchExists) {
    throw new Error(`Branch '${branchName}' does not exist.`);
  }

  await git.checkout(branchName);
  return { branchName };
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
