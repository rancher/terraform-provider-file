import { spawn } from 'child_process';
import { gitBranchShowCurrent } from './git.js';

/**
 * Safe JSON parsing helper to comply with fail-safe standards.
 */
function safeJsonParse(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.warn(`JSON parsing failed: ${err.message}. Raw value: ${str}`);
    return fallback;
  }
}

/**
 * Safely executes the `gh` CLI, returning stdout.
 * Bypasses the shell for maximum security against injection.
 */
export function runGh(args, options = {}) {
  const { envOverrides = {}, cwd = process.cwd(), input, signal } = options;
  const env = { ...process.env, ...envOverrides };
  const spawnOptions = {
    cwd,
    env,
    ...(signal ? { signal } : {}),
  };

  return new Promise((resolve, reject) => {
    // Type validation to comply with fail-safe types standards
    if (input !== undefined && input !== null && typeof input !== 'string' && !globalThis.Buffer.isBuffer(input)) {
      return reject(new TypeError('options.input must be a string or Buffer'));
    }

    const child = spawn('gh', args, spawnOptions);

    let stdout = '';
    let stderr = '';
    const bufferLimit = 10 * 1024 * 1024; // 10MB memory protection limit
    let limitExceeded = false;

    // Attach error listener to stdin to handle backpressure and ignore EPIPE
    if (child.stdin) {
      child.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE' && !limitExceeded) {
          reject(new Error(`gh stdin error: ${err.message}`));
        }
      });
    }

    if (input !== undefined && input !== null) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.stdout.on('data', (data) => {
      if (limitExceeded) {
        return;
      }
      stdout += data.toString();
      if (stdout.length > bufferLimit) {
        limitExceeded = true;
        child.kill();
        reject(new Error('Memory Exhaustion Protection: stdout limit exceeded 10MB'));
      }
    });

    child.stderr.on('data', (data) => {
      if (limitExceeded) {
        return;
      }
      stderr += data.toString();
      if (stderr.length > bufferLimit) {
        limitExceeded = true;
        child.kill();
        reject(new Error('Memory Exhaustion Protection: stderr limit exceeded 10MB'));
      }
    });

    child.on('error', (err) => {
      if (!limitExceeded) {
        reject(new Error(`Failed to execute gh: ${err.message}`));
      }
    });

    child.on('close', async (code) => {
      if (limitExceeded) {
        return;
      }
      if (code !== 0) {
        // Smart fallback: If gh fails and GITHUB_TOKEN is set, retry using the native keychain auth.
        if (env.GITHUB_TOKEN) {
          const fallbackEnv = { ...env };
          delete fallbackEnv.GITHUB_TOKEN;
          try {
            const fallbackResult = await runGh(args, { ...options, envOverrides: { GITHUB_TOKEN: undefined } });
            resolve(fallbackResult);
            return;
          } catch (fallbackErr) {
            console.warn(`Fallback execution failed: ${fallbackErr.message}`);
          }
        }
        reject(new Error(`gh ${args.join(' ')} failed:\n${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Helper to extract owner and repo from a PR number
 */
export async function getRepoContext(prNumber) {
  const out = await runGh(['pr', 'view', String(prNumber), '--json', 'url'], {});
  const url = safeJsonParse(out, { url: '' }).url;
  // URL format: https://github.com/owner/repo/pull/123
  const parts = url.split('/');
  return { owner: parts[3], repo: parts[4] };
}

export async function exists(branch, owner, cwd = process.cwd()) {
  const head = owner ? `${owner}:${branch}` : branch;
  const out = await runGh(['pr', 'list', '--state', 'open', '--head', head, '--json', 'number'], { cwd });
  const prs = safeJsonParse(out, []);
  return prs.length > 0 ? prs[0].number : null;
}

export async function detectPrId(cwd = process.cwd()) {
  const branch = await gitBranchShowCurrent(cwd);
  if (branch) {
    console.log(`Autodetecting open PR for branch '${branch}'...`);
    const prId = await exists(branch, null, cwd);
    if (prId) {
      return prId;
    }
  }
  return null;
}

export async function create(prData, cwd = process.cwd()) {
  const { title, body, base = 'main', head } = prData;
  if (typeof title !== 'string' || typeof body !== 'string') {
    throw new TypeError('title and body must be strings');
  }
  const args = ['pr', 'create', '--draft', '--title', title, '--body', body];
  if (base) {
    args.push('--base', base);
  }
  if (head) {
    args.push('--head', head);
  }
  return await runGh(args, { cwd });
}

export async function update(prNumber, prData, cwd = process.cwd()) {
  const { title, body } = prData;
  const args = ['pr', 'edit', String(prNumber)];
  if (title) {
    args.push('--title', title);
  }
  if (body) {
    args.push('--body', body);
  }
  await runGh(args, { cwd });
}

export async function close(prNumber, cwd = process.cwd()) {
  await runGh(['pr', 'close', String(prNumber)], { cwd });
}

export async function comment(prNumber, body, cwd = process.cwd()) {
  await runGh(['pr', 'comment', String(prNumber), '--body', body], { cwd });
}

export async function getGeneralComments(prNumber, cwd = process.cwd()) {
  const out = await runGh(['pr', 'view', String(prNumber), '--json', 'comments'], { cwd });
  return safeJsonParse(out, { comments: [] }).comments;
}

export async function getReviewThreads(prNumber, cwd = process.cwd()) {
  const { owner, repo } = await getRepoContext(prNumber);
  const query = `
      query($owner: String!, $repo: String!, $pullNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 50) {
                  nodes {
                    id
                    databaseId
                    body
                    path
                    author { login }
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    `;
  const out = await runGh(
    [
      'api',
      'graphql',
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${repo}`,
      '-F',
      `pullNumber=${prNumber}`,
      '-f',
      `query=${query}`,
    ],
    { cwd },
  );
  const data = safeJsonParse(out, null);
  return data?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
}

globalThis.__prThreadMutexes = globalThis.__prThreadMutexes || new Map();
const threadMutexes = globalThis.__prThreadMutexes;

/**
 * Higher-order mutex and timeout synchronization wrapper.
 */
async function withMutex(lockKey, taskFn) {
  const lenKey = lockKey + ':len';
  const prior = threadMutexes.get(lockKey) || Promise.resolve();
  const currentLen = (threadMutexes.get(lenKey) || 0) + 1;
  threadMutexes.set(lenKey, currentLen);

  const nextPromise = prior.then(async () => {
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Timeout Error: Operation stalled'));
    }, 30000);
    timer.unref();

    try {
      return await taskFn(controller.signal);
    } catch (err) {
      console.log(`::error::PR Thread API Error: ${err.message}`);
      throw err;
    } finally {
      clearTimeout(timer);
      const newLen = (threadMutexes.get(lenKey) || 1) - 1;
      if (newLen <= 0) {
        threadMutexes.delete(lockKey);
        threadMutexes.delete(lenKey);
      } else {
        threadMutexes.set(lenKey, newLen);
      }
    }
  });

  threadMutexes.set(lockKey, nextPromise);
  return await nextPromise;
}

export async function replyToReviewComment(prNumber, commentId, body, cwd = process.cwd()) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw new TypeError('body must be a non-empty string');
  }

  const lockKey = 'comment:' + commentId;
  return await withMutex(lockKey, async (signal) => {
    const { owner, repo } = await getRepoContext(prNumber);
    await runGh(
      ['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`, '-X', 'POST', '-f', 'body=-'],
      { cwd, input: body, signal },
    );
  });
}

export async function resolveReviewThread(threadId, message = null, cwd = process.cwd()) {
  if (message !== null && message !== undefined) {
    if (typeof message !== 'string' || message.trim() === '') {
      throw new TypeError('message must be a non-empty string');
    }
  }

  const lockKey = 'thread:' + threadId;
  return await withMutex(lockKey, async (signal) => {
    if (message !== null && message !== undefined) {
      const mutation = `mutation($threadId: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: {pullRequestThreadId: $threadId, body: $body}) { clientMutationId }
        resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } }
      }`;
      await runGh(['api', 'graphql', '-F', `threadId=${threadId}`, '-f', 'body=-', '-f', `query=${mutation}`], {
        cwd,
        input: message,
        signal,
      });
    } else {
      const mutation = `mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }`;
      await runGh(['api', 'graphql', '-F', `threadId=${threadId}`, '-f', `query=${mutation}`], { cwd, signal });
    }
  });
}

export async function replyToReviewThread(threadId, body, cwd = process.cwd()) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw new TypeError('body must be a non-empty string');
  }

  const lockKey = 'thread:' + threadId;
  return await withMutex(lockKey, async (signal) => {
    const mutation = `mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestThreadId: $threadId, body: $body}) { clientMutationId } }`;
    await runGh(['api', 'graphql', '-F', `threadId=${threadId}`, '-f', 'body=-', '-f', `query=${mutation}`], {
      cwd,
      input: body,
      signal,
    });
  });
}

