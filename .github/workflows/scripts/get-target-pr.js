export default async ({ github, context, core }) => {
  let prNumber;
  const parentRun = context.payload.workflow_run;

  if (parentRun && parentRun.pull_requests && parentRun.pull_requests.length > 0) {
    prNumber = parentRun.pull_requests[0].number;
    core.info(`Identified target PR #${prNumber} from workflow_run payload.`);
  } else if (parentRun) {
    try {
      const { data: runDetail } = await github.rest.actions.getWorkflowRun({
        owner: context.repo.owner,
        repo: context.repo.repo,
        run_id: parentRun.id,
      });
      if (runDetail.pull_requests && runDetail.pull_requests.length > 0) {
        prNumber = runDetail.pull_requests[0].number;
        core.info(`Identified target PR #${prNumber} via API fetch.`);
      }
    } catch (err) {
      core.warning(`Failed to fetch workflow run details: ${err.message}`);
    }

    // Fallback 1: Query open pull requests associated with the head commit SHA
    if (!prNumber && parentRun.head_sha) {
      try {
        const { data: associatedPRs } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: context.repo.owner,
          repo: context.repo.repo,
          commit_sha: parentRun.head_sha,
        });

        const matchedPR = associatedPRs.find(
          (p) =>
            p.state === 'open' &&
            p.base.repo.owner.login === context.repo.owner &&
            p.base.repo.name === context.repo.repo,
        );

        if (matchedPR) {
          prNumber = matchedPR.number;
          core.info(`Identified target PR #${prNumber} via associated commit SHA: ${parentRun.head_sha}`);
        }
      } catch (err) {
        core.warning(`Failed to fetch associated PRs by commit SHA: ${err.message}`);
      }
    }

    // Fallback 2: Search all open pull requests for matching head branch and repository owner, or head SHA
    if (!prNumber) {
      try {
        const openPRs = await github.paginate(github.rest.pulls.list, {
          owner: context.repo.owner,
          repo: context.repo.repo,
          state: 'open',
        });

        const headOwner = parentRun.head_repository?.owner?.login;
        const matchedPR = openPRs.find(
          (p) =>
            (p.head.sha === parentRun.head_sha && (!headOwner || p.head.repo?.owner?.login === headOwner)) ||
            (parentRun.head_branch &&
              p.head.ref === parentRun.head_branch &&
              headOwner &&
              p.head.repo?.owner?.login === headOwner),
        );

        if (matchedPR) {
          prNumber = matchedPR.number;
          core.info(`Identified target PR #${prNumber} from open PRs list by matching head SHA or branch/owner.`);
        }
      } catch (err) {
        core.warning(`Failed to search open pull requests: ${err.message}`);
      }
    }
  }

  if (!prNumber) {
    core.setFailed('Could not determine target PR number from payload.');
    return;
  }

  // Fetch PR details
  const { data: pr } = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
  });

  // Explicitly fail Release-please PRs to avoid GHA waste
  const isReleasePlease = pr.user?.login === 'release-please[bot]' && pr.head?.ref?.startsWith('release-please--');
  if (isReleasePlease) {
    core.setFailed(`Skipping execution: Release-please PR #${prNumber} is strictly exempt from automated merging.`);
    return;
  }

  const isDependabot = pr.user?.login === 'dependabot[bot]';
  if (!isDependabot) {
    // Check comments for /merge
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
    });
    const hasMergeComment = comments.some((c) => {
      const isMerge = (c.body || '').trim() === '/merge';
      const assoc = c.author_association;
      const isTrusted = assoc === 'OWNER' || assoc === 'MEMBER' || assoc === 'COLLABORATOR';
      return isMerge && isTrusted;
    });
    if (!hasMergeComment) {
      core.setFailed(
        `Skipping execution: Human PR #${prNumber} does not have an authorized /merge comment from a trusted repository member.`,
      );
      return;
    }
  }

  return prNumber;
};
