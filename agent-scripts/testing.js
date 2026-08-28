import { execSync } from 'child_process';

export function runPreReviewTests(exec = execSync) {
  let output = '=== PRE-REVIEW TESTING ===\n\n';
  let overallSuccess = true;
  let failureDetails = '';

  // 1. Full Workspace Lint (Unified lint.sh all)
  try {
    output += '--- Running Full Workspace Lint (lint.sh all) ---\n';
    const lintOutput = exec('bash .github/workflows/scripts/lint.sh all', { stdio: 'pipe' }).toString();
    output += lintOutput + '\n🟢 Full workspace lint passed.\n\n';
  } catch (err) {
    overallSuccess = false;
    const errOut = err.stdout ? err.stdout.toString() : '';
    const errErr = err.stderr ? err.stderr.toString() : '';
    const errMsg = err.message || '';
    const errStack = err.stack || '';
    const details =
      `❌ Full workspace lint failed.\n` +
      (errOut ? `Stdout:\n${errOut}\n` : '') +
      (errErr ? `Stderr:\n${errErr}\n` : '') +
      `Error Details: ${errMsg}\n` +
      (errStack && !errOut && !errErr ? `Stack Trace:\n${errStack}\n` : '');
    output += details + '\n';
    failureDetails += details + '\n';
  }

  // 2. Full Workspace Tests (Unified test.sh all)
  try {
    output += '--- Running Full Workspace Tests (test.sh all) ---\n';
    const testOutput = exec('bash .github/workflows/scripts/test.sh all', { stdio: 'pipe' }).toString();
    output += testOutput + '\n🟢 Full workspace tests passed.\n\n';
  } catch (err) {
    overallSuccess = false;
    const errOut = err.stdout ? err.stdout.toString() : '';
    const errErr = err.stderr ? err.stderr.toString() : '';
    const errMsg = err.message || '';
    const errStack = err.stack || '';
    const details =
      `❌ Full workspace tests failed.\n` +
      (errOut ? `Stdout:\n${errOut}\n` : '') +
      (errErr ? `Stderr:\n${errErr}\n` : '') +
      `Error Details: ${errMsg}\n` +
      (errStack && !errOut && !errErr ? `Stack Trace:\n${errStack}\n` : '');
    output += details + '\n';
    failureDetails += details + '\n';
  }

  if (overallSuccess) {
    return { success: true, output };
  } else {
    return { success: false, failureOutput: failureDetails || output };
  }
}
