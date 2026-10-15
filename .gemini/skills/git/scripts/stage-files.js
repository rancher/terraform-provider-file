#!/usr/bin/env node
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { isExcludedByAIExclude } from './read-ignored-file.js';

/**
 * Stages files safely, ensuring .aiexclude patterns are respected.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {Array<string>} params.files
 * @param {boolean} [params.all]
 * @returns {Promise<Array<string>>} List of staged files
 */
export async function stageFiles({ git = simpleGit(), files = [], all = false }) {
  const root = (await git.revparse(['--show-toplevel'])).trim();

  if (all) {
    await git.add(['-u']);
    return ['--all'];
  }

  if (files.length === 0) {
    throw new Error('No files specified to stage.');
  }

  for (const file of files) {
    const fullPath = path.isAbsolute(file) ? file : path.resolve(root, file);
    const isBlocked = await isExcludedByAIExclude(fullPath, root);
    if (isBlocked) {
      throw new Error(`File '${file}' is blocked by .aiexclude policy. Staging aborted.`);
    }
  }

  await git.add(files);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: stage-files.js <file1> [file2...] | --all');
    process.exit(1);
  }

  const all = args.includes('--all') || args.includes('-A');
  const files = args.filter((a) => a !== '--all' && a !== '-A');

  try {
    const staged = await stageFiles({ files, all });
    console.log(`✅ Successfully staged: ${staged.join(', ')}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
