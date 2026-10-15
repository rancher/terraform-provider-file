#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATTERN = /\b(error|fail|failure|exception|exit status|fatal|panic)\b/i;

/**
 * Recursively searches a directory for regex matches across text files.
 * @param {object} params
 * @param {string} params.logsDir
 * @param {RegExp|string} [params.pattern]
 * @returns {Promise<Array<{file: string, line: number, text: string}>>}
 */
export async function searchLogs({ logsDir, pattern = DEFAULT_PATTERN }) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  const results = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: path.relative(logsDir, fullPath),
                line: i + 1,
                text: lines[i].trim(),
              });
            }
          }
        } catch {
          // Ignore binary or unreadable files
        }
      }
    }
  }

  await walk(logsDir);
  return results;
}

async function main() {
  const logsDir = process.argv[2];
  const customPattern = process.argv[3];

  if (!logsDir) {
    console.error('Usage: search_logs.js <logs_directory> [regex_pattern]');
    process.exit(1);
  }

  try {
    const stat = await fs.stat(logsDir);
    if (!stat.isDirectory()) {
      console.error(`❌ Error: '${logsDir}' is not a directory.`);
      process.exit(1);
    }
  } catch {
    console.error(`❌ Error: Directory '${logsDir}' not found.`);
    process.exit(1);
  }

  const pattern = customPattern || DEFAULT_PATTERN;
  console.log(`Searching for pattern ${pattern} in ${logsDir}...\n----------------------------------------`);

  try {
    const matches = await searchLogs({ logsDir, pattern });
    if (matches.length === 0) {
      console.log(`No matches found for pattern: ${pattern}`);
      return;
    }

    console.log(`Found ${matches.length} matching lines:`);
    for (const m of matches.slice(0, 100)) {
      console.log(`[${m.file}:${m.line}] ${m.text}`);
    }
    if (matches.length > 100) {
      console.log(`\n... (${matches.length - 100} more matches truncated)`);
    }
  } catch (err) {
    console.error(`❌ Error searching logs: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
