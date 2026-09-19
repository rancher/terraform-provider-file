import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Runs the workspace tests and linters programmatically.
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
export async function runQAPipeline() {
  const command = 'npm run test && bash .github/workflows/scripts/lint.sh all --fix && go test ./...';
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600000, // 10 minutes timeout
    });
    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
    };
  }
}
