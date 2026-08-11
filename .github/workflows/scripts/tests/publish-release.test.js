import test from 'node:test';
import assert from 'node:assert';

test('publish-release.js tests', async (t) => {
  const { default: publishRelease } = await import('../publish-release.js');

  await t.test('publishes draft release when found', async () => {
    const updatedReleases = [];
    const core = {
      info: () => {},
      warning: () => {},
      setFailed: (msg) => { throw new Error(msg); }
    };
    const context = {
      repo: { owner: 'rancher', repo: 'terraform-provider-file' }
    };
    const localProcess = {
      env: {
        VERSION: 'v1.2.3'
      }
    };
    const github = {
      paginate: async (method, params) => {
        assert.strictEqual(method, github.rest.repos.listReleases);
        return [
          { tag_name: 'v1.2.3', id: 456, draft: true }
        ];
      },
      rest: {
        repos: {
          listReleases: () => {},
          updateRelease: async ({ owner, repo, release_id, draft, make_latest }) => {
            updatedReleases.push({ owner, repo, release_id, draft, make_latest });
            return {};
          }
        }
      }
    };

    await publishRelease({ github, context, core, process: localProcess });

    assert.strictEqual(updatedReleases.length, 1);
    assert.strictEqual(updatedReleases[0].release_id, 456);
    assert.strictEqual(updatedReleases[0].draft, false);
    assert.strictEqual(updatedReleases[0].make_latest, 'true');
  });

  await t.test('skips publishing if release is already published', async () => {
    const updatedReleases = [];
    const core = {
      info: () => {},
      warning: () => {},
      setFailed: (msg) => { throw new Error(msg); }
    };
    const context = {
      repo: { owner: 'rancher', repo: 'terraform-provider-file' }
    };
    const localProcess = {
      env: {
        VERSION: 'v1.2.3'
      }
    };
    const github = {
      paginate: async (method, params) => {
        assert.strictEqual(method, github.rest.repos.listReleases);
        return [
          { tag_name: 'v1.2.3', id: 456, draft: false }
        ];
      },
      rest: {
        repos: {
          listReleases: () => {},
          updateRelease: async (params) => {
            updatedReleases.push(params);
            return {};
          }
        }
      }
    };

    await publishRelease({ github, context, core, process: localProcess });

    assert.strictEqual(updatedReleases.length, 0);
  });

  await t.test('fails if release is not found after retries', async () => {
    let failedMsg = '';
    const core = {
      info: () => {},
      warning: () => {},
      setFailed: (msg) => { failedMsg = msg; }
    };
    const context = {
      repo: { owner: 'rancher', repo: 'terraform-provider-file' }
    };
    const localProcess = {
      env: {
        VERSION: 'v1.2.3'
      }
    };
    const github = {
      paginate: async (method, params) => {
        assert.strictEqual(method, github.rest.repos.listReleases);
        return []; // Never find it
      },
      rest: {
        repos: {
          listReleases: () => {}
        }
      }
    };

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay) => {
      // Execute immediately to skip test delay!
      callback();
    };

    try {
      await publishRelease({ github, context, core, process: localProcess });
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    assert.ok(failedMsg.includes('Could not find release for tag v1.2.3'));
  });
});
