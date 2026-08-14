/**
 * Script: get-open-prs.js
 * Description: Queries the GitHub REST API for open pull requests targeting main.
 *              Supports mapping specific PR numbers directly from parent workflow_run contexts,
 *              or falling back to filtering open active PRs that are either Dependabot or contain `/merge` comments.
 *              Strictly exempts release-please PRs from auto-merging under all circumstances.
 * Conforms to repository architectural standards and decoupling patterns.
 */

/**
 * Executes the get-open-prs script.
 * @param {object} context - The GitHub Actions context object.
 * @param {object} github - The pre-authenticated Octokit instance.
 * @param {object} core - The Actions Core library helper.
 * @returns {Promise<number[]>} - An array of open active PR numbers to process.
 */
export default async ({ github, context, core }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const warn = (msg) => (core.warning ? core.warning(msg) : core.info(`[WARNING] ${msg}`));

  // Helper to check if a PR is an automated release-please PR
  const isReleasePleasePr = (pr) => {
    const author = pr.user?.login;
    const branchRef = pr.head?.ref || '';
    return author === 'release-please[bot]' && branchRef.startsWith('release-please--');
  };

  // 1. Attempt specific PR mapping from triggering parent workflow run
  const parentRun = context.payload?.workflow_run;
  if (parentRun) {
    core.info(`Triggered by parent workflow run #${parentRun.id} (Event: "${parentRun.event}", Conclusion: "${parentRun.conclusion}")`);

    if (parentRun.conclusion !== 'success') {
      core.info('Parent run did not succeed. Aborting auto-merge executor.');
      return [];
    }

    let targetPrNumber = null;

    // Try parent run payload pull_requests metadata
    const prs = parentRun.pull_requests || [];
    if (prs.length > 0) {
      targetPrNumber = prs[0].number;
      core.info(`Identified target PR #${targetPrNumber} directly from parent run payload.`);
    } else {
      // Query Actions API to fetch complete workflow run details (may populate pull_requests)
      try {
        const { data: runDetail } = await github.rest.actions.getWorkflowRun({
          owner,
          repo,
          run_id: parentRun.id,
        });
        const runPrs = runDetail.pull_requests || [];
        if (runPrs.length > 0) {
          targetPrNumber = runPrs[0].number;
          core.info(`Identified target PR #${targetPrNumber} via getWorkflowRun API.`);
        }
      } catch (err) {
        warn(`Note: Failed to fetch parent workflow run details via actions API: ${err.message}`);
      }
    }

    if (targetPrNumber) {
      core.info(`Verifying PR #${targetPrNumber} details for release-please exemption...`);
      try {
        const { data: targetPr } = await github.rest.pulls.get({
          owner,
          repo,
          pull_number: targetPrNumber,
        });
        if (isReleasePleasePr(targetPr)) {
          core.info(`PR #${targetPrNumber} is an automated release-please PR. Exempt from auto-merging.`);
          return [];
        }
        core.info(`✅ PR #${targetPrNumber} is not a release-please PR. Returning as process candidate.`);
        return [targetPrNumber];
      } catch (err) {
        warn(`Error fetching PR #${targetPrNumber} details: ${err.message}. Aborting.`);
        return [];
      }
    }
  }

  // 2. Fallback: Scan all active open PRs targeting main
  core.info(`Scanning all open pull requests targeting main in ${owner}/${repo}...`);
  const prs = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    base: 'main',
  });

  core.info(`Retrieved ${prs.length} open pull request(s) from GitHub.`);

  const activePrs = [];
  for (const pr of prs) {
    if (pr.draft) {
      core.info(`PR #${pr.number} is a Draft; skipping.`);
      continue;
    }

    if (isReleasePleasePr(pr)) {
      core.info(`PR #${pr.number} is an automated release-please PR; exempt from auto-merging.`);
      continue;
    }

    const author = pr.user?.login;
    const isDependabot = author === 'dependabot[bot]';
    if (isDependabot) {
      core.info(`PR #${pr.number} is from Dependabot; adding to candidate list.`);
      activePrs.push(pr.number);
      continue;
    }

    // Check conversation history for /merge comment in human PRs
    core.info(`Checking conversation comments for human PR #${pr.number}...`);
    try {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pr.number,
      });

      const hasMergeComment = comments.some((c) => {
        const body = c.body || '';
        return body.trim() === '/merge';
      });

      if (hasMergeComment) {
        core.info(`✅ PR #${pr.number} has an active /merge comment; adding to candidate list.`);
        activePrs.push(pr.number);
      } else {
        core.info(`Skipping PR #${pr.number} (No /merge comment found).`);
      }
    } catch (err) {
      warn(`Error checking comments for PR #${pr.number}: ${err.message}. Skipping.`);
    }
  }

  core.info(`Filtered active open PRs to process: ${JSON.stringify(activePrs)}`);
  return activePrs;
};
