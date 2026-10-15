#!/usr/bin/env node
import { simpleGit } from 'simple-git';

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?(!)?:\ .+/i;

/**
 * Validates a candidate commit message against conventional commit format and repository boundaries.
 * @param {object} params
 * @param {string} params.message
 * @param {boolean} params.affectsProduct
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateCommitMessage({ message, affectsProduct }) {
  if (!message || !message.trim()) {
    return { valid: false, reason: 'Missing commit message.' };
  }

  const subject = message.split('\n')[0].trim().replace(/\r$/, '');
  if (!CONVENTIONAL_COMMIT_REGEX.test(subject)) {
    return {
      valid: false,
      reason: `Commit message title does not follow Conventional Commits format: '${subject}'. Expected 'type: description' or 'type(scope): description'.`,
    };
  }

  if (subject.length > 72) {
    return {
      valid: false,
      reason: `Commit subject line exceeds 72 characters (${subject.length}): '${subject}'`,
    };
  }

  const match = subject.match(/^([a-z]+)(?:\([^)]+\))?(!?):/i);
  const type = match[1].toLowerCase();
  const hasBreakingIndicator = match[2] === '!' || /(^|\s)BREAKING[ -]CHANGE:/m.test(message);

  if (!affectsProduct) {
    if (type === 'feat' || type === 'refactor' || hasBreakingIndicator) {
      return {
        valid: false,
        reason:
          "Non-product change (outside 'internal/') must NOT use 'feat', 'refactor', or '!' breaking-change indicators.",
      };
    }
  }

  return { valid: true };
}

/**
 * Creates a validated commit, blocking main/master branch commits.
 * @param {object} params
 * @param {import('simple-git').SimpleGit} [params.git]
 * @param {string} params.message
 * @returns {Promise<object>} Commit summary
 */
export async function createCommit({ git = simpleGit(), message }) {
  const currentBranch = (await git.branch()).current;
  if (!currentBranch || currentBranch === 'HEAD') {
    throw new Error('Cannot commit on a detached HEAD.');
  }

  if (currentBranch === 'main' || currentBranch === 'master') {
    throw new Error(`Commits directly to the '${currentBranch}' branch are not allowed.`);
  }

  const diffSummary = await git.diffSummary(['--cached']);
  if (diffSummary.files.length === 0) {
    const unstaged = await git.diffSummary();
    if (unstaged.files.length === 0) {
      throw new Error('No changes to commit (working tree clean and staging area empty).');
    } else {
      throw new Error('No staged changes found. Please stage changes with stage-files.js before committing.');
    }
  }

  const affectsProduct = diffSummary.files.some((f) => f.file.startsWith('internal/'));
  const validation = validateCommitMessage({ message, affectsProduct });
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const result = await git.commit(message, undefined, { '-s': null });
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let message = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m' && i + 1 < args.length) {
      message = args[i + 1];
      i++;
    } else if (!message) {
      message = args[i];
    } else {
      message += ' ' + args[i];
    }
  }

  if (!message) {
    console.error('Usage: commit.js [-m <message>] <message>');
    process.exit(1);
  }

  try {
    const summary = await createCommit({ message });
    console.log(`✅ Commit successfully created on branch '${summary.branch}'! (${summary.commit})`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main();
}
