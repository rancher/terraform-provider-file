import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execAsync = promisify(exec);

/**
 * Programmatically retrieves PR comments using the git-pr skill script.
 * @param {string|number} [prTarget] - Optional PR number or "current"
 * @returns {Promise<string>} The formatted PR comments
 */
export async function getPRComments(prTarget = 'current') {
  const scriptPath = path.join(process.cwd(), '.gemini/skills/github-pr/scripts/read_comments.sh');
  try {
    const { stdout } = await execAsync(`bash "${scriptPath}" "${prTarget}"`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });
    return stdout;
  } catch (err) {
    const stderrMsg = err.stderr || err.message;
    throw new Error(`Failed to fetch PR comments programmatically: ${stderrMsg}`, { cause: err });
  }
}
