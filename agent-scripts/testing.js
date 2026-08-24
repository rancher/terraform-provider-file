import { execSync } from 'child_process';

export function runPreReviewTests() {
  try {
    let output = '=== PRE-REVIEW TESTING ===\n';

    output += '--- Running Linters ---\n';
    output += execSync('make lint', { stdio: 'pipe' }).toString();

    output += '\n--- Running Agent Script Tests ---\n';
    output += execSync('node --test agent-scripts/tests/*.test.js', { stdio: 'pipe' }).toString();

    output += '\n--- Running Provider Tests ---\n';
    output += execSync('make test', { stdio: 'pipe' }).toString();

    return { success: true, output };
  } catch (error) {
    let failureOutput = '🔴 TEST FAILURE DETECTED.\n\n';
    if (error.stdout) {
      failureOutput += error.stdout.toString();
    }
    if (error.stderr) {
      failureOutput += '\n' + error.stderr.toString();
    }

    return { success: false, failureOutput };
  }
}
