#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from 'octokit';

const execFileAsync = promisify(execFile);

/**
 * Resolves an active GitHub authentication token.
 * Precedence:
 * 1. process.env.GITHUB_TOKEN or process.env.GH_TOKEN
 * 2. Fallback to `gh auth token` via GitHub CLI
 * @returns {Promise<string>} Authentication token
 */
export async function getAuthToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    return envToken.trim();
  }

  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    if (stdout && stdout.trim()) {
      return stdout.trim();
    }
  } catch {
    // gh CLI might not be installed or logged in
  }

  return '';
}

/**
 * Returns an authenticated Octokit instance.
 * @param {string} [tokenOverride] - Optional token override
 * @returns {Promise<Octokit>}
 */
export async function getOctokit(tokenOverride) {
  const token = tokenOverride || (await getAuthToken());
  if (!token) {
    throw new Error(
      'GitHub authentication token not found. Please set GITHUB_TOKEN / GH_TOKEN or log in with `gh auth login`.',
    );
  }
  return new Octokit({ auth: token });
}

/**
 * Resolves the owner and repo for the current workspace.
 * Parses git remote 'origin' or 'upstream', or falls back to 'rancher/terraform-provider-file'.
 * @returns {Promise<{owner: string, repo: string}>}
 */
export async function getRepoDetails() {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    const match = url.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // If git remote inspection fails, use fallback
  }

  return { owner: 'rancher', repo: 'terraform-provider-file' };
}

/**
 * Resolves current pull request number from branch or git status.
 * @returns {Promise<number|null>}
 */
export async function getCurrentPRNumber() {
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', '--json', 'number', '-q', '.number']);
    const num = parseInt(stdout.trim(), 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}
