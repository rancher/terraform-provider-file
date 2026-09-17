---
name: github-pr
description: Manage, review, and address GitHub pull request comments and metadata. Use this skill whenever you need to find a PR, fetch conversation or inline review comments (including thread IDs), update PR titles/descriptions, respond to comments, or resolve review threads.
---

# GitHub PR Management

## Overview

The `github-pr` skill enables seamless local management of GitHub pull requests and review comment threads. It leverages the local `gh` CLI credentials to view, update, respond to, and resolve comments directly from the command line.

## Core Tasks

### 1. View and Find a PR

To view the pull request for the current branch, run:

```bash
./scripts/find_pr.sh
```

To view a specific PR (e.g. PR #123), run:

```bash
./scripts/find_pr.sh 123
```

### 2. Read Comments and Review Threads

To read conversation comments and inline code review comment threads (which will also output thread IDs required for resolving), run:

```bash
./scripts/read_comments.sh
```

To read comments for a specific PR, pass the PR number:

```bash
./scripts/read_comments.sh 123
```

### 3. Respond to Comments

You can respond to either a top-level general conversation comment or a specific inline code review comment.

- **Add general comment**:
  ```bash
  ./scripts/respond_comment.sh [pr_number_or_current] general "Your comment text"
  ```
- **Reply to an inline review thread**:
  Retrieve the numeric comment ID (found via `read_comments.sh`) and run:
  ```bash
  ./scripts/respond_comment.sh [pr_number_or_current] <comment_id> "Your reply text"
  ```

### 4. Resolve Review Threads

To resolve an inline review thread on GitHub, retrieve the alphanumeric GraphQL Thread ID (starts with `PRRT_`, found via `read_comments.sh`) and run:

```bash
./scripts/resolve_comment.sh <thread_id>
```

### 5. Update PR Title and Description

To edit the title and/or description of a pull request, run:

```bash
./scripts/update_pr.sh [pr_number_or_current] "New Title" "New Description Body"
```

If you only want to update one of them, pass an empty string for the other:

```bash
./scripts/update_pr.sh current "" "Only updating the body"
```
