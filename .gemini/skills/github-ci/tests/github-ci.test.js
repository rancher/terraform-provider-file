import assert from 'node:assert';
import test from 'node:test';
import { getFailedLog } from '../scripts/get_failed_log.js';
import { listRuns } from '../scripts/list_runs.js';
import { searchLogs } from '../scripts/search_logs.js';

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
