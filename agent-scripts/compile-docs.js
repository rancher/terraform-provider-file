#!/usr/bin/env node
/**
 * Script: compile-docs.js
 * Description: Programmatically parse all Diátaxis TOML files and output a unified compiled JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import TOML from '@iarna/toml';

const workspaceRoot = process.cwd();
const docsDir = path.join(workspaceRoot, 'docs');
const outputFilePath = path.join(docsDir, 'docs-compiled.json');

async function getFilesRecursively(dir) {
  let results = [];
  const list = await fs.promises.readdir(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = await fs.promises.stat(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(await getFilesRecursively(fullPath));
    } else if (file.endsWith('.toml')) {
      results.push(fullPath);
    }
  }
  return results;
}

export default async function main(core) {
  const lockPath = `${outputFilePath}.lock`;
  let lock;
  try {
    lock = await fs.promises.open(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      try {
        const stat = await fs.promises.stat(lockPath);
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
          // 5 minutes stale
          core.info('Found stale compilation lock file. Removing and retrying...');
          try {
            await fs.promises.unlink(lockPath);
          } catch (unlinkErr) {
            if (unlinkErr.code !== 'ENOENT') {
              throw unlinkErr;
            }
          }
          lock = await fs.promises.open(lockPath, 'wx');
        } else {
          core.info('Compilation already in progress by another instance. Exiting.');
          return;
        }
      } catch (staleErr) {
        core.setFailed(`Failed to resolve compilation lock: ${staleErr.message}`);
        process.exitCode = 1;
        return;
      }
    } else {
      core.setFailed(`Failed to acquire compilation lock: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    const tomlFiles = await getFilesRecursively(docsDir);
    const compiledDocs = {};

    // Limit concurrency to max 10 concurrent file reads/parses
    const CONCURRENCY_LIMIT = 10;
    const chunks = [];
    for (let i = 0; i < tomlFiles.length; i += CONCURRENCY_LIMIT) {
      chunks.push(tomlFiles.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (file) => {
          const relativePath = path.relative(workspaceRoot, file);
          const stat = await fs.promises.stat(file);

          // DoS Prevention: Verify file size is less than 1MB
          if (stat.size > 1024 * 1024) {
            throw new Error(`File ${relativePath} exceeds maximum allowed size of 1MB (size: ${stat.size} bytes).`);
          }

          const content = await fs.promises.readFile(file, 'utf8');
          try {
            const parsed = TOML.parse(content);
            compiledDocs[relativePath] = parsed;
          } catch (err) {
            core.setFailed(`Failed to parse TOML in ${relativePath}: ${err.message}`);
            throw err;
          }
        }),
      );
    }

    // Alphabetically sort keys to guarantee deterministic compiled JSON output
    const sortedDocs = {};
    Object.keys(compiledDocs)
      .sort()
      .forEach((key) => {
        sortedDocs[key] = compiledDocs[key];
      });

    const randomBytesAsync = promisify(crypto.randomBytes);
    const randBytes = await randomBytesAsync(4);
    const randHex = randBytes.toString('hex');
    const tempPath = `${outputFilePath}.${Date.now()}-${randHex}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(sortedDocs, null, 2) + '\n', 'utf8');
    await fs.promises.rename(tempPath, outputFilePath);
    core.info(`Successfully compiled ${Object.keys(sortedDocs).length} TOML documents to ${outputFilePath}`);
  } catch (err) {
    core.setFailed(`Compilation failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (lock) {
      try {
        await lock.close();
      } catch (closeErr) {
        core.warning(`Failed to close lock descriptor: ${closeErr.message}`);
      }
      try {
        await fs.promises.unlink(lockPath);
      } catch (unlinkErr) {
        core.warning(`Failed to clean up lock file: ${unlinkErr.message}`);
      }
    }
  }
}

const isMain =
  process.argv[1] && (process.argv[1].endsWith('compile-docs.js') || process.argv[1].endsWith('compile-docs.mjs'));
if (isMain) {
  import('@actions/core')
    .then((core) => {
      main(core).catch((err) => {
        core.setFailed(`Unhandled execution exception: ${err.message}`);
      });
    })
    .catch((err) => {
      console.error('Failed to import @actions/core:', err);
      process.exitCode = 1;
    });
}
