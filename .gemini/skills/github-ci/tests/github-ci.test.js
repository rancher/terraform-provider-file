import assert from 'node:assert';
import path from 'node:path';
import test from 'node:test';
import { getRepoDetails } from '../scripts/auth.js';
import { downloadLogs } from '../scripts/download_logs.js';
import { findFailedRuns } from '../scripts/find_failed_runs.js';
import { getFailedLog } from '../scripts/get_failed_log.js';
import { listRuns } from '../scripts/list_runs.js';
import { searchLogs } from '../scripts/search_logs.js';

test('github-ci skill - getRepoDetails unit tests', async (t) => {
  await t.test('resolves owner and repo from GH_REPO env variable', async () => {
    const originalGhRepo = process.env.GH_REPO;
    try {
      process.env.GH_REPO = 'ci-org/ci-repo';
      const details = await getRepoDetails();
      assert.deepStrictEqual(details, { owner: 'ci-org', repo: 'ci-repo' });
    } finally {
      if (originalGhRepo !== undefined) {
        process.env.GH_REPO = originalGhRepo;
      } else {
        delete process.env.GH_REPO;
      }
    }
  });

  await t.test('resolves owner and repo from GITHUB_REPOSITORY env variable', async () => {
    const originalGhRepo = process.env.GH_REPO;
    const originalGithubRepo = process.env.GITHUB_REPOSITORY;
    try {
      delete process.env.GH_REPO;
      process.env.GITHUB_REPOSITORY = 'ci-upstream/ci-repo';
      const details = await getRepoDetails();
      assert.deepStrictEqual(details, { owner: 'ci-upstream', repo: 'ci-repo' });
    } finally {
      if (originalGhRepo !== undefined) {
        process.env.GH_REPO = originalGhRepo;
      } else {
        delete process.env.GH_REPO;
      }
      if (originalGithubRepo !== undefined) {
        process.env.GITHUB_REPOSITORY = originalGithubRepo;
      } else {
        delete process.env.GITHUB_REPOSITORY;
      }
    }
  });
});

test('github-ci skill - listRuns unit tests', async (t) => {
  await t.test('calls octokit.rest.actions.listWorkflowRunsForRepo with options', async () => {
    let captured = null;
    const mockOctokit = {
      rest: {
        actions: {
          listWorkflowRunsForRepo: async (params) => {
            captured = params;
            return {
              data: {
                workflow_runs: [
                  { id: 101, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main' },
                ],
              },
            };
          },
        },
      },
    };

    const runs = await listRuns({
      octokit: mockOctokit,
      owner: 'rancher',
      repo: 'terraform-provider-file',
      branch: 'feature/test',
      limit: 5,
      status: 'failure',
    });

    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].id, 101);
    assert.deepStrictEqual(captured, {
      owner: 'rancher',
      repo: 'terraform-provider-file',
      branch: 'feature/test',
      per_page: 5,
      status: 'failure',
    });
  });
});

test('github-ci skill - getFailedLog unit tests', async (t) => {
  await t.test('isolates failed jobs and extracts failure lines', async () => {
    const mockOctokit = {
      rest: {
        actions: {
          getWorkflowRun: async () => ({
            data: { id: 200, name: 'Integration', status: 'completed', conclusion: 'failure' },
          }),
          listJobsForWorkflowRun: async () => ({
            data: {
              jobs: [
                { id: 301, name: 'Lint', conclusion: 'success' },
                { id: 302, name: 'Test', conclusion: 'failure' },
              ],
            },
          }),
          downloadJobLogsForWorkflowRun: async ({ job_id }) => {
            if (job_id === 302) {
              return {
                data: 'Setting up Go\nRunning tests\nError: TestLocalDirectory failed with exit status 1\nDone',
              };
            }
            return { data: 'All good' };
          },
        },
      },
    };

    const { run, failedJobs } = await getFailedLog({
      octokit: mockOctokit,
      owner: 'rancher',
      repo: 'terraform-provider-file',
      runId: 200,
    });

    assert.strictEqual(run.id, 200);
    assert.strictEqual(failedJobs.length, 1);
    assert.strictEqual(failedJobs[0].job.name, 'Test');
    assert.strictEqual(failedJobs[0].errorLines.length, 1);
    assert.match(failedJobs[0].errorLines[0], /Error: TestLocalDirectory failed with exit status 1/);
  });

  await t.test('uses octokit.paginate to retrieve all jobs across pages', async () => {
    let paginateCalled = false;
    const mockOctokit = {
      paginate: async (method, params) => {
        paginateCalled = true;
        assert.strictEqual(params.run_id, 201);
        assert.strictEqual(params.per_page, 100);
        return [
          { id: 401, name: 'Job 1', conclusion: 'success' },
          { id: 402, name: 'Job 2', conclusion: 'failure' },
        ];
      },
      rest: {
        actions: {
          getWorkflowRun: async () => ({
            data: { id: 201, name: 'Paginated Run', status: 'completed', conclusion: 'failure' },
          }),
          downloadJobLogsForWorkflowRun: async () => ({ data: 'Error: Job failed' }),
        },
      },
    };

    const { failedJobs } = await getFailedLog({
      octokit: mockOctokit,
      owner: 'rancher',
      repo: 'terraform-provider-file',
      runId: 201,
    });

    assert.strictEqual(paginateCalled, true);
    assert.strictEqual(failedJobs.length, 1);
    assert.strictEqual(failedJobs[0].job.id, 402);
  });

  await t.test('preserves job.steps containing failed steps in failedJobs output', async () => {
    const mockOctokit = {
      rest: {
        actions: {
          getWorkflowRun: async () => ({
            data: { id: 202, name: 'Step Run', status: 'completed', conclusion: 'failure' },
          }),
          listJobsForWorkflowRun: async () => ({
            data: {
              jobs: [
                {
                  id: 403,
                  name: 'Build and Test',
                  conclusion: 'failure',
                  steps: [
                    { number: 1, name: 'Setup', status: 'completed', conclusion: 'success' },
                    { number: 2, name: 'Run test suite', status: 'completed', conclusion: 'failure' },
                  ],
                },
              ],
            },
          }),
          downloadJobLogsForWorkflowRun: async () => ({
            data: 'Error: test suite failed with status 1',
          }),
        },
      },
    };

    const { failedJobs } = await getFailedLog({
      octokit: mockOctokit,
      owner: 'rancher',
      repo: 'terraform-provider-file',
      runId: 202,
    });

    assert.strictEqual(failedJobs.length, 1);
    assert.strictEqual(failedJobs[0].job.steps.length, 2);
    const failedStep = failedJobs[0].job.steps.find((s) => s.conclusion === 'failure');
    assert.strictEqual(failedStep.name, 'Run test suite');
    assert.strictEqual(failedStep.number, 2);
  });
});

