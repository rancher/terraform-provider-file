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

  return getGhCliToken();
}

/**
 * Retrieves the stored GitHub CLI token by unsetting environment token overrides.
 * @returns {Promise<string>} Stored gh token
 */
export async function getGhCliToken() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
    });
    if (stdout && stdout.trim()) {
      return stdout.trim();
    }
  } catch {
    // gh CLI might not be installed or logged in
  }

  return '';
}

/**
 * Returns an authenticated Octokit instance with automatic credential fallback.
 * @param {string} [tokenOverride] - Optional token override
 * @returns {Promise<Octokit>}
 */
export async function getOctokit(tokenOverride) {
  if (tokenOverride) {
    return new Octokit({ auth: tokenOverride });
  }

  const primaryToken = await getAuthToken();
  const fallbackToken = await getGhCliToken();

  if (!primaryToken && !fallbackToken) {
    throw new Error(
      'GitHub authentication token not found. Please set GITHUB_TOKEN / GH_TOKEN or log in with `gh auth login`.',
    );
  }

  let activeToken = primaryToken || fallbackToken;

  function createDynamicAuth() {
    return function authStrategy() {
      const authFn = async () => ({ type: 'token', token: activeToken, tokenType: 'oauth' });
      authFn.hook = async (request, route, parameters) => {
        const endpoint = request.endpoint.merge(route, parameters);
        endpoint.headers.authorization = `token ${activeToken}`;
        return request(endpoint);
      };
      return authFn;
    };
  }

  const octokit = new Octokit({ authStrategy: createDynamicAuth() });

  if (fallbackToken && primaryToken && primaryToken !== fallbackToken) {
    octokit.hook.error('request', async (error, options) => {
      if ((error.status === 401 || error.status === 403) && activeToken !== fallbackToken) {
        activeToken = fallbackToken;
        return octokit.request(options);
      }
      throw error;
    });

    const origGraphql = octokit.graphql.bind(octokit);
    octokit.graphql = async (query, vars) => {
      try {
        return await origGraphql(query, vars);
      } catch (err) {
        if (activeToken !== fallbackToken) {
          activeToken = fallbackToken;
          return await origGraphql(query, vars);
        }
        throw err;
      }
    };
  }

  return octokit;
}

/**
 * Resolves the owner and repo for the current workspace.
 * Precedence:
 * 1. process.env.GH_REPO or process.env.GITHUB_REPOSITORY (e.g. 'owner/repo')
 * 2. Git remote 'upstream'
 * 3. Git remote 'origin'
 * Throws an error if owner and repo cannot be determined.
 * @returns {Promise<{owner: string, repo: string}>}
 */
export async function getRepoDetails() {
  const envRepo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (envRepo && envRepo.includes('/')) {
    const [owner, repo] = envRepo.trim().split('/');
    if (owner && repo) {
      return { owner, repo };
    }
  }

  for (const remote of ['upstream', 'origin']) {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', remote]);
      const url = stdout.trim();
      const match = url.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    } catch {
      // Remote does not exist or git failed, try next
    }
  }

  throw new Error(
    'Unable to determine GitHub repository. Please set GH_REPO or GITHUB_REPOSITORY (e.g. "owner/repo") or configure a git remote.',
  );
}

/**
 * Resolves current pull request number from branch via GitHub API.
 * Falls back to `gh pr view` if available.
 * @param {import('octokit').Octokit} [octokitInstance]
 * @returns {Promise<number|null>}
 */
export async function getCurrentPRNumber(octokitInstance) {
  try {
    const { stdout: branchOut } = await execFileAsync('git', ['branch', '--show-current']);
    const branch = branchOut.trim();

    if (branch) {
      try {
        const octokit = octokitInstance || (await getOctokit());
        const { owner, repo } = await getRepoDetails();
        const { data: pulls } = await octokit.rest.pulls.list({
          owner,
          repo,
          state: 'open',
          per_page: 100,
        });

        const match = pulls.find((p) => p.head.ref === branch);
        if (match) {
          return match.number;
        }
      } catch {
        // If API lookup fails, fall through to CLI fallback
      }
    }
  } catch {
    // Git branch inspection failed
  }

  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', '--json', 'number', '-q', '.number']);
    const num = parseInt(stdout.trim(), 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}
