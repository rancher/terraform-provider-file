#!/usr/bin/env node
import { simpleGit } from 'simple-git';

/**
 * Retrieves the contents of a deleted or modified file from Git history.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} params.filePath
 * @returns {Promise<string>}
 */
export async function getDeletedFile({ git = simpleGit(), filePath }) {
  if (!filePath) {
    throw new Error('Missing file path.');
  }

  // Find last commit where file was modified
  const log = await git.log({ file: filePath, maxCount: 1 });
  if (log.all.length === 0) {
    throw new Error(`File '${filePath}' was never found in git history.`);
  }

  const lastCommit = log.all[0].hash;

  try {
    const content = await git.show([`${lastCommit}:${filePath}`]);
    return content;
  } catch {
    // If not found at last commit (e.g. was deleted in that commit), check parent commit
    try {
      const content = await git.show([`${lastCommit}~1:${filePath}`]);
      return content;
    } catch {
      throw new Error(`Could not retrieve contents for '${filePath}' from history.`);
    }
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: get_deleted_file.js <file_path>');
    process.exit(1);
  }

  try {
    const content = await getDeletedFile({ filePath });
    process.stdout.write(content.endsWith('\n') ? content : content + '\n');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
