export default async ({ github, context, core, process }) => {
  try {
    const version = process.env.VERSION;
    if (!version) {
      throw new Error("VERSION environment variable is required");
    }
    const tag = version.startsWith('v') ? version : `v${version}`;

    let release;
    const maxRetries = 5;
    const baseDelayMs = 2000; // Start with a 2-second delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      core.info(`Listing releases to find tag ${tag} (Attempt ${attempt}/${maxRetries})...`);
      const releases = await github.paginate(github.rest.repos.listReleases, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        per_page: 100,
      });

      release = releases.find(r => r.tag_name === tag);
      if (release) {
        break;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        core.info(`Release not found yet. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!release) {
      core.setFailed(`Could not find release for tag ${tag} after ${maxRetries} attempts.`);
      return;
    }

    if (release.draft) {
      core.info(`Publishing release ID ${release.id} for tag ${tag}`);
      await github.rest.repos.updateRelease({
        owner: context.repo.owner,
        repo: context.repo.repo,
        release_id: release.id,
        draft: false,
        make_latest: tag.includes('-rc.') ? "false" : "true"
      });
      core.info(`Successfully published release for tag ${tag}`);
    } else {
      core.info(`Release for tag ${tag} is already published.`);
    }

    // -------------------------------------------------------------
    // PR Label Reconciliation
    // -------------------------------------------------------------
    try {
      core.info(`Finding pull requests associated with commit ${context.sha}...`);
      const prs = await github.rest.repos.listPullRequestsAssociatedWithCommit({
        owner: context.repo.owner,
        repo: context.repo.repo,
        commit_sha: context.sha,
      });

      const pr = prs.data.find(p => p.state === 'closed' && p.merged_at);
      if (pr) {
        core.info(`Found associated merged PR #${pr.number}: "${pr.title}"`);
        
        const isReleasePlease = pr.head.ref === 'release-please--branches--main' || pr.head.ref?.startsWith('release-please');
        if (isReleasePlease) {
          core.info(`PR #${pr.number} is a release-please PR. Reconciling labels...`);
          
          const labels = pr.labels.map(l => l.name);
          core.info(`Current labels on PR #${pr.number}: ${labels.join(', ')}`);

          const labelsToRemove = ['autorelease: pending', 'ready-to-merge'];
          for (const label of labelsToRemove) {
            if (labels.includes(label)) {
              core.info(`Removing label "${label}" from PR #${pr.number}...`);
              try {
                await github.rest.issues.removeLabel({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: pr.number,
                  name: label,
                });
                core.info(`Successfully removed label "${label}".`);
              } catch (err) {
                core.warning(`Failed to remove label "${label}": ${err.message}`);
              }
            }
          }

          if (!labels.includes('autorelease: tagged')) {
            core.info(`Adding label "autorelease: tagged" to PR #${pr.number}...`);
            try {
              await github.rest.issues.addLabels({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: pr.number,
                labels: ['autorelease: tagged'],
              });
              core.info(`Successfully added label "autorelease: tagged".`);
            } catch (err) {
              core.warning(`Failed to add label "autorelease: tagged": ${err.message}`);
            }
          }
        } else {
          core.info(`PR #${pr.number} is not a release-please PR.`);
        }
      } else {
        core.info(`No merged pull request associated with commit ${context.sha} was found.`);
      }
    } catch (labelError) {
      core.warning(`Failed to reconcile PR labels: ${labelError.message}`);
    }
  } catch (error) {
    core.setFailed(`Failed to publish release: ${error.message}`);
  }
};
