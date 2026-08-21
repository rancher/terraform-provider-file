// handle-verification-failure.js - Deletes or updates auto-merge status warning comments on failure.
// Conforms to github-script.instructions.md guidelines.

const COMMENT_SIGNATURE = '<!-- auto-merge-verification-signature -->';

async function withRetry(core, fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) {
        throw err;
      }
      core.warning(`API call failed (Attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export default async ({ github, context, core, process }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const prNumber = process.env.PR_NUMBER;
  if (!prNumber) {
    throw new Error('PR_NUMBER environment variable is required.');
  }

  const reasons = process.env.REASONS || 'Unknown verification reasons.';
  const ciPending = process.env.CI_PENDING === 'true';

  core.info(`Handling requirements validation failure for PR #${prNumber} (ciPending: ${ciPending})`);

  // Fetch PR to check current labels
  const { data: pr } = await withRetry(core, () =>
    github.rest.pulls.get({
      owner,
      repo,
      pull_number: parseInt(prNumber, 10),
    }),
  );

  const hasReadyLabel = pr.labels.some((l) => l.name === 'ready-to-merge');

  // 1. Remove label if requirements aren't met
  if (hasReadyLabel) {
    core.info(`PR #${prNumber} requirements are not met. Removing "ready-to-merge" label.`);
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: parseInt(prNumber, 10),
        name: 'ready-to-merge',
      });
    } catch (error) {
      core.warning(`Could not remove "ready-to-merge" label: ${error.message}`);
    }
  }

  // 2. Post status comment
  const commentBody = `### 🤖 Auto-Merge Status

Thank you for your contribution! The auto-merge job ran, but this PR cannot be merged yet because the following requirements are missing:

${reasons}

*Please resolve these items so that the job can automatically merge your PR.*`;

  await updateOrPostComment({ github, core, owner, repo, prNumber: parseInt(prNumber, 10), message: commentBody });
};

async function updateOrPostComment({ github, core, owner, repo, prNumber, message }) {
  const comments = await withRetry(core, () =>
    github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
    }),
  );

  const botComment = comments.find((c) => c.body && c.body.includes(COMMENT_SIGNATURE));
  const fullBody = `${message}\n\n${COMMENT_SIGNATURE}`;

  if (botComment) {
    if (botComment.body !== fullBody) {
      core.info(`Updating existing status comment on PR #${prNumber}`);
      await withRetry(core, () =>
        github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: botComment.id,
          body: fullBody,
        }),
      );
    } else {
      core.info(`Status comment on PR #${prNumber} is already up to date`);
    }
  } else {
    core.info(`Posting new status comment on PR #${prNumber}`);
    await withRetry(core, () =>
      github.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: fullBody,
      }),
    );
  }
}
