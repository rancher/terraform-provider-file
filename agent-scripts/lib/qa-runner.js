import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Runs the workspace tests and linters programmatically.
 * @param {object} [options]
 * @param {boolean} [options.fix=false] - Whether to allow linters to automatically fix files
 * @param {Function} [options.execFn=null] - Custom exec function for dependency injection in testing
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
export async function runQAPipeline({ fix = false, execFn = null } = {}) {
  const runner = execFn || execAsync;
  const lintCmd = fix
    ? 'bash .github/workflows/scripts/lint.sh all --fix'
    : 'bash .github/workflows/scripts/lint.sh all';
  const commands = ['npm run test', lintCmd, 'go test ./...'];

  const results = await Promise.all(
    commands.map(async (cmd) => {
      try {
        const { stdout, stderr } = await runner(cmd, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 600000, // 10 minutes timeout
        });
        return {
          success: true,
          stdout: stdout && stdout.trim() ? stdout.trim() : '',
          stderr: stderr && stderr.trim() ? stderr.trim() : '',
        };
      } catch (err) {
        return {
          success: false,
          stdout: err.stdout && err.stdout.trim() ? err.stdout.trim() : '',
          stderr:
            err.stderr && err.stderr.trim()
              ? err.stderr.trim()
              : err.message && err.message.trim()
                ? err.message.trim()
                : '',
        };
      }
    }),
  );

  const allSuccess = results.every((r) => r.success);
  const stdoutChunks = results.map((r) => r.stdout).filter(Boolean);
  const stderrChunks = results.map((r) => r.stderr).filter(Boolean);

  return {
    success: allSuccess,
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
  };
}
