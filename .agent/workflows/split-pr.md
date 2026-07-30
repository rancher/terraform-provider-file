# Workflow: Splitting Changes into Atomic PRs

This workflow defines a highly secure, step-by-step process for splitting a large set of workspace modifications into multiple, easily reviewable, atomic, and self-passing Pull Requests. It ensures zero data loss, enforces strict developer review at each milestone, and leverages our custom `create-pr.sh` skill to automate secure PR creation.

---

## Detailed Step-by-Step Procedure

### 1. Preparation & Staging Backups
* **Backup modifications**: Before modifying the active working tree, copy all modified and untracked files into a temporary directory (e.g. `~/.gemini/tmp/terraform-provider-file/pr_split_backups/`) categorized into separate subfolders for each planned PR (e.g. `pr1_...`, `pr2_...`).
* **Clean current working tree**: Once fully backed up, reset and clean the main branch so the repository starts from a pristine head state:
  ```bash
  git checkout -- .
  git clean -fd
  ```

---

## 2. Iterative PR Lifecycle (Execute for each PR sequentially)

### Step A: Branch Creation & Staging
1. Checkout a new feature branch originating from `main`:
   ```bash
   git checkout main
   git checkout -b feature/<branch-name>
   ```
2. Copy *only* the specific files belonging to the current PR from the backup subfolder into the workspace working directory.
3. Stage the files in Git:
   ```bash
   git add <file1> <file2>...
   ```
4. **Pause for Manual Developer Review**: Present the staged changes (using `git diff --staged`) to the developer. Explicitly ask for their review and approval. **Do not commit or proceed until the developer grants explicit approval.**

### Step B: Committing & Pushing to Fork
1. Upon receiving explicit approval, commit the changes using a high-quality Conventional Commit message:
   ```bash
   git commit -m "<type>(<scope>): <description>"
   ```
2. Push the branch to your user-owned fork remote (`origin`). **(Remember: Pushing directly to any 'rancher' upstream remote is strictly blocked by safety policies.)**
   ```bash
   git push origin feature/<branch-name>
   ```

### Step C: PR Generation via Skill
1. Use our custom `.agent/skills/create-pr.sh` skill to create the Pull Request on GitHub. This skill automatically handles the `GITHUB_TOKEN=` override trick to bypass environment token scope conflicts, ensuring `gh` can use its own authenticated credentials:
   ```bash
   .agent/skills/create-pr.sh --title "<Title>" --body "<Body>" [--base "<Base>"] [--draft]
   ```
2. Output the link of the newly created PR to the developer.
3. **Pause for PR Review/Approval**: Ask the developer to inspect and approve the PR.

### Step D: Converting Draft to Real PR (If Draft was used)
1. If the PR was created as a Draft, and the developer approves it, convert it to a real PR (Ready for Review):
   ```bash
   GITHUB_TOKEN= gh pr ready <pr-number>
   ```
2. Confirm the conversion with the developer.
3. Move to the next planned PR and repeat the loop from **Step A**.
