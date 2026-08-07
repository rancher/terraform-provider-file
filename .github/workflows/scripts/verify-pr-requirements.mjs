import { execSync } from 'child_process';
import fs from 'fs';

const COMMENT_SIGNATURE = '<!-- scheduled-pr-verification-signature -->';

export default async ({ github, context, core, process }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const isAutoMerge = process.env.AUTO_MERGE === 'true';

  try {
    if (!isAutoMerge) {
      // Running inside pull_request.yaml (single PR context)
      const prNumber = context.payload.pull_request?.number || context.issue.number;
      if (!prNumber) {
        throw new Error('Could not determine pull request number from context');
      }

      core.info(`Running verification for PR #${prNumber} (Dry-Run / Contributor Feedback mode)`);
      const { data: pr } = await withRetry(core, () => github.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      }));

      if (pr.draft) {
        core.setFailed(`PR #${prNumber} is currently in draft mode. Verification cannot proceed until the PR is marked as ready for review.`);
        return;
      }

      const { success, reasons } = await verifyPullRequest({ github, context, core, pr, owner, repo, checkCI: false });
      if (!success) {
        const errorMsg = `PR Verification Failed:\n\n${reasons.join('\n\n')}`;
        core.error(errorMsg);
        core.setFailed('PR requirements not met. See detailed logs and check comments above.');
      } else {
        core.info(`PR #${prNumber} meets all requirements!`);
      }
    } else {
      // Running inside scheduled-pr-verification.yml (cron polling mode)
      core.info('Running PR verification and scheduled auto-merge polling...');

      const openPRs = await withRetry(core, () => github.paginate(github.rest.pulls.list, {
        owner,
        repo,
        state: 'open',
        base: 'main',
      }));

      core.info(`Found ${openPRs.length} open pull request(s) targeting main`);

      for (const pr of openPRs) {
        if (pr.draft) {
          core.info(`PR #${pr.number} is a draft. Skipping.`);
          continue;
        }

        core.info(`--------------------------------------------------`);
        core.info(`Processing PR #${pr.number}: "${pr.title}"`);

        const { success, reasons, ciPending } = await verifyPullRequest({ github, context, core, pr, owner, repo, checkCI: true });

        const hasReadyLabel = pr.labels.some(l => l.name === 'ready-to-merge');

        if (success) {
          const isReleasePlease = pr.head.ref === 'release-please--branches--main' || pr.head.ref?.startsWith('release-please');
          const isFork = pr.head.repo?.full_name !== pr.base.repo?.full_name;

          if (isReleasePlease) {
            core.info(`PR #${pr.number} is a release-please PR. Skipping auto-merge per specifications.`);
            await deleteBotCommentIfExists({ github, core, owner, repo, prNumber: pr.number });
            if (!hasReadyLabel) {
              core.info(`Adding "ready-to-merge" label to Release PR #${pr.number}...`);
              await github.rest.issues.addLabels({
                owner,
                repo,
                issue_number: pr.number,
                labels: ['ready-to-merge'],
              });
            }
          } else {
            // Merge automatically (including fork PRs)!
            await deleteBotCommentIfExists({ github, core, owner, repo, prNumber: pr.number });
            if (hasReadyLabel) {
              // Remove the label before merging to keep history clean
              try {
                await github.rest.issues.removeLabel({
                  owner,
                  repo,
                  issue_number: pr.number,
                  name: 'ready-to-merge',
                });
              } catch (e) {
                // Ignore removal failure
              }
            }
            await mergePullRequest({ github, core, owner, repo, prNumber: pr.number, sha: pr.head.sha });
          }
        } else {
          // Requirements are not met. If the PR has the "ready-to-merge" label, remove it!
          if (hasReadyLabel) {
            core.info(`PR #${pr.number} requirements are no longer met. Removing "ready-to-merge" label.`);
            try {
              await github.rest.issues.removeLabel({
                owner,
                repo,
                issue_number: pr.number,
                name: 'ready-to-merge',
              });
            } catch (error) {
              core.warning(`Could not remove "ready-to-merge" label: ${error.message}`);
            }
          }

          if (ciPending) {
            core.info(`PR #${pr.number} has in-progress CI check runs. Postponing merge and skipping comments until CI completes.`);
          } else {
            // Requirements failed and CI is not pending -> Post/update a feedback comment for the author on 12:00 PM CST (18:00 UTC) or manual runs
            const isScheduled = context.eventName === 'schedule';
            const currentHour = new Date().getUTCHours();
            const shouldComment = !isScheduled || currentHour === 18;

            if (shouldComment) {
              const commentBody = `### 🤖 Scheduled Auto-Merge Status

Thank you for your contribution! The scheduled auto-merge job ran, but this PR cannot be merged yet because the following requirements are missing:

${reasons.join('\n\n')}

*Please resolve these items so that the scheduled job can automatically merge your PR.*`;

              await updateOrPostComment({ github, core, owner, repo, prNumber: pr.number, message: commentBody });
            } else {
              core.info(`PR #${pr.number} requirements missing, but skipping status comment (it is currently Hour ${currentHour} UTC, not the 12:00 PM CST / 18:00 UTC run).`);
            }
          }
        }
      }
    }
  } catch (error) {
    core.setFailed(`Workflow execution failed: ${error.message}`);
  }
};

