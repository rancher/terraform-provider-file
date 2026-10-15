#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Parses git status porcelain output and returns an array of modified/untracked file paths.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @returns {Promise<Array<string>>}
 */
export async function getModifiedPaths({ git = simpleGit() } = {}) {
  const porcelain = await git.raw(['status', '--porcelain']);
  const lines = porcelain.split('\n');
  const paths = [];

  for (const line of lines) {
    if (!line || line.length < 3) continue;
    let filePath = line.slice(3).trim();
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ')[1];
    }
    if (filePath) {
      paths.push(filePath);
    }
  }

  return paths;
}

async function main() {
  try {
    const paths = await getModifiedPaths();
    for (const p of paths) {
      console.log(p);
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
