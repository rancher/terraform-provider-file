# Agentic Framework Blueprint: Boilerplate Sync Skill

- **Executed Date:** pending
- **Purpose:** Establishes a lightweight, manifest-driven file-syncing and diff-checking tool inside developer workspaces under the Agentic Framework. This allows developers and agents to easily track, compare, and pull common configuration files and boilerplate utilities from a centralized "master template" repository, maintaining cross-project consistency without the administrative overhead of submodules.

---

## Technical Specification

The synchronization tool is implemented as a standalone, modular Bash skill conforming strictly to `shell-scripts.instructions.md` and standard dev shells.

### 1. The Sync Manifest (`.boilerplate-sync.json`)

Each child repository declares its tracking files and template repository source inside a local `.boilerplate-sync.json` configuration file in the root directory:

```json
{
  "template_repo": "git@github.com:rancher/terraform-provider-file.git",
  "files": [
    { "local": ".prettierrc", "remote": "shared-configs/.prettierrc" },
    { "local": ".golangci.yml", "remote": "shared-configs/.golangci.yml" },
    { "local": "cspell.json", "remote": "shared-configs/cspell.json" },
    { "local": ".github/workflows/scripts/lint.sh", "remote": "scripts/lint.sh" }
  ]
}
```

### 2. Operational Logic & Sequence

The sync utility `.agent/skills/sync-boilerplate.sh` executes the following sequence:

```
[Local Repo]                     [System OS / TMP]                     [Remote Repo]
     |                                   |                                   |
     | -- 1. Read Manifest JSON ------>  |                                   |
     |                                   | -- 2. git clone --depth 1 ------> |
     |                                   | <--- 3. Local Clone Copy -------- |
     |                                   |                                   |
     | <--- 4. Run 'diff' on file -----> |                                   |
     |                                   |                                   |
     | <--- 5. Optionally 'cp' file ---- |                                   |
     |                                   |                                   |
     |                                   | -- 6. Trap: rm -rf /tmp/clone --> |
```

1. **Manifest Parsing**: Reads and validates the JSON fields `.template_repo` and `.files` array using `jq`.
2. **Hermetic Sandbox Prep**: Establishes a temporary workspace directory under `/tmp/boilerplate-sync-XXXXXX` using `mktemp -d`.
3. **Repository Fetching**: Clones the remote master repository cleanly off the parent branch (`git clone --depth 1 --no-checkout <repo_url> <tmp_dir>`), then checks out strictly the tracked files to minimize network/disk footprint.
4. **Operations Modes**:
   - **Diff Mode (`--diff`)**: Runs `git diff --no-index` or standard `diff -u` between the local file and its remote template file counterpart.
   - **Sync/Pull Mode (`--pull`)**: Overwrites the local file by copying the template file into place, creating any missing parent directories natively.
   - **Sync/Push Mode (`--push`)**: Copies local files that differ back to the remote template clone, commits them conventionally, and pushes the updates to the template repository using native developer credentials.

- **Environment Variable Override**: If the `CENTRAL_FILE_REPO` environment variable is defined, the utility automatically overrides the manifest's `.template_repo` with it, allowing safe targeting of private central repositories without hardcoding sensitive URLs in version-controlled JSON manifests.

5. **Secure Workspace Cleanup**: Registers an exit trap (`trap 'cleanup' EXIT`) that mathematically guarantees the temporary directories are fully destroyed, preventing `/tmp` clutter or leak vectors.

---

## Implementation Checklist

### Phase 14.1: Script Implementation & Boilerplate Manifest

- [x] Create the shell script `.agent/skills/sync-boilerplate.sh` with `set -euo pipefail`.
- [x] Implement `show_help()` documenting `-h`, `--help`, `--diff`, `--pull`, and `--status` options.
- [x] Implement robust `cleanup()` and exit-trap registration.
- [x] Implement manifest validation verifying `jq` availability and `.boilerplate-sync.json` existence.
- [x] Implement environment variable `CENTRAL_FILE_REPO` override logic.
- [x] Implement shallow cloning / checkout logic to retrieve template files.
- [x] Implement `run_diff()` comparing remote and local configurations.
- [x] Implement `run_pull()` safely copying template files into place.
- [x] Implement `run_push()` copying local configurations back to full remote checkouts, committing, and pushing them.
- [x] Create a local `.boilerplate-sync.json` manifest template file in the root.

### Phase 14.2: Static Analysis & Validation (Autonomous)

- [x] Run static analysis on the new script: `./.github/workflows/scripts/lint.sh shellcheck`.
- [x] Auto-format the shell script and JSON configurations using `./.github/workflows/scripts/lint.sh shfmt --fix` and `./.github/workflows/scripts/lint.sh prettier --fix`.
- [x] Run a local test dry-run comparing against a public repository to verify correct diff outputs and clean exits.

### Phase 14.3: IDE Review & Secure Commit (Gate 2)

- [ ] Present the unstaged diff for visual review in the chat.
- [ ] Propose the conventional commit message: `build(skills): implement central boilerplate sync tool`.
- [ ] Run cryptographic manual user-approval signature via `user-approval.js`.
- [ ] Run `.agent/skills/commit-push.sh` to commit and push securely.

### Phase 14.4: PR Gateway (Gate 3)

- [ ] Generate the Draft PR using `.agent/skills/create-pr.sh --draft`.
- [ ] Graduate the draft PR to Ready for Review upon receiving developer approval.

### Phase 14.5: Central Repo Synchronization (Template Delivery)

- [x] Expand `.boilerplate-sync.json` to map all `.agent` hooks, skills, and rules.
- [x] Execute `sync-boilerplate.sh --push` to securely push the entire agentic framework back to the centralized `central-file-repo` template repository.

### Phase 14.6: Release Process & Core Script Synchronization

- [x] Expand `.boilerplate-sync.json` to map the GHA `release.yml` and the scripts it requires (`nix-run.sh`, `create-local-tag.sh`, `goreleaser.sh`, `publish-release.js`).
- [x] Execute `sync-boilerplate.sh --push` to securely push these final GHA release files.