/**
 * Performs verification on a single Pull Request.
 */
async function verifyPullRequest({ github, context, core, pr, owner, repo, checkCI }) {
  const reasons = [];
  let ciPending = false;

  // 1. Verify CI Check Runs (Only during active polling/auto-merge)
  if (checkCI) {
    core.info(`Checking CI status for PR #${pr.number} at SHA ${pr.head.sha}...`);
    const { data: checks } = await withRetry(core, () => github.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
    }));

    core.info(`Total check runs found on GitHub: ${checks.check_runs.length}`);
    for (const r of checks.check_runs) {
      core.info(`  - [${r.status}] Name: "${r.name}", Conclusion: "${r.conclusion || 'pending'}", ID: ${r.id}`);
    }

    // Filter out requirements verification and event trigger check runs to avoid deadlock
    const relevantCheckRuns = checks.check_runs.filter(r => {
      const isIgnored = r.name === 'Verify PR Requirements' || r.name === 'Trigger Executor on Event';
      if (isIgnored) {
        core.info(`  -> Ignoring status/trigger check run to prevent deadlock: "${r.name}"`);
      }
      return !isIgnored;
    });

    const totalRuns = relevantCheckRuns.length;
    const completedRuns = relevantCheckRuns.filter(r => r.status === 'completed');
    const failedRuns = relevantCheckRuns.filter(r => r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'skipped');

    core.info(`CI check runs processed: ${completedRuns.length}/${totalRuns} completed. Failed: ${failedRuns.length}`);

    if (totalRuns === 0) {
      reasons.push('- **CI Checks**: No CI check runs have started yet.');
    } else if (completedRuns.length < totalRuns) {
      ciPending = true;
      reasons.push(`- **CI Checks**: ${totalRuns - completedRuns.length} check run(s) are still in-progress.`);
    } else if (failedRuns.length > 0) {
      core.info('Failing CI Check Run(s) detected:');
      for (const r of failedRuns) {
        core.info(`  - Name: "${r.name}", Conclusion: "${r.conclusion}", ID: ${r.id}, Link: ${r.html_url || 'N/A'}`);
      }
      reasons.push(`- **CI Checks**: Some CI check runs failed:\n` + failedRuns.map(r => `  - \`${r.name}\` (${r.conclusion})`).join('\n'));
    }
  }

  // 2. Verify Commits
  core.info(`Checking commit signatures for PR #${pr.number}...`);
  const commits = await withRetry(core, () => github.paginate(github.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pr.number,
  }));

  const unverifiedCommits = commits.filter(c => !c.commit.verification?.verified);
  if (unverifiedCommits.length > 0) {
    reasons.push(`- **Verified Commits**: The following commit(s) are not signed or verified:\n` +
      unverifiedCommits.map(c => `  - \`${c.sha.substring(0, 7)}\` - ${c.commit.message.split('\n')[0]}`).join('\n')
    );
  } else {
    core.info(`All ${commits.length} commit(s) are verified.`);
  }

  // 3. Verify Reviews & Approvals
  core.info(`Checking reviewer approvals for PR #${pr.number}...`);
  const reviews = await withRetry(core, () => github.paginate(github.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: pr.number,
  }));

  const latestReviews = {};
  for (const review of reviews) {
    if (review.user) {
      latestReviews[review.user.login] = review;
    }
  }

  core.info(`Processed reviews/approvals for PR #${pr.number}:`);
  for (const [login, review] of Object.entries(latestReviews)) {
    core.info(`  - User: @${login}, Type: "${review.user?.type || 'Unknown'}", State: "${review.state}", Association: "${review.author_association || 'NONE'}", Submitted At: "${review.submitted_at || 'Unknown'}"`);
  }

  // Calculate trusted human approvals asynchronously to support querying collaborator permissions
  const trustedApprovals = [];
  for (const review of Object.values(latestReviews)) {
    const login = review.user?.login;
    if (!login) continue;
    const isBot = review.user.type === 'Bot' ||
                  login.endsWith('[bot]') ||
                  login.toLowerCase().includes('copilot') ||
                  login.toLowerCase().includes('agent');
    if (isBot) continue;

    const assoc = review.author_association;
    const isTrustedAssoc = assoc === 'OWNER' || assoc === 'MEMBER' || assoc === 'COLLABORATOR';
    const isApproved = review.state === 'APPROVED';

    let isTrusted = isTrustedAssoc;

    // Query collaborator permission level via API as the absolute source of truth
    // (e.g. to catch users who are granted write access via a team/group),
    // falling back to author_association if the API call fails or is restricted.
    try {
      const { data: permData } = await withRetry(core, () => github.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: login,
      }));
      const perm = permData.permission; // admin, write, maintain, triage, read, none
      const hasTrustedPerm = perm === 'admin' || perm === 'write' || perm === 'maintain' || perm === 'triage';
      core.info(`  -> User @${login} permission check: "${perm}" (trusted: ${hasTrustedPerm}, association was: "${assoc}")`);
      isTrusted = hasTrustedPerm;
    } catch (error) {
      core.info(`  -> Note: Could not check collaborator permission level for @${login} via API (${error.message}). Falling back to author_association check.`);
      core.info(`  -> User @${login} author_association check: "${assoc}" (trusted: ${isTrustedAssoc})`);
    }

    if (isApproved) {
      if (isTrusted) {
        core.info(`  -> Trusted approval identified: @${login}`);
        trustedApprovals.push(review);
      } else {
        core.info(`  -> Note: Review from @${login} is APPROVED but they do not have trusted write/maintain/admin/triage access.`);
      }
    } else {
      core.info(`  -> Note: Review from @${login} is NOT active (State: "${review.state}", trusted reviewer: ${isTrusted}).`);
    }
  }

  // 3.5. Proxy Approval Logic
  const isAutoMerge = process.env.AUTO_MERGE === 'true';
  const isDependabot = pr.user?.login === 'dependabot[bot]';
  const aiApprovals = Object.values(latestReviews).filter(review => {
    const login = review.user?.login;
    if (!login) return false;
    const isAi = login.toLowerCase().includes('copilot') || login.toLowerCase().includes('agent');
    return isAi && (review.state === 'APPROVED' || review.state === 'COMMENTED');
  });

  if (isAutoMerge) {
    const hasApprovals = isDependabot ? (aiApprovals.length > 0) : (trustedApprovals.length > 0);

    if (hasApprovals) {
      const botApproved = Object.values(latestReviews).some(review => {
        const login = review.user?.login;
        return login === 'github-actions[bot]' && review.state === 'APPROVED';
      });

      if (!botApproved) {
        const approvalType = isDependabot ? 'trusted AI reviewer' : 'trusted human reviewer';
        core.info(`🤖 Proxy Approval: PR #${pr.number} has approvals from ${approvalType}, but lacks a Write-level bot approval. Submitting proxy approval...`);
        try {
          await withRetry(core, () => github.rest.pulls.createReview({
            owner,
            repo,
            pull_number: pr.number,
            event: 'APPROVE',
            body: `🤖 Proxy approval: ${approvalType} approved this PR.`,
          }));
          core.info(`🤖 Proxy approval submitted successfully!`);

          // Inject bot approved review locally so the rest of the script processes it immediately
          latestReviews['github-actions[bot]'] = {
            user: { login: 'github-actions[bot]', type: 'Bot' },
            state: 'APPROVED'
          };
        } catch (error) {
          core.warning(`Could not submit proxy approval: ${error.message}`);
        }
      }
    }
  }

  if (isDependabot) {
    core.info(`PR #${pr.number} is opened by Dependabot. Checking for AI approvals...`);
    core.info(`Found AI reviews: ${aiApprovals.map(r => `@${r.user?.login} (${r.state})`).join(', ') || 'None'}`);

    if (aiApprovals.length < 1) {
      reasons.push(`- **Reviews**: Requirements not met. Dependabot PR requires at least **1 AI review** (from Copilot or Agent).\n` +
        `  - Approving AI reviewers: _None_`
      );
    } else {
      core.info(`PR #${pr.number} meets the AI review approval threshold for Dependabot auto-merge!`);
    }
  } else {
    core.info(`Approving trusted collaborators: ${trustedApprovals.map(r => r.user.login).join(', ') || 'None'}`);

    const hasTrustedHumanApproval = trustedApprovals.length >= 1;

    if (!hasTrustedHumanApproval) {
      reasons.push(`- **Reviews**: Requirements not met. PR requires at least **1 human approval** from a trusted role (Collaborator, Member, or Owner).\n` +
        `  - Approving trusted collaborators: ${trustedApprovals.map(u => `@${u.user.login}`).join(', ') || '_None_'}`
      );
    }
  }

  // 4. Verify Resolved Comments (GraphQL)
  core.info(`Checking for unresolved review comment threads for PR #${pr.number}...`);
  const gqlQuery = `
    query($owner: String!, $repo: String!, $pullNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 1) {
                nodes {
                  body
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const gqlResult = await withRetry(core, () => github.graphql(gqlQuery, {
    owner,
    repo,
    pullNumber: pr.number,
  }));

  const threads = gqlResult.repository?.pullRequest?.reviewThreads?.nodes || [];
  const unresolvedThreads = threads.filter(t => !t.isResolved);

  if (unresolvedThreads.length > 0) {
    reasons.push(`- **Review Comments**: All review comments must be resolved. There are currently ${unresolvedThreads.length} unresolved thread(s):\n` +
      unresolvedThreads.map(t => {
        const firstComment = t.comments?.nodes?.[0];
        const author = firstComment?.author?.login ? `@${firstComment.author.login}` : 'unknown';
        const body = firstComment?.body ? firstComment.body.replace(/\r?\n/g, ' ').substring(0, 60) + '...' : 'No comment body';
        return `  - Thread by ${author}: "${body}"`;
      }).join('\n')
    );
  } else {
    core.info(`All review comment threads are resolved.`);
  }

  return {
    success: reasons.length === 0,
    reasons,
    ciPending,
  };
}

/**
 * Posts or updates a single warning comment on the PR.
 */
async function updateOrPostComment({ github, core, owner, repo, prNumber, message }) {
  const comments = await withRetry(core, () => github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
  }));

  const botComment = comments.find(c => c.body && c.body.includes(COMMENT_SIGNATURE));
  const fullBody = `${message}\n\n${COMMENT_SIGNATURE}`;

  if (botComment) {
    if (botComment.body !== fullBody) {
      core.info(`Updating existing status comment on PR #${prNumber}`);
      await withRetry(core, () => github.rest.issues.updateComment({
        owner,
        repo,
        comment_id: botComment.id,
        body: fullBody,
      }));
    } else {
      core.info(`Status comment on PR #${prNumber} is already up to date`);
    }
  } else {
    core.info(`Posting new status comment on PR #${prNumber}`);
    await withRetry(core, () => github.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: fullBody,
    }));
  }
}

