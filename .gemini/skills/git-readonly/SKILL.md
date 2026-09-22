---
name: git-readonly
description: Wrapper for safe, read-only local Git operations. Use this skill whenever you need to check git status, get branch changes, review uncommitted diffs, examine commit history, or retrieve deleted file contents.
---

# Git Readonly

## Overview

The `git-readonly` skill provides a safe, curated, and standardized set of read-only Git utilities. It protects against accidental state changes or unintended staging/committing by providing wrappers around informative git commands.

**Rule:** You should always prefer using the scripts in this skill over running raw, direct `git` commands (such as `git diff`, `git status`, `git log`, etc.) to retrieve repository state.

## Core Tasks

### 1. Check Workspace and Branch Status

To view current uncommitted changes (both staged and unstaged) and list files changed in the current branch compared to the base branch (`main` or `master`), use `get_files_changed.sh`.

```bash
./scripts/get_files_changed.sh
```

To get a clean list of explicit file paths that have been modified or are untracked (useful for iterating and staging specific files), use `get_modified_paths.sh`.

```bash
./scripts/get_modified_paths.sh
```

### 2. Review Detailed Diffs

- **Uncommitted Changes (Staged & Unstaged)**: To get a full diff of local changes in the working directory and staging area, use `get_diff_to_review.sh`.
  ```bash
  ./scripts/get_diff_to_review.sh
  ```
- **Branch Changes**: To view all changes introduced in the current branch relative to the default base branch, use `get_branch_changes.sh`.
  ```bash
  ./scripts/get_branch_changes.sh
  ```

### 3. Retrieve Deleted File Contents

If a file was deleted or heavily modified in the current branch, you can retrieve its last known good contents from Git history using `get_deleted_file.sh` by passing the relative file path.

```bash
./scripts/get_deleted_file.sh <file_path>
```

### 4. View Commit Log

To view a concise, color-stripped oneline commit history on the current branch, use `get_commit_log.sh`. You can optionally specify the number of commits to retrieve (defaults to 5).

```bash
./scripts/get_commit_log.sh [limit]
```
