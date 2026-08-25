export default async ({ github, context, core, process }) => {
  try {
    const sha = process.env.SHA || context.sha;
    const calculateNextRc = process.env.CALCULATE_NEXT_RC === 'true';

    const owner = context.repo.owner;
    const repo = context.repo.repo;

    let targetTag = '';

    if (calculateNextRc) {
      const targetVersion = process.env.TARGET_VERSION;
      if (!targetVersion) {
        throw new Error('TARGET_VERSION environment variable is required when CALCULATE_NEXT_RC is true');
      }

      const baseVersion = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
      core.info(`Calculating next RC tag for base version: ${baseVersion}`);

      const tags = await github.paginate(github.rest.repos.listTags, {
        owner,
        repo,
      });

      const rcPrefix = `${baseVersion}-rc.`;
      let latestRcNum = -1;

      for (const tag of tags) {
        if (tag.name.startsWith(rcPrefix)) {
          const numStr = tag.name.substring(rcPrefix.length);
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > latestRcNum) {
            latestRcNum = num;
          }
        }
      }

      const nextRcNum = latestRcNum + 1;
      targetTag = `${rcPrefix}${nextRcNum}`;
      core.info(`Calculated next RC tag: ${targetTag}`);
    } else {
      // Direct tag mode
      const rawTag = process.env.TAG || process.env.VERSION;
      if (!rawTag) {
        throw new Error('Either TAG, VERSION, or CALCULATE_NEXT_RC environment variable must be specified');
      }
      targetTag = rawTag.startsWith('v') ? rawTag : `v${rawTag}`;
    }

    core.info(`Target Tag: ${targetTag}`);
    core.info(`Target SHA: ${sha}`);

    // Check if tag already exists using the API
    let tagExists = false;
    let existingSha = '';
    try {
      const existingRef = await github.rest.git.getRef({
        owner,
        repo,
        ref: `tags/${targetTag}`,
      });
      tagExists = true;
      existingSha = existingRef.data.object.sha;
      if (existingRef.data.object.type === 'tag') {
        core.info(`Tag ${targetTag} is annotated. Fetching target commit SHA...`);
        const annotatedTag = await github.rest.git.getTag({
          owner,
          repo,
          tag_sha: existingRef.data.object.sha,
        });
        existingSha = annotatedTag.data.object.sha;
      }
    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }

    if (tagExists) {
      core.info(`Tag ${targetTag} already exists on remote pointing to SHA ${existingSha}.`);
      if (sha) {
        if (existingSha !== sha) {
          throw new Error(
            `Tag ${targetTag} already exists on remote pointing to SHA ${existingSha}, but requested SHA is ${sha}. Mismatch!`,
          );
        } else {
          core.info(`Existing tag SHA matches the requested SHA ${sha}. Proceeding gracefully.`);
        }
      }
      if (calculateNextRc) {
        throw new Error(`Calculated RC tag ${targetTag} already exists on remote. This should not happen.`);
      }
    } else {
      if (process.env.CREATE_REF === 'true') {
        core.info(`Creating tag ref refs/tags/${targetTag} pointing to ${sha}...`);
        await github.rest.git.createRef({
          owner,
          repo,
          ref: `refs/tags/${targetTag}`,
          sha,
        });
        core.info(`Successfully created tag ${targetTag}`);
      } else {
        core.info(`Tag ${targetTag} does not exist on remote and CREATE_REF is not true. Skipping tag creation.`);
      }
    }

    // Set outputs for downstream steps if needed
    core.setOutput('tag', targetTag);
    if (calculateNextRc) {
      core.setOutput('rc_tag', targetTag);
    }
  } catch (err) {
    core.setFailed(`Failed to create tag: ${err.message}`);
  }
};