/**
 * Deletes the warning comment if it exists (run before merge).
 */
async function deleteBotCommentIfExists({ github, core, owner, repo, prNumber }) {
  const comments = await withRetry(core, () => github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
  }));

  const botComment = comments.find(c => c.body && c.body.includes(COMMENT_SIGNATURE));
  if (botComment) {
    core.info(`Deleting old auto-merge warning comment on PR #${prNumber} before merging`);
    try {
      await withRetry(core, () => github.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: botComment.id,
      }));
    } catch (error) {
      core.warning(`Could not delete comment ${botComment.id}: ${error.message}`);
    }
  }
}

/**
 * Executes squash-merge on the PR, dynamically generating a clean Conventional Commit message via Copilot.
 */
async function mergePullRequest({ github, core, owner, repo, prNumber, sha }) {
  core.info(`Fetching PR #${prNumber} changed files list to evaluate product scope...`);
  const files = await withRetry(core, () => github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
  }));

  const affectsProduct = files.some(f => f.filename.startsWith('internal/'));
  core.info(`PR #${prNumber} affects product (contains changes inside 'internal/'): ${affectsProduct}`);

  core.info(`Fetching PR #${prNumber} commits to craft squash message...`);
  const commits = await withRetry(core, () => github.paginate(github.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: prNumber,
  }));

  const commitsList = commits.map(c => `- ${c.commit.message}`).join('\n');
  const conventionalMsg = await craftSquashCommitMessage({ core, commitsList, affectsProduct });

  const mergeParams = {
    owner,
    repo,
    pull_number: prNumber,
    merge_method: 'squash',
    sha,
  };

  const CONVENTIONAL_COMMIT_REGEXP = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?(!?): .+/i;

  let isValid = false;
  if (conventionalMsg && CONVENTIONAL_COMMIT_REGEXP.test(conventionalMsg.commitTitle)) {
    isValid = true;

    // Enforce strict product-boundary check for semver safety (non-product changes cannot use feat, refactor, or '!')
    if (!affectsProduct) {
      const typeMatch = conventionalMsg.commitTitle.match(/^([a-z]+)(?:\([^)]+\))?(!?):/i);
      if (typeMatch) {
        const type = typeMatch[1].toLowerCase();
        const hasExclamation = typeMatch[2] === '!';

        if (type === 'feat' || type === 'refactor' || hasExclamation) {
          core.warning(`AI-generated commit title "${conventionalMsg.commitTitle}" is INVALID for non-product changes. ` +
            `Changes outside 'internal/' must NOT use 'feat', 'refactor', or '!' (which incorrectly trigger minor/major semver bumps).`);
          isValid = false;
        }
      }
    }
  }

  if (isValid && conventionalMsg) {
    mergeParams.commit_title = conventionalMsg.commitTitle;
    mergeParams.commit_message = conventionalMsg.commitMessage;
    core.info(`Generated AI Conventional Squash Message is VALID:\nTitle: ${mergeParams.commit_title}\nBody:\n${mergeParams.commit_message}`);
  } else {
    // Fallback: Default to the initial commit message, appending "fix: " if it doesn't already have a type
    const initialMsgFull = commits[0]?.commit?.message || `squash PR #${prNumber}`;
    const msgLines = initialMsgFull.split('\n');
    let defaultTitle = msgLines[0].trim();
    const defaultBodyLines = msgLines.slice(1);

    defaultBodyLines.push('');
    defaultBodyLines.push('Original Commits:');
    defaultBodyLines.push(commitsList);
    const defaultBody = defaultBodyLines.join('\n').trim();

    const hasType = CONVENTIONAL_COMMIT_REGEXP.test(defaultTitle);
    if (!hasType) {
      defaultTitle = `fix: ${defaultTitle}`;
    } else if (!affectsProduct) {
      // Enforce semver guard on the fallback title if it's a non-product change
      const typeMatch = defaultTitle.match(/^([a-z]+)(?:\([^)]+\))?(!?):/i);
      if (typeMatch) {
        const type = typeMatch[1].toLowerCase();
        const hasExclamation = typeMatch[2] === '!';

        if (type === 'feat' || type === 'refactor' || hasExclamation) {
          // Downgrade feat/refactor/breaking to chore for non-product fallback
          defaultTitle = defaultTitle.replace(/^([a-z]+)/i, 'chore').replace('!:', ':');
          core.warning(`Downgraded fallback commit title to "${defaultTitle}" to prevent incorrect SemVer bump on non-product change.`);
        }
      }
    }

    mergeParams.commit_title = defaultTitle;
    mergeParams.commit_message = defaultBody;
    core.info(`Using safe, initial-commit conventional fallback message:\nTitle: ${mergeParams.commit_title}\nBody:\n${mergeParams.commit_message}`);
  }

  core.info(`🚀 Merging PR #${prNumber} with Squash method...`);
  // Use GitHub CLI with --auto to leverage GitHub's native auto-merge backend.
  // This bypasses the REST API GITHUB_TOKEN merge restriction for fork PRs!
  try {
    const mergeCmd = `gh pr merge ${prNumber} --auto --squash --subject ${JSON.stringify(mergeParams.commit_title)} --body ${JSON.stringify(mergeParams.commit_message)}`;
    execSync(mergeCmd, { env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } });
    core.info(`PR #${prNumber} auto-merge enabled/merged successfully via GitHub CLI!`);
  } catch (autoError) {
    core.warning(`Failed to enable auto-merge via gh CLI: ${autoError.message}. Retrying direct merge via gh CLI...`);
    try {
      const directMergeCmd = `gh pr merge ${prNumber} --squash --subject ${JSON.stringify(mergeParams.commit_title)} --body ${JSON.stringify(mergeParams.commit_message)}`;
      execSync(directMergeCmd, { env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } });
      core.info(`PR #${prNumber} merged directly via gh CLI successfully!`);
    } catch (directError) {
      core.warning(`Failed direct merge via gh CLI: ${directError.message}. Retrying REST API merge...`);
      await withRetry(core, () => github.rest.pulls.merge(mergeParams));
      core.info(`PR #${prNumber} merged via REST API successfully!`);
    }
  }
}

