/**
 * Script: get-open-prs.js
 * Description: Queries the GitHub REST API for open pull requests targeting main and filters out drafts and release-please PRs.
 * Conforms to repository architectural standards and decoupling patterns.
 */

/**
 * Executes the get-open-prs script.
 * @param {object} context - The GitHub Actions context object.
 * @param {object} github - The pre-authenticated Octokit instance.
 * @param {object} core - The Actions Core library helper.
 * @returns {Promise<number[]>} - An array of open active PR numbers.
 */
export default async ({ github, context, core }) => {
  core.info(`Listing open pull requests targeting main in ${context.repo.owner}/${context.repo.repo}...`);

  const prs = await github.paginate(github.rest.pulls.list, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: 'open',
    base: 'main',
  });

  core.info(`Retrieved ${prs.length} open pull request(s) from GitHub.`);

  // Filter out draft PRs and automated release-please release PRs.
  // We strictly match BOTH the author login ('release-please[bot]') AND the branch prefix ('release-please--')
  // as recommended by Copilot review to prevent dropping human PRs from release-please--* branches.
  const activePrs = prs
    .filter((pr) => {
      const isDraft = !!pr.draft;
      const author = pr.user?.login;
      const branchRef = pr.head?.ref || '';

      const isReleasePlease = author === 'release-please[bot]' && branchRef.startsWith('release-please--');

      if (isDraft) {
        core.info(`PR #${pr.number} is a Draft; skipping.`);
        return false;
      }

      if (isReleasePlease) {
        core.info(`PR #${pr.number} is an automated release-please PR (${author} on branch ${branchRef}); skipping.`);
        return false;
      }

      return true;
    })
    .map((pr) => pr.number);

  core.info(`Filtered active open PRs: ${JSON.stringify(activePrs)}`);
  return activePrs;
};
