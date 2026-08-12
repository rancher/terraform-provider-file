import test from 'node:test';
import assert from 'node:assert';
import getOpenPrs from '../get-open-prs.js';

test('get-open-prs.js tests', async (t) => {
  await t.test('correctly list and filters open pull requests', async () => {
    const mockPrs = [
      {
        number: 101,
        draft: false,
        user: { login: 'some-developer' },
        head: { ref: 'feature/some-feature' }
      },
      {
        number: 102,
        draft: true,
        user: { login: 'some-developer' },
        head: { ref: 'feature/draft-feature' }
      },
      {
        number: 103,
        draft: false,
        user: { login: 'release-please[bot]' },
        head: { ref: 'release-please--branches--main' }
      },
      {
        number: 104,
        draft: false,
        user: { login: 'some-developer' },
        head: { ref: 'release-please--branches--main' } // Human author on release branch (Should include!)
      },
      {
        number: 105,
        draft: false,
        user: { login: 'release-please[bot]' },
        head: { ref: 'feature/not-release-branch' } // Release please bot on different branch (Should include!)
      }
    ];

    const context = {
      repo: {
        owner: 'rancher',
        repo: 'terraform-provider-file'
      }
    };

    const github = {
      paginate: async (method, params) => {
        assert.strictEqual(method, github.rest.pulls.list);
        assert.strictEqual(params.owner, 'rancher');
        assert.strictEqual(params.repo, 'terraform-provider-file');
        assert.strictEqual(params.state, 'open');
        assert.strictEqual(params.base, 'main');
        return mockPrs;
      },
      rest: {
        pulls: {
          list: {}
        }
      }
    };

    const core = {
      info: () => {}
    };

    const result = await getOpenPrs({ github, context, core });

    // Assert that:
    // - PR 101 is included (regular active PR)
    // - PR 102 is skipped (Draft)
    // - PR 103 is skipped (Both signals match: release-please bot AND release-please-- branch)
    // - PR 104 is included (Only branch matches, author is human - safe!)
    // - PR 105 is included (Only author matches, branch is regular - safe!)
    assert.deepStrictEqual(result, [101, 104, 105]);
  });
});
