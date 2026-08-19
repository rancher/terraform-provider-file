import { execSync } from 'child_process';

/**
 * Checks git status to determine if there is an active (modified, added, untracked) plan in docs/development/
 * @param {string} cwd - The current working directory
 * @returns {boolean} - True if an active plan exists, false otherwise
 */
export function checkActivePlan(cwd) {
  try {
    const statusOutput = execSync('git status --porcelain', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();

    return statusOutput.split('\n').some((line) => {
      const trimmed = line.trim();
      if (!trimmed.includes('docs/development/')) {
        return false;
      }
      const status = line.substring(0, 2);
      // Ensure the file is not deleted ('D') or ignored ('!')
      return !status.includes('D') && !status.includes('!');
    });
  } catch (err) {
    console.error('Failed to run git status inside planning check:', err.message || err);
    return false;
  }
}
