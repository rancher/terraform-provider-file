import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import main from '../../compile-docs.js';

test('compile-docs.js unit tests', async (t) => {
  const dummyCore = {
    info: () => {},
    setFailed: () => {},
    warning: () => {},
  };

  await t.test('compiles successfully with dummy core', async () => {
    const originalExitCode = process.exitCode;
    try {
      await main(dummyCore);
      assert.ok(process.exitCode !== 1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  await t.test('handles stale lock files correctly and cleans them up', async () => {
    const lockPath = path.join(process.cwd(), 'docs', 'docs-compiled.json.lock');

    // Ensure the lock path is clean first
    try {
      await fs.promises.unlink(lockPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // Write a stale lock file (10 minutes old)
    await fs.promises.writeFile(lockPath, 'stale lock', 'utf8');
    const pastTime = Date.now() - 10 * 60 * 1000;
    await fs.promises.utimes(lockPath, new Date(pastTime), new Date(pastTime));

    const originalExitCode = process.exitCode;
    try {
      await main(dummyCore);
      assert.ok(process.exitCode !== 1);
      // The stale lock file should have been removed and successfully compiled
      const lockExists = await fs.promises
        .stat(lockPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(lockExists, false);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