test('github-ci skill - downloadLogs unit tests', async (t) => {
  await t.test('uses octokit.paginate and downloads logs for all jobs', async () => {
    let paginateCalled = false;
    const mockOctokit = {
      paginate: async () => {
        paginateCalled = true;
        return [
          { id: 501, name: 'Job A' },
          { id: 502, name: 'Job B' },
        ];
      },
      rest: {
        actions: {
          downloadJobLogsForWorkflowRun: async () => ({ data: 'Sample log content' }),
        },
      },
    };

    const tempDir = path.join('/tmp', `test-ci-logs-${Date.now()}`);
    try {
      const result = await downloadLogs({
        octokit: mockOctokit,
        owner: 'rancher',
        repo: 'terraform-provider-file',
        runId: 999,
        outputDir: tempDir,
      });

      assert.strictEqual(paginateCalled, true);
      assert.strictEqual(result.jobsCount, 2);
    } finally {
      await (await import('node:fs/promises')).rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('github-ci skill - searchLogs unit tests', async (t) => {
  await t.test('searches directory and matches patterns', async () => {
    // Search the .gemini directory for 'name:'
    const results = await searchLogs({
      logsDir: '.gemini/skills/github-ci',
      pattern: /name:\s*github-ci/,
    });

    assert.ok(results.length >= 1);
    assert.match(results[0].text, /name:\s*github-ci/);
  });
});

test('github-ci skill - findFailedRuns unit tests', async (t) => {
  await t.test(
    'queries completed runs and filters by failure, timed_out, and startup_failure conclusions',
    async () => {
      let captured = null;
      const mockOctokit = {
        rest: {
          actions: {
            listWorkflowRunsForRepo: async (params) => {
              captured = params;
              return {
                data: {
                  workflow_runs: [
                    { id: 1, name: 'Run 1', status: 'completed', conclusion: 'success' },
                    { id: 2, name: 'Run 2', status: 'completed', conclusion: 'failure' },
                    { id: 3, name: 'Run 3', status: 'completed', conclusion: 'timed_out' },
                    { id: 4, name: 'Run 4', status: 'completed', conclusion: 'startup_failure' },
                    { id: 5, name: 'Run 5', status: 'completed', conclusion: 'cancelled' },
                  ],
                },
              };
            },
          },
        },
      };

      const failed = await findFailedRuns({
        octokit: mockOctokit,
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        limit: 10,
      });

      assert.strictEqual(failed.length, 3);
      assert.strictEqual(failed[0].id, 2);
      assert.strictEqual(failed[1].id, 3);
      assert.strictEqual(failed[2].id, 4);
      assert.strictEqual(captured.status, 'completed');
      assert.strictEqual(captured.branch, 'main');
    },
  );
});

test('github-ci skill - timed_out jobs and stateless searchLogs', async (t) => {
  await t.test('getFailedLog captures timed_out jobs and decodes Buffer data', async () => {
    const mockOctokit = {
      rest: {
        actions: {
          getWorkflowRun: async () => ({
            data: { id: 700, name: 'Timeout Run', status: 'completed', conclusion: 'failure' },
          }),
          listJobsForWorkflowRun: async () => ({
            data: {
              jobs: [
                { id: 801, name: 'Build', conclusion: 'timed_out' },
                { id: 802, name: 'Lint', conclusion: 'startup_failure' },
              ],
            },
          }),
          downloadJobLogsForWorkflowRun: async ({ job_id }) => {
            if (job_id === 801) {
              return { data: Buffer.from('Job execution timed out after 360m\nError: timed out') };
            }
            return { data: 'Fatal: container failed to initialize' };
          },
        },
      },
    };

    const { failedJobs } = await getFailedLog({
      octokit: mockOctokit,
      owner: 'rancher',
      repo: 'terraform-provider-file',
      runId: 700,
    });

    assert.strictEqual(failedJobs.length, 2);
    assert.strictEqual(failedJobs[0].job.name, 'Build');
    assert.ok(failedJobs[0].errorLines.some((l) => l.includes('timed out')));
    assert.strictEqual(failedJobs[1].job.name, 'Lint');
    assert.ok(failedJobs[1].errorLines.some((l) => l.includes('Fatal: container failed')));
  });

  await t.test('searchLogs parses string /pattern/flags format', async () => {
    const results = await searchLogs({
      logsDir: '.gemini/skills/github-ci',
      pattern: '/name:\\s*github-ci/i',
    });

    assert.ok(results.length >= 1);
    assert.match(results[0].text, /name:\s*github-ci/i);
  });
});
