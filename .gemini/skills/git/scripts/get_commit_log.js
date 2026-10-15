#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Gets concise commit log for current branch.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {number} [params.limit=5]
 * @returns {Promise<Array<{hash: string, message: string, date: string}>>}
 */
export async function getCommitLog({ git = simpleGit(), limit = 5 } = {}) {
  const log = await git.log({ maxCount: limit });
  return log.all.map((c) => ({
    hash: c.hash.slice(0, 7),
    message: c.message,
    date: c.date,
  }));
}

async function main() {
  const limitArg = process.argv[2];
  const limit = limitArg ? parseInt(limitArg, 10) : 5;

  try {
    const commits = await getCommitLog({ limit });
    console.log(`=== Last ${commits.length} Commits ===`);
    for (const c of commits) {
      console.log(`${c.hash} ${c.message}`);
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
