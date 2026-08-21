import test from 'node:test';
import assert from 'node:assert';

test('get-target-pr.js tests', async (t) => {
  const { default: getTargetPR } = await import('../get-target-pr.js');

  const createBaseMocks = () => {
    const infoLogs = [];
    const warningLogs = [];
    const failedMessages = [];

    const core = {
      info: (msg) => infoLogs.push(msg),
      warning: (msg) => warningLogs.push(msg),
      setFailed: (msg) => failedMessages.push(msg),
    };

    const github = {
      rest: {
        actions: {
          getWorkflowRun: async () => {
            throw new Error('Not implemented');
          },
        },
        repos: {
          listPullRequestsAssociatedWithCommit: async () => {
            throw new Error('Not implemented');
          },
        },
        pulls: {
          list: async () => {
            throw new Error('Not implemented');
          },
          get: async () => {
            throw new Error('Not implemented');
          },
        },
        issues: {
          listComments: async () => {
            throw new Error('Not implemented');
          },
        },
      },
      paginate: async (method, params) => {
        const response = await method(params);
        return response.data || response;
      },
    };

    const context = {
      repo: {
        owner: 'rancher',
        repo: 'terraform-provider-file',
      },
      payload: {},
    };

    return { core, github, context, infoLogs, warningLogs, failedMessages };
  };

  await t.test('resolves prNumber from payload workflow_run pull_requests immediately', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      pull_requests: [{ number: 42 }],
    };

    mocks.github.rest.pulls.get = async ({ pull_number }) => {
      assert.strictEqual(pull_number, 42);
      return {
        data: {
          number: 42,
          user: { login: 'some-user' },
          head: { ref: 'some-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '/merge', author_association: 'MEMBER' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 42);
    assert.ok(mocks.infoLogs.includes('Identified target PR #42 from workflow_run payload.'));
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('resolves prNumber via API getWorkflowRun fallback', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
    };

    mocks.github.rest.actions.getWorkflowRun = async ({ run_id }) => {
      assert.strictEqual(run_id, 12345);
      return {
        data: {
          pull_requests: [{ number: 99 }],
        },
      };
    };

    mocks.github.rest.pulls.get = async ({ pull_number }) => {
      assert.strictEqual(pull_number, 99);
      return {
        data: {
          number: 99,
          user: { login: 'some-user' },
          head: { ref: 'some-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '  /merge  ', author_association: 'OWNER' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 99);
    assert.ok(mocks.infoLogs.includes('Identified target PR #99 via API fetch.'));
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('resolves prNumber via Associated Commit Lookup fallback', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'abcdef123456',
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async ({ commit_sha }) => {
      assert.strictEqual(commit_sha, 'abcdef123456');
      return {
        data: [
          {
            number: 101,
            state: 'open',
            base: {
              repo: {
                owner: { login: 'rancher' },
                name: 'terraform-provider-file',
              },
            },
          },
        ],
      };
    };

    mocks.github.rest.pulls.get = async () => {
      return {
        data: {
          number: 101,
          user: { login: 'some-user' },
          head: { ref: 'some-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '/merge', author_association: 'COLLABORATOR' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 101);
    assert.ok(mocks.infoLogs.includes('Identified target PR #101 via associated commit SHA: abcdef123456'));
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('fails to resolve prNumber via Associated Commit Lookup when PR is closed', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'abcdef123456',
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return {
        data: [
          {
            number: 101,
            state: 'closed',
            base: {
              repo: {
                owner: { login: 'rancher' },
                name: 'terraform-provider-file',
              },
            },
          },
        ],
      };
    };

    mocks.github.rest.pulls.list = async () => {
      return { data: [] };
    };

    await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.ok(mocks.failedMessages.includes('Could not determine target PR number from payload.'));
  });

  await t.test(
    'fails to resolve prNumber via Associated Commit Lookup when PR belongs to a different repository',
    async () => {
      const mocks = createBaseMocks();
      mocks.context.payload.workflow_run = {
        id: 12345,
        pull_requests: [],
        head_sha: 'abcdef123456',
      };

      mocks.github.rest.actions.getWorkflowRun = async () => {
        return { data: { pull_requests: [] } };
      };

      mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
        return {
          data: [
            {
              number: 101,
              state: 'open',
              base: {
                repo: {
                  owner: { login: 'other-owner' },
                  name: 'other-repo',
                },
              },
            },
          ],
        };
      };

      mocks.github.rest.pulls.list = async () => {
        return { data: [] };
      };

      await getTargetPR({
        github: mocks.github,
        context: mocks.context,
        core: mocks.core,
      });

      assert.ok(mocks.failedMessages.includes('Could not determine target PR number from payload.'));
    },
  );

  await t.test(
    'fails to resolve prNumber via Associated Commit Lookup when multiple open associated PRs match (ambiguous)',
    async () => {
      const mocks = createBaseMocks();
      mocks.context.payload.workflow_run = {
        id: 12345,
        pull_requests: [],
        head_sha: 'abcdef123456',
      };

      mocks.github.rest.actions.getWorkflowRun = async () => {
        return { data: { pull_requests: [] } };
      };

      mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
        return {
          data: [
            {
              number: 101,
              state: 'open',
              base: {
                repo: {
                  owner: { login: 'rancher' },
                  name: 'terraform-provider-file',
                },
              },
            },
            {
              number: 102,
              state: 'open',
              base: {
                repo: {
                  owner: { login: 'rancher' },
                  name: 'terraform-provider-file',
                },
              },
            },
          ],
        };
      };

      mocks.github.rest.pulls.list = async () => {
        return { data: [] };
      };

      await getTargetPR({
        github: mocks.github,
        context: mocks.context,
        core: mocks.core,
      });

      assert.ok(
        mocks.failedMessages.some((msg) =>
          msg.includes(
            'Ambiguous associated PR match: Found 2 open pull requests associated with commit SHA: abcdef123456.',
          ),
        ),
      );
    },
  );

  await t.test(
    'skips safely when Associated Commit Lookup returns a PR with deleted or inaccessible base repository',
    async () => {
      const mocks = createBaseMocks();
      mocks.context.payload.workflow_run = {
        id: 12345,
        pull_requests: [],
        head_sha: 'abcdef123456',
      };

      mocks.github.rest.actions.getWorkflowRun = async () => {
        return { data: { pull_requests: [] } };
      };

      mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
        return {
          data: [
            {
              number: 101,
              state: 'open',
              base: null, // deleted base repo
            },
            {
              number: 102,
              state: 'open',
              base: {
                repo: null, // missing repo object
              },
            },
            {
              number: 103,
              state: 'open',
              base: {
                repo: {
                  owner: null, // missing owner
                  name: 'terraform-provider-file',
                },
              },
            },
          ],
        };
      };

      mocks.github.rest.pulls.list = async () => {
        return { data: [] };
      };

      await getTargetPR({
        github: mocks.github,
        context: mocks.context,
        core: mocks.core,
      });

      assert.ok(mocks.failedMessages.includes('Could not determine target PR number from payload.'));
    },
  );

  await t.test('resolves prNumber by matching open PRs SHA fallback', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'sha-matched-open-pr',
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return {
        data: [
          { number: 202, head: { sha: 'sha-matched-open-pr' } },
          { number: 303, head: { sha: 'other-sha' } },
        ],
      };
    };

    mocks.github.rest.pulls.get = async () => {
      return {
        data: {
          number: 202,
          user: { login: 'some-user' },
          head: { ref: 'some-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '/merge', author_association: 'MEMBER' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 202);
    assert.ok(
      mocks.infoLogs.includes('Identified target PR #202 from open PRs list by matching head SHA or branch/owner.'),
    );
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('resolves prNumber by matching open PRs SHA and validating fork owner successfully', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'sha-matched-open-pr',
      head_repository: {
        owner: { login: 'trusted-owner' },
      },
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return {
        data: [
          {
            number: 202,
            head: {
              sha: 'sha-matched-open-pr',
              repo: { owner: { login: 'trusted-owner' } },
            },
          },
        ],
      };
    };

    mocks.github.rest.pulls.get = async () => {
      return {
        data: {
          number: 202,
          user: { login: 'some-user' },
          head: { ref: 'some-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '/merge', author_association: 'MEMBER' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 202);
    assert.ok(
      mocks.infoLogs.includes('Identified target PR #202 from open PRs list by matching head SHA or branch/owner.'),
    );
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('fails to resolve prNumber when open PRs SHA matches but fork owner is different', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'sha-matched-open-pr',
      head_repository: {
        owner: { login: 'trusted-owner' },
      },
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return {
        data: [
          {
            number: 202,
            head: {
              sha: 'sha-matched-open-pr',
              repo: { owner: { login: 'malicious-owner' } },
            },
          },
        ],
      };
    };

    await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.ok(mocks.failedMessages.includes('Could not determine target PR number from payload.'));
  });

  await t.test('resolves prNumber by matching open PRs branch and owner fallback', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'unmatched-sha',
      head_branch: 'feature-branch',
      head_repository: {
        owner: { login: 'fork-owner' },
      },
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return {
        data: [
          {
            number: 404,
            head: {
              sha: 'other-sha',
              ref: 'feature-branch',
              repo: { owner: { login: 'fork-owner' } },
            },
          },
          {
            number: 505,
            head: {
              sha: 'other-sha-2',
              ref: 'feature-branch',
              repo: { owner: { login: 'malicious-owner' } },
            },
          },
        ],
      };
    };

    mocks.github.rest.pulls.get = async () => {
      return {
        data: {
          number: 404,
          user: { login: 'some-user' },
          head: { ref: 'feature-branch' },
        },
      };
    };

    mocks.github.rest.issues.listComments = async () => {
      return [{ body: '/merge', author_association: 'MEMBER' }];
    };

    const result = await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.strictEqual(result, 404);
    assert.ok(
      mocks.infoLogs.includes('Identified target PR #404 from open PRs list by matching head SHA or branch/owner.'),
    );
    assert.strictEqual(mocks.failedMessages.length, 0);
  });

  await t.test('fails to resolve prNumber when open PR matches are ambiguous (multiple matches)', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
      head_sha: 'ambiguous-sha',
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return {
        data: [
          {
            number: 801,
            head: {
              sha: 'ambiguous-sha',
            },
          },
          {
            number: 802,
            head: {
              sha: 'ambiguous-sha',
            },
          },
        ],
      };
    };

    await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.ok(
      mocks.failedMessages.some((msg) =>
        msg.includes('Ambiguous PR match: Found 2 open pull requests matching head SHA or branch/owner.'),
      ),
    );
  });

  await t.test('fails when prNumber cannot be determined', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      id: 12345,
      pull_requests: [],
    };

    mocks.github.rest.actions.getWorkflowRun = async () => {
      return { data: { pull_requests: [] } };
    };

    mocks.github.rest.repos.listPullRequestsAssociatedWithCommit = async () => {
      return { data: [] };
    };

    mocks.github.rest.pulls.list = async () => {
      return { data: [] };
    };

    await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.ok(mocks.failedMessages.includes('Could not determine target PR number from payload.'));
  });

  await t.test('fails when PR is release-please bot', async () => {
    const mocks = createBaseMocks();
    mocks.context.payload.workflow_run = {
      pull_requests: [{ number: 500 }],
    };

    mocks.github.rest.pulls.get = async () => {
      return {
        data: {
          number: 500,
          user: { login: 'release-please[bot]' },
          head: { ref: 'release-please--branches--main' },
        },
      };
    };

    await getTargetPR({
      github: mocks.github,
      context: mocks.context,
      core: mocks.core,
    });

    assert.ok(
      mocks.failedMessages.includes(
        'Skipping execution: Release-please PR #500 is strictly exempt from automated merging.',
      ),
    );
  });
});