export async function view(target, fields = ['state', 'number', 'url', 'isDraft'], cwd = process.cwd()) {
  try {
    const out = await runGh(['pr', 'view', String(target), '--json', fields.join(',')], { cwd });
    return safeJsonParse(out);
  } catch (err) {
    if (err.message.includes('no pull requests found') || err.message.includes('could not find pull request')) {
      return null;
    }
    throw err;
  }
}

export async function ready(target, cwd = process.cwd()) {
  const args = ['pr', 'ready'];
  if (target) {
    args.push(String(target));
  }
  await runGh(args, { cwd });
}

export async function getDefaultBranch(cwd = process.cwd()) {
  return await runGh(['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { cwd });
}

export async function listUrl(branch, cwd = process.cwd()) {
  const out = await runGh(['pr', 'list', '--head', branch, '--json', 'url'], { cwd });
  const prs = safeJsonParse(out, []);
  return prs.length > 0 ? prs[0].url : null;
}

export async function setDefaultRepo(upstreamRepo, cwd = process.cwd()) {
  await runGh(['repo', 'set-default', upstreamRepo], { cwd });
}

export async function getAllComments(prNumber, cwd = process.cwd()) {
  const { owner, repo } = await getRepoContext(prNumber);
  const genOut = await runGh(['api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--paginate'], { cwd });
  const revOut = await runGh(['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments`, '--paginate'], { cwd });
  const gen = safeJsonParse(genOut || '[]', []).map((c) => ({ ...c, type: 'general' }));
  const rev = safeJsonParse(revOut || '[]', []).map((c) => ({ ...c, type: 'review' }));
  return [...gen, ...rev].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function formatComments(comments, format = 'markdown') {
  if (format === 'json') {
    return JSON.stringify(comments, null, 2);
  }
  if (comments.length === 0) {
    return 'No comments found.';
  }
  return comments
    .map((c) => {
      const icon = c.type === 'general' ? '💬' : '📝';
      const typeStr =
        c.type === 'general'
          ? 'General Comment'
          : `Inline Review on \`${c.path || 'unknown_file'}:${c.line || c.original_line || 'unknown'}\``;
      const date = c.created_at.replace('T', ' ').replace('Z', ' UTC');
      return `### ${icon} @${c.user.login} (${typeStr}) - ${date}\n\n${c.body}\n\n---`;
    })
    .join('\n');
}
