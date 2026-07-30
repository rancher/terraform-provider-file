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
  } catch (error) {
    core.setFailed(`Failed to publish release: ${error.message}`);
  }
};
