# Plan: Fix Manual Workflow Tag Creation

**Executed Date:** 2026-07-29
**Purpose:** Update `.github/workflows/scripts/create-push-tag.js` to correctly handle pre-existing tags (with SHA validation) and re-introduce optional tag creation for manual workflows using a `CREATE_REF` environment variable.

## Background & Motivation
The manual release workflows failed at the `Checkout New Tag` step because the preceding step (`create-push-tag.js`) no longer creates the git tag on the remote repository. This tag creation logic was stripped in PR #354 to prevent test workflows from accidentally pushing tags to the repository. Additionally, when a tag *already* exists on the remote (e.g., pushed manually by a developer to unblock CI), the manual release workflows should be resilient enough to detect it, validate it, and gracefully proceed rather than failing or erroring out.

## Proposed Solution
We will update `create-push-tag.js` to intelligently handle tag existence and conditional creation:
1. **Existing Tag Validation:** If the tag already exists, the script will fetch its SHA. If the workflow provided a specific `SHA` to build from, it will compare the two. If they do not match, the script will fail. If they do match (or no target SHA was forced), it safely skips creation and continues to output the tag.
2. **Conditional Creation:** If the tag does not exist, the script will create it via the API (`github.rest.git.createRef`) **only** if the `CREATE_REF` environment variable is set to `'true'`.
3. **Workflow Integration:** We will configure `manual-release.yml` and `manual-rc-release.yml` to pass `CREATE_REF: 'true'`, ensuring they can generate tags when required, while other CI pipelines remain safe.

## Implementation Steps

1. **Update `create-push-tag.js`:**
   * Fetch the existing tag's target SHA via `github.rest.git.getRef`.
   * Compare `existingRef.data.object.sha` to the provided `sha`.
   * Add the `createRef` block wrapped in an `if (process.env.CREATE_REF === 'true')` statement.
2. **Update `manual-release.yml`:**
   * Add `CREATE_REF: 'true'` to the `Create and Push Tag via API` step's environment block.
3. **Update `manual-rc-release.yml`:**
   * Add `CREATE_REF: 'true'` to the `Create and Push RC Tag via API` step's environment block.

## Verification & Testing
1. Visually review the JavaScript logic to ensure error handling (`try/catch`) is robust.
2. Run `actionlint` locally to verify the YAML modifications.
