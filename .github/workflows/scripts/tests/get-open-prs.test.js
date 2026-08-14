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
        head: { ref: 'feature/some-feature' },
      },
      {
        number: 102,
        draft: true,
        user: { login: 'some-developer' },
        head: { ref: 'feature/draft-feature' },
      },
      {
        number: 103,
        draft: false,
        user: { login: 'release-please[bot]' },
        head: { ref: 'release-please--branches--main' },
      },
      {
        number: 104,
        draft: false,
        user: { login: 'some-developer' },
        head: { ref: 'release-please--branches--main' }, // Human author on release branch (Should include if /merge is present!)
      },
      {
        number: 105,
        draft: false,
        user: { login: 'release-please[bot]' },
        head: { ref: 'feature/not-release-branch' }, // Release please bot on different branch (Should include if /merge is present!)
      },
      {
        number: 106,
        draft: false,
        user: { login: 'some-developer' },
        head: { ref: 'feature/missing-merge' }, // No /merge comment (Should be skipped!)
      },
      {
        number: 107,
        draft: false,
        user: { login: 'dependabot[bot]' },
        head: { ref: 'bump-dep' }, // Dependabot PR (Should include automatically without /merge!)
      },
    ];

    const context = {
      repo: {
        owner: 'rancher',
        repo: 'terraform-provider-file',
      },
      payload: {},
    };

    const github = {
      paginate: async (method, params) => {
        if (method === github.rest.pulls.list) {
          assert.strictEqual(params.owner, 'rancher');
          assert.strictEqual(params.repo, 'terraform-provider-file');
          assert.strictEqual(params.state, 'open');
          assert.strictEqual(params.base, 'main');
          return mockPrs;
        }
        if (method === github.rest.issues.listComments) {
          assert.strictEqual(params.owner, 'rancher');
          assert.strictEqual(params.repo, 'terraform-provider-file');
          const issueNum = params.issue_number;
          if (issueNum === 101 || issueNum === 104 || issueNum === 105) {
            return [{ body: '/merge' }];
          }
          return []; // empty for missing
        }
        throw new Error(`Unexpected paginate method: ${method}`);
      },
      rest: {
        pulls: {
          list: {},
        },
        issues: {
          listComments: {},
        },
      },
    };

    const core = {
      info: () => {},
      warning: () => {},
    };

    const result = await getOpenPrs({ github, context, core });

    // Assert that:
    // - PR 101 is included (regular active PR with /merge)
    // - PR 102 is skipped (Draft)
    // - PR 103 is skipped (Both signals match: release-please bot AND release-please-- branch)
    // - PR 104 is included (Human author on release branch with /merge)
    // - PR 105 is included (Release please bot on regular branch with /merge)
    // - PR 106 is skipped (Missing /merge comment)
    // - PR 107 is included (Dependabot PR)
    assert.deepStrictEqual(result, [101, 104, 105, 107]);
  });
});
