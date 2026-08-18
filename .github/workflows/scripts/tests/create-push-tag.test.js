import test from 'node:test';
import assert from 'node:assert';

test('create-push-tag.js tests', async (t) => {
  const { default: createPushTag } = await import('../create-push-tag.js');

  await t.test('direct tag creation: tag does not exist, CREATE_REF is true', async () => {
    const outputs = {};
    const createdRefs = [];
    const core = {
      info: () => {},
      setOutput: (key, val) => {
        outputs[key] = val;
      },
      setFailed: (msg) => {
        throw new Error(msg);
      },
    };
    const context = {
      sha: 'abcdef1234567890',
      repo: { owner: 'rancher', repo: 'terraform-provider-file' },
    };
    const localProcess = {
      env: {
        TAG: 'v1.2.3',
        CREATE_REF: 'true',
      },
    };
    const github = {
      rest: {
        git: {
          getRef: async () => {
            // Simulate 404 Tag not found
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          },
          createRef: async ({ owner, repo, ref, sha }) => {
            createdRefs.push({ owner, repo, ref, sha });
            return {};
          },
        },
      },
    };

    await createPushTag({ github, context, core, process: localProcess });

    assert.strictEqual(outputs.tag, 'v1.2.3');
    assert.strictEqual(createdRefs.length, 1);
    assert.strictEqual(createdRefs[0].ref, 'refs/tags/v1.2.3');
    assert.strictEqual(createdRefs[0].sha, 'abcdef1234567890');
  });

  await t.test('direct tag creation: tag exists with matching SHA, proceeds gracefully', async () => {
    const outputs = {};
    const core = {
      info: () => {},
      setOutput: (key, val) => {
        outputs[key] = val;
      },
      setFailed: (msg) => {
        throw new Error(msg);
      },
    };
    const context = {
      sha: 'abcdef1234567890',
      repo: { owner: 'rancher', repo: 'terraform-provider-file' },
    };
    const localProcess = {
      env: {
        TAG: 'v1.2.3',
        CREATE_REF: 'true',
      },
    };
    const github = {
      rest: {
        git: {
          getRef: async ({ ref }) => {
            assert.strictEqual(ref, 'tags/v1.2.3');
            return {
              data: {
                object: {
                  type: 'commit',
                  sha: 'abcdef1234567890',
                },
              },
            };
          },
        },
      },
    };

    await createPushTag({ github, context, core, process: localProcess });

    assert.strictEqual(outputs.tag, 'v1.2.3');
  });

  await t.test('direct tag creation: tag exists with mismatch SHA, fails', async () => {
    let failedMsg = '';
    const core = {
      info: () => {},
      setOutput: () => {},
      setFailed: (msg) => {
        failedMsg = msg;
      },
    };
    const context = {
      sha: 'abcdef1234567890',
      repo: { owner: 'rancher', repo: 'terraform-provider-file' },
    };
    const localProcess = {
      env: {
        TAG: 'v1.2.3',
        CREATE_REF: 'true',
      },
    };
    const github = {
      rest: {
        git: {
          getRef: async () => {
            return {
              data: {
                object: {
                  type: 'commit',
                  sha: 'different_sha_here',
                },
              },
            };
          },
        },
      },
    };

    await createPushTag({ github, context, core, process: localProcess });

    assert.ok(failedMsg.includes('Mismatch!'));
  });

  await t.test('calculate RC tag: calculates next RC based on existing tags and creates it', async () => {
    const outputs = {};
    const createdRefs = [];
    const core = {
      info: () => {},
      setOutput: (key, val) => {
        outputs[key] = val;
      },
      setFailed: (msg) => {
        throw new Error(msg);
      },
    };
    const context = {
      sha: 'abcdef1234567890',
      repo: { owner: 'rancher', repo: 'terraform-provider-file' },
    };
    const localProcess = {
      env: {
        CALCULATE_NEXT_RC: 'true',
        TARGET_VERSION: 'v1.2.3',
        CREATE_REF: 'true',
      },
    };

    const tagsList = [{ name: 'v1.2.3-rc.0' }, { name: 'v1.2.3-rc.1' }, { name: 'v1.1.0' }];

    const github = {
      paginate: async (method, params) => {
        return tagsList;
      },
      rest: {
        repos: {
          listTags: () => {},
        },
        git: {
          getRef: async () => {
            // Calculated tag is v1.2.3-rc.2. It shouldn't exist, so getRef 404s.
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          },
          createRef: async ({ ref, sha }) => {
            createdRefs.push({ ref, sha });
            return {};
          },
        },
      },
    };

    await createPushTag({ github, context, core, process: localProcess });

    assert.strictEqual(outputs.rc_tag, 'v1.2.3-rc.2');
    assert.strictEqual(outputs.tag, 'v1.2.3-rc.2');
    assert.strictEqual(createdRefs.length, 1);
    assert.strictEqual(createdRefs[0].ref, 'refs/tags/v1.2.3-rc.2');
    assert.strictEqual(createdRefs[0].sha, 'abcdef1234567890');
  });
});
