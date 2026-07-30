# Plan: Fix Shallow Clone in Tag Checkout

**Executed Date:** 2026-07-30
**Purpose:** Prevent GoReleaser from creating `untagged` releases by ensuring the `Checkout New Tag` step clones the repository with its complete git tag history.

## Background & Motivation
The manual release workflows use `actions/checkout` to clone the target tag into a separate directory (`tags/${TAG}`) for GoReleaser to build from. By default, `actions/checkout` performs a shallow clone of depth 1, meaning it checks out the exact commit files but *does not fetch git tags*. When GoReleaser runs, it queries the local git repository to determine the version context. Because the repository lacks tags, GoReleaser panics, logs `couldn't find any tags before "v2.4.15"`, and creates a draft release on GitHub with a dummy name like `untagged-ce7804ebd7edb22cf1dd`. The subsequent `Publish Release` script then fails because it searches GitHub for a draft named `v2.4.15` and cannot find it.

## Proposed Solution
We will add `fetch-depth: 0` to the `Checkout New Tag` step in both `manual-release.yml` and `manual-rc-release.yml`. This forces the GitHub Action to fetch all history and tags, ensuring the cloned workspace is fully aware of the git tag context. GoReleaser will then correctly identify the tag, name the draft release properly, and allow the publish script to succeed.

## Implementation Steps

1. **Update `manual-release.yml`:**
   * Locate the `Checkout New Tag` step.
   * Add `fetch-depth: 0` to the `with:` block.
2. **Update `manual-rc-release.yml`:**
   * Locate the `Checkout New Tag` step.
   * Add `fetch-depth: 0` to the `with:` block.

## Verification & Testing
1. Run `actionlint` on both modified `.yml` files to ensure syntax validity.
