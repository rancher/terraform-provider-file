#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Creates a new branch, syncing the base branch from upstream first.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} params.branchName
 * @param {string} [params.baseBranch]
 * @returns {Promise<{branchName: string, baseBranch: string, syncedRemote: string}>}
 */
export async function createBranch({ git = simpleGit(), branchName, baseBranch }) {
  if (!branchName) {
    throw new Error('Branch name cannot be empty.');
  }

  if (branchName.startsWith('-')) {
    throw new Error('Branch name cannot start with a hyphen.');
  }

  // Determine base branch if not provided
  let base = baseBranch;
  if (!base) {
    const branches = await git.branchLocal();
    if (branches.all.includes('main')) {
      base = 'main';
    } else if (branches.all.includes('master')) {
      base = 'master';
    } else {
      base = 'main';
    }
  }

  // Detect upstream remote
  const remotes = await git.getRemotes();
  const upstreamRemote = remotes.some((r) => r.name === 'upstream') ? 'upstream' : 'origin';

  const remoteRef =
    base.startsWith(`${upstreamRemote}/`) || base.startsWith('origin/') || base.startsWith('upstream/')
      ? base.replace(/^(?:origin|upstream|remotes\/upstream|remotes\/origin)\//, '')
      : base;

  console.log(`Syncing base branch '${remoteRef}' from remote '${upstreamRemote}'...`);
  try {
    await git.fetch(upstreamRemote, remoteRef);
    const current = (await git.branch()).current;
    if (current === remoteRef) {
      await git.merge(['--ff-only', `${upstreamRemote}/${remoteRef}`]);
    } else {
      await git.fetch(upstreamRemote, `${remoteRef}:${remoteRef}`);
    }
    console.log(`Base branch '${remoteRef}' synced with '${upstreamRemote}/${remoteRef}'.`);
  } catch (err) {
    throw new Error(`Failed to sync base branch '${remoteRef}' from '${upstreamRemote}': ${err.message}`, {
      cause: err,
    });
  }

  // Verify branch does not already exist
  const existingBranches = await git.branchLocal();
  if (existingBranches.all.includes(branchName)) {
    throw new Error(`Branch '${branchName}' already exists.`);
  }

  console.log(`Creating and switching to branch '${branchName}' based on '${base}'...`);
  await git.checkoutBranch(branchName, base);

  return { branchName, baseBranch: base, syncedRemote: upstreamRemote };
}

async function main() {
  const branchName = process.argv[2];
  const baseBranch = process.argv[3];

  if (!branchName) {
    console.error('Usage: create-branch.js <branch-name> [base-branch]');
    process.exit(1);
  }

  try {
    const result = await createBranch({ branchName, baseBranch });
    console.log(`✅ Successfully created and switched to branch '${result.branchName}'.`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
