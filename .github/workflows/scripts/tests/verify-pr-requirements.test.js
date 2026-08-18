import test from 'node:test';
import assert from 'node:assert';

test('verify-pr-requirements.mjs tests', async (t) => {
  const { default: verifyPR } = await import('../verify-pr-requirements.mjs');

  // Standard PR metadata helper
  const createMockContext = (prNumber = 400) => ({
    repo: { owner: 'rancher', repo: 'terraform-provider-file' },
    issue: { number: prNumber },
    payload: { pull_request: { number: prNumber } },
  });

  const createMockProcess = (prNumber = 400) => ({
    env: { PR_NUMBER: prNumber.toString() },
  });

  await t.test('Standard PR with human-only approval fails (missing AI review)', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 400,
              draft: false,
              user: { login: 'human-author' },
              head: { sha: 'sha123' },
            },
          }),
          listCommits: () => {},
          listReviews: () => {},
        },
        checks: {
          listForRef: async () => ({
            data: {
              check_runs: [
                {
                  name: 'CI Suite',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
          }),
        },
        repos: {
          getCollaboratorPermissionLevel: async () => ({
            data: { permission: 'write' },
          }),
        },
        issues: {
          listComments: {},
        },
      },
      paginate: async (apiFn) => {
        if (apiFn === mockGithub.rest.pulls.listCommits) {
          // Mock commits: all GPG verified
          return [
            {
              sha: 'sha123',
              commit: {
                message: 'feat: clean code',
                verification: { verified: true },
              },
            },
          ];
        }
        // Mock reviews: 1 trusted human approval, 0 AI reviews
        return [
          {
            state: 'APPROVED',
            author_association: 'COLLABORATOR',
            user: { login: 'trusted-human', type: 'User' },
          },
        ];
      },
      graphql: async () => ({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  comments: {
                    nodes: [{ body: 'looks good', author: { login: 'reviewer' } }],
                  },
                },
              ],
            },
          },
        },
      }),
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(400),
      core,
      process: createMockProcess(400),
    });

    assert.ok(failedReason.includes('requires at least **1 AI review**'));
  });

  await t.test('Standard PR with human and AI approvals succeeds', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 400,
              draft: false,
              user: { login: 'human-author' },
              head: { sha: 'sha123' },
            },
          }),
          listCommits: () => {},
          listReviews: () => {},
        },
        checks: {
          listForRef: async () => ({
            data: {
              check_runs: [
                {
                  name: 'CI Suite',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
          }),
        },
        repos: {
          getCollaboratorPermissionLevel: async () => ({
            data: { permission: 'write' },
          }),
        },
      },
      paginate: async (apiFn) => {
        if (apiFn === mockGithub.rest.pulls.listCommits) {
          return [
            {
              sha: 'sha123',
              commit: {
                message: 'feat: clean code',
                verification: { verified: true },
              },
            },
          ];
        }
        // Mock reviews: 1 trusted human approval, 1 Copilot review approval
        return [
          {
            state: 'APPROVED',
            author_association: 'COLLABORATOR',
            user: { login: 'trusted-human', type: 'User' },
          },
          {
            state: 'APPROVED',
            author_association: 'NONE',
            user: { login: 'copilot', type: 'Bot' },
          },
        ];
      },
      graphql: async () => ({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [],
            },
          },
        },
      }),
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(400),
      core,
      process: createMockProcess(400),
    });

    assert.strictEqual(failedReason, '');
    assert.ok(coreLogs.includes('PR #400 meets all verification requirements and is ready to merge!'));
  });

  await t.test('Standard PR with human approval and AI review via conversation comment succeeds', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 400,
              draft: false,
              user: { login: 'human-author' },
              head: { sha: 'sha123' },
            },
          }),
          listCommits: () => {},
          listReviews: () => {},
        },
        checks: {
          listForRef: async () => ({
            data: {
              check_runs: [
                {
                  name: 'CI Suite',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
          }),
        },
        repos: {
          getCollaboratorPermissionLevel: async () => ({
            data: { permission: 'write' },
          }),
        },
        issues: {
          listComments: {},
        },
      },
      paginate: async (apiFn) => {
        if (apiFn === mockGithub.rest.pulls.listCommits) {
          return [
            {
              sha: 'sha123',
              commit: {
                message: 'feat: clean code',
                verification: { verified: true },
              },
            },
          ];
        }
        if (apiFn === mockGithub.rest.pulls.listReviews) {
          // Return only 1 human approval, no official AI review
          return [
            {
              state: 'APPROVED',
              author_association: 'COLLABORATOR',
              user: { login: 'trusted-human', type: 'User' },
            },
          ];
        }
        if (apiFn === mockGithub.rest.issues.listComments) {
          // Return Copilot pass comment
          return [
            {
              body: 'PR Review completed and generated no new comments.',
              user: { login: 'copilot-reviewer', type: 'Bot' },
            },
          ];
        }
        return [];
      },
      graphql: async () => ({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [],
            },
          },
        },
      }),
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(400),
      core,
      process: createMockProcess(400),
    });

    assert.strictEqual(failedReason, '');
    assert.ok(coreLogs.includes('PR #400 meets all verification requirements and is ready to merge!'));
  });

  await t.test('Dependabot PR succeeds with AI-only approval, bypassing human requirement', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 401,
              draft: false,
              user: { login: 'dependabot[bot]' },
              head: { sha: 'sha123' },
            },
          }),
          listCommits: () => {},
          listReviews: () => {},
        },
        checks: {
          listForRef: async () => ({
            data: {
              check_runs: [
                {
                  name: 'CI Suite',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
          }),
        },
      },
      paginate: async (apiFn) => {
        if (apiFn === mockGithub.rest.pulls.listCommits) {
          return [
            {
              sha: 'sha123',
              commit: {
                message: 'bump: dependency',
                verification: { verified: true },
              },
            },
          ];
        }
        if (apiFn === mockGithub.rest.pulls.listReviews) {
          // Return 1 AI review approval, 0 human approvals
          return [
            {
              state: 'APPROVED',
              author_association: 'NONE',
              user: { login: 'copilot', type: 'Bot' },
            },
          ];
        }
        return [];
      },
      graphql: async () => ({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [],
            },
          },
        },
      }),
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(401),
      core,
      process: createMockProcess(401),
    });

    assert.strictEqual(failedReason, '');
    assert.ok(coreLogs.includes('PR #401 meets all verification requirements and is ready to merge!'));
  });

  await t.test('Dependabot PR fails without AI approval', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 401,
              draft: false,
              user: { login: 'dependabot[bot]' },
              head: { sha: 'sha123' },
            },
          }),
          listCommits: () => {},
          listReviews: () => {},
        },
        checks: {
          listForRef: async () => ({
            data: {
              check_runs: [
                {
                  name: 'CI Suite',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
          }),
        },
      },
      paginate: async (apiFn) => {
        if (apiFn === mockGithub.rest.pulls.listCommits) {
          return [
            {
              sha: 'sha123',
              commit: {
                message: 'bump: dependency',
                verification: { verified: true },
              },
            },
          ];
        }
        // Mock reviews: empty
        return [];
      },
      graphql: async () => ({
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [],
            },
          },
        },
      }),
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(401),
      core,
      process: createMockProcess(401),
    });

    assert.ok(failedReason.includes('requires at least **1 AI review**'));
  });

  await t.test('Release-please PR fails auto-merge verification', async () => {
    const coreLogs = [];
    let failedReason = '';
    const core = {
      info: (msg) => coreLogs.push(msg),
      warning: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedReason = msg;
      },
    };

    const mockGithub = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              number: 402,
              draft: false,
              user: { login: 'release-please[bot]' },
              head: { sha: 'sha123', ref: 'release-please--branches--main' },
            },
          }),
        },
      },
    };

    await verifyPR({
      github: mockGithub,
      context: createMockContext(402),
      core,
      process: createMockProcess(402),
    });

    assert.ok(failedReason.includes('Release-please PRs are strictly exempt'));
  });
});
