#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from 'octokit';

const execFileAsync = promisify(execFile);

/**
 * Resolves an active GitHub authentication token.
 * Precedence:
 * 1. process.env.GITHUB_TOKEN or process.env.GH_TOKEN
 * 2. Fallback to `gh auth token`
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
 * @param {string} [tokenOverride]
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
    // Fallback
  }

  return { owner: 'rancher', repo: 'terraform-provider-file' };
}

/**
 * Returns current local git branch name.
 * @returns {Promise<string>}
 */
export async function getCurrentBranch() {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current']);
    return stdout.trim();
  } catch {
    return '';
  }
}
