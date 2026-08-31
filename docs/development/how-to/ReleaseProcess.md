# How to Release a New Product Version

This document is a sequential, goal-oriented How-To guide for configuring release keys, proposing SemVer version increments, and executing product releases to production.

---

## Step 1: Configure Your Local GPG Signing Key

All commits that undergo gating checks must be cryptographically signed by your personal GPG key. To set up your signing key locally:

1. **Verify your key exists:**

   ```bash
   gpg --list-secret-keys --keyid-format=long
   ```

2. **Configure Git to use your GPG key:**

   ```bash
   git config --global user.signingkey <YOUR_KEY_ID>
   git config --global commit.gpgsign true
   ```

3. **Register your GPG key in your local SSH agent if utilizing SSH-based signing keys:**
   Refer to our **[Documentation Standards](../reference/Documentation.md)** to verify private/public key completeness.

## Step 2: Propose a Change via Conventional Commits

Version calculations are completely automated. To propose a version increment, you must format your Pull Request squash-merge titles according to **Conventional Commits**:

1. **Bug Fixes (Minor patch release):** Format as `fix: description` (e.g. `fix: handle null values in directory client`).
2. **New Features (Minor feature release):** Format as `feat: description` (e.g. `feat: add local snapshot caching`).
3. **Breaking Changes (Major breaking release):** Append `!` or declare `BREAKING CHANGE:` in the commit footers (e.g. `feat!: change default directory paths`).

## Step 3: Review and Monitor the Automated Release PR

Once your PR lands on the `main` branch:

1. **Trigger Calculation:** The `release-please` GHA action executes. It automatically scans your squash-merge commit title and updates the running Release PR (e.g. `chore(main): release v1.2.3`).
2. **Acceptance Testing:** The Release PR automatically triggers OpenID Connect (OIDC) integration tests inside a Nix shell, compiling release candidates (e.g. `v1.2.3-rc.0`) to verify binary execution.

## Step 4: Merge the Release PR on GitHub

When you are ready to publish the stable production assets:

1. Navigate to your repository's Pull Requests page on GitHub.
2. Locate the Release PR titled `chore(main): release v1.x.y`.
3. Verify the auto-generated `CHANGELOG.md` updates.
4. **Approve and Merge** the Release PR.

Once merged, the automated runner will automatically:

- Tag the repository with the exact version (`v1.x.y`).
- Securely extract signing keys from Vault.
- Cross-compile and GPG-sign all binaries using GoReleaser.
- Publish the stable assets natively to the GitHub Release Registry.