/**
 * Invokes the Copilot CLI inside the Nix environment to consolidate commit history into a high-quality Conventional Commit.
 */
async function craftSquashCommitMessage({ core, commitsList, affectsProduct }) {
  core.info('Invoking Copilot Agent CLI to craft Conventional Squash Commit Message...');

  let safetyDirective = '';
  if (!affectsProduct) {
    safetyDirective = `CRITICAL REGULATORY CONSTRAINT: None of the files modified in this PR are inside the 'internal/' folder. This is a non-product change (e.g. docs, tests, CI workflows).
Therefore, you MUST NOT use the 'feat' or 'refactor' commit types, and you MUST NOT use the '!' breaking-change indicator (which incorrectly trigger minor/major semver bumps on release-please).
Instead, you MUST use 'chore', 'ci', 'docs', 'style', 'test', or 'fix' as the commit type (e.g. 'chore: update workflows' or 'test: add unit coverage').`;
  } else {
    safetyDirective = `Allowed types include: 'fix', 'feat', 'refactor', 'chore', 'docs', 'style', 'test'.
Use 'feat' for new features, 'fix' for bug fixes, and 'refactor' for code restructurings. Use '!' (e.g. 'feat!:') if there is a breaking change.`;
  }

  const prompt = `You are an expert Conventional Commits writer.
Given the following list of commits from a pull request, draft a clean, high-quality, consolidated Conventional Commit title and body for the final squash merge commit on main.

The first line of your response MUST be exactly the subject line matching the Conventional Commits format: 'type: description' (e.g. 'feat: support dynamic login').

${safetyDirective}

Don't use component scopes, just use 'type: description' or 'type!: description'.
Subject lines must not exceed 70 characters due to a GitHub limitation.
The rest of your response must be a clean, bulleted explanation of the detailed changes, separated from the title by a blank line. Do not output any markdown code blocks, prefixes like "Commit message:", or other conversational filler. Just the direct title and body.

Commits in PR:
${commitsList}
`;

  try {
    // Save prompt to a temporary file to avoid shell expansion and parentheses parsing errors
    const promptFile = '.copilot-prompt.txt';
    fs.writeFileSync(promptFile, prompt);

    // Execute copilot in Nix env using nix-run.sh, passing GITHUB_TOKEN inside the script context
    // because nix develop scrubs the outer environment. We double quote the cat expansion inside
    // single quotes to pass it literally to the nix-run script where bash will evaluate it securely.
    const cmd = `${process.env.GITHUB_WORKSPACE}/.github/workflows/scripts/nix-run.sh GITHUB_TOKEN='${process.env.GITHUB_TOKEN}' COPILOT_GITHUB_TOKEN='${process.env.GITHUB_TOKEN}' copilot -s --yolo -p '"$(cat ${promptFile})"'`;
    const output = execSync(cmd, { env: { ...process.env, GITHUB_TOKEN: process.env.GITHUB_TOKEN } }).toString().trim();

    // Clean up temporary prompt file
    try {
      fs.unlinkSync(promptFile);
    } catch (cleanupError) {
      core.warning(`Temporary prompt file cleanup failed: ${cleanupError.message}`);
    }

    if (!output) {
      throw new Error('Copilot returned an empty response');
    }

    const lines = output.split('\n');
    const commitTitle = lines[0].trim();
    const commitMessage = lines.slice(1).join('\n').trim();

    return { commitTitle, commitMessage };
  } catch (error) {
    core.warning(`Copilot message generation failed: ${error.message}. Falling back to default.`);
    return null;
  }
}



/**
 * Executes an asynchronous function with retries and exponential backoff.
 */
async function withRetry(core, apiCall, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      const status = error.status;

      // Retry on network errors, rate limiting (403, 429), or 5xx server errors
      const isRetryable = !status || status === 403 || status === 429 || status >= 500;

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const backoffDelay = initialDelay * Math.pow(2, attempt - 1);
      core.warning(`GitHub API call failed (Status: ${status || 'Network Error'}). Retrying attempt ${attempt}/${maxRetries} in ${backoffDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  throw lastError;
}
