import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCommitTitle } from '../../.github/workflows/scripts/validate-commit-message.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Gets the current unstaged and staged git diff.
 * @returns {Promise<string>} The git diff
 */
export async function getGitDiff() {
  const { stdout } = await execAsync('git diff HEAD', { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/**
 * Checks if the cached (staged) or active changes affect product files (i.e. files in internal/).
 * @returns {Promise<boolean>}
 */
export async function affectsProductFiles() {
  const { stdout: diffFiles } = await execAsync('git diff --name-only HEAD', { maxBuffer: 10 * 1024 * 1024 });
  const changedFiles = diffFiles
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  return changedFiles.some((f) => f.startsWith('internal/'));
}

/**
 * Validates a candidate commit message against the repository rules.
 * @param {string} message - The commit message to validate
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
export async function validateMessage(message) {
  const isProduct = await affectsProductFiles();
  const result = validateCommitTitle(message, isProduct, false);
  return result;
}

/**
 * Stages all changes and executes a signed, validated git commit.
 * @param {string} commitMessage - The message to commit with
 * @returns {Promise<{stdout: string, stderr: string}>} The commit result
 */
export async function stageAndCommit(commitMessage) {
  // First stage all changes
  await execAsync('git add -A');

  // Verify the message before committing
  const validation = await validateMessage(commitMessage);
  if (!validation.valid) {
    throw new Error(`Commit message validation failed: ${validation.reason}`);
  }

  // Perform signed and signed-off commit
  const { stdout, stderr } = await execFileAsync('git', ['commit', '-s', '-S', '-m', commitMessage], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}
