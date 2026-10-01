import assert from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const summarizeScript = path.join(repoRoot, 'test', 'summarize.sh');

test('test/summarize.sh behavior and output validation', async (t) => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summarize-test-'));
  t.after(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  await t.test('prints usage and exits 0 on --help', async () => {
    const { stdout, stderr } = await execFileAsync(summarizeScript, ['--help']);
    assert.strictEqual(stderr, '');
    assert.match(stdout, /Usage: summarize\.sh \[OPTIONS\] \[REPORT_FILE\]/);
    assert.match(stdout, /summary of passed and failed tests/);
  });

  await t.test('prints usage and exits 0 on -h', async () => {
    const { stdout, stderr } = await execFileAsync(summarizeScript, ['-h']);
    assert.strictEqual(stderr, '');
    assert.match(stdout, /Usage: summarize\.sh \[OPTIONS\] \[REPORT_FILE\]/);
  });

  await t.test('fails with error on unknown flag', async () => {
    await assert.rejects(
      async () => execFileAsync(summarizeScript, ['--invalid-flag']),
      (err) => {
        assert.strictEqual(err.code, 1);
        assert.match(err.stderr, /Error: Unknown option '--invalid-flag'/);
        return true;
      },
    );
  });

  await t.test('fails with error on too many arguments', async () => {
    await assert.rejects(
      async () => execFileAsync(summarizeScript, ['file1.json', 'file2.json']),
      (err) => {
        assert.strictEqual(err.code, 1);
        assert.match(err.stderr, /Error: Too many arguments \(expected at most 1\)\./);
        return true;
      },
    );
  });

  await t.test('accepts -- option terminator and processes specified report file', async () => {
    const tempReportPath = path.join(testDir, `test-dashdash-report-${Date.now()}.json`);
    const reportData =
      JSON.stringify({ Time: '2026-10-01T00:00:00Z', Action: 'pass', Package: 'pkg', Test: 'TestDashDash' }) + '\n';
    await fs.writeFile(tempReportPath, reportData, 'utf-8');

    try {
      const { stdout } = await execFileAsync(summarizeScript, ['--', tempReportPath]);
      assert.match(stdout, /PASSED TESTS:\s+TestDashDash/);
    } finally {
      await fs.unlink(tempReportPath).catch(() => {});
    }
  });

  await t.test('fails with error when explicitly specified report file is missing', async () => {
    await assert.rejects(
      async () => execFileAsync(summarizeScript, ['nonexistent_report_12345.json']),
      (err) => {
        assert.strictEqual(err.code, 1);
        assert.match(err.stderr, /Error: Report file 'nonexistent_report_12345\.json' not found\./);
        return true;
      },
    );
  });

  await t.test('processes report with passed, failed, and subtests correctly', async () => {
    const tempReportPath = path.join(testDir, `test-fixture-report-${Date.now()}.json`);
    const reportData = [
      JSON.stringify({ Time: '2026-10-01T00:00:00Z', Action: 'run', Package: 'pkg', Test: 'TestRoot' }),
      JSON.stringify({ Time: '2026-10-01T00:00:01Z', Action: 'run', Package: 'pkg', Test: 'TestRoot/SubPass' }),
      JSON.stringify({ Time: '2026-10-01T00:00:02Z', Action: 'pass', Package: 'pkg', Test: 'TestRoot/SubPass' }),
      JSON.stringify({ Time: '2026-10-01T00:00:03Z', Action: 'pass', Package: 'pkg', Test: 'TestRoot' }),
      JSON.stringify({ Time: '2026-10-01T00:00:04Z', Action: 'run', Package: 'pkg', Test: 'TestFailedRoot' }),
      JSON.stringify({ Time: '2026-10-01T00:00:05Z', Action: 'run', Package: 'pkg', Test: 'TestFailedRoot/SubFail' }),
      JSON.stringify({ Time: '2026-10-01T00:00:06Z', Action: 'fail', Package: 'pkg', Test: 'TestFailedRoot/SubFail' }),
      JSON.stringify({ Time: '2026-10-01T00:00:07Z', Action: 'fail', Package: 'pkg', Test: 'TestFailedRoot' }),
    ].join('\n');

    await fs.writeFile(tempReportPath, reportData, 'utf-8');

    try {
      const { stdout } = await execFileAsync(summarizeScript, [tempReportPath]);
      assert.match(stdout, /==================== TEST SUMMARY ====================/);
      assert.match(stdout, /PASSED TESTS:\s+TestRoot\/SubPass/);
      assert.match(stdout, /FAILED TESTS:\s+TestFailedRoot\/SubFail/);
      // Ensure parent prefixes are filtered out
      assert.doesNotMatch(stdout, /^TestRoot$/m);
      assert.doesNotMatch(stdout, /^TestFailedRoot$/m);
    } finally {
      await fs.unlink(tempReportPath).catch(() => {});
    }
  });

  await t.test('handles report with (None) passed or failed gracefully', async () => {
    const tempReportPath = path.join(testDir, `test-empty-report-${Date.now()}.json`);
    await fs.writeFile(tempReportPath, '', 'utf-8');

    try {
      const { stdout } = await execFileAsync(summarizeScript, [tempReportPath]);
      assert.match(stdout, /PASSED TESTS:\s+\(None\)/);
      assert.match(stdout, /FAILED TESTS:\s+\(None\)/);
    } finally {
      await fs.unlink(tempReportPath).catch(() => {});
    }
  });

  await t.test('fails cleanly with error when report file has invalid JSON', async () => {
    const tempReportPath = path.join(testDir, `test-corrupt-report-${Date.now()}.json`);
    await fs.writeFile(tempReportPath, 'Not valid json content at all', 'utf-8');

    try {
      await assert.rejects(
        async () => execFileAsync(summarizeScript, [tempReportPath]),
        (err) => {
          assert.strictEqual(err.code, 1);
          assert.match(err.stderr, /Error: Failed to parse test report/);
          return true;
        },
      );
    } finally {
      await fs.unlink(tempReportPath).catch(() => {});
    }
  });

  await t.test('exits 0 silently when default report.json is missing and no arguments passed', async () => {
    const tempDir = await fs.mkdtemp(path.join(testDir, 'temp-cwd-missing-'));
    try {
      const { stdout, stderr } = await execFileAsync(summarizeScript, [], { cwd: tempDir });
      assert.strictEqual(stdout, '');
      assert.strictEqual(stderr, '');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  await t.test('processes default report.json and cleans it up upon completion', async () => {
    const tempDir = await fs.mkdtemp(path.join(testDir, 'temp-cwd-default-'));
    const defaultReport = path.join(tempDir, 'report.json');
    const reportData =
      JSON.stringify({ Time: '2026-10-01T00:00:00Z', Action: 'pass', Package: 'pkg', Test: 'TestClean' }) + '\n';
    await fs.writeFile(defaultReport, reportData, 'utf-8');

    try {
      const { stdout } = await execFileAsync(summarizeScript, [], { cwd: tempDir });
      assert.match(stdout, /PASSED TESTS:\s+TestClean/);
      const exists = await fs
        .access(defaultReport)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(exists, false, 'Default report.json must be cleaned up on success');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
