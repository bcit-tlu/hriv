---
name: local-review
description: Hand off an HRIV branch to Kyle for local review. Use when sharing a branch or worktree he will review in Docker Compose, Vite, or Storybook, or when identifying what a worktree is for.
---

# Local Review

## Before Saying “Ready to Review”

1. Commit the changes Kyle is meant to review and push the branch. Use
   `git push -u origin HEAD` when publishing the branch for the first time.
2. Run `git status -sb`. Confirm it shows the review branch tracking
   `origin/<branch>` with nothing ahead, and that no intended review changes are
   uncommitted.
3. Run `git log -1 --oneline`. Give Kyle the branch name and the short commit
   SHA, and say which surface to open and what to check.

## Commands to Share with Kyle

From the root of his main checkout, create a worktree on a local tracking branch:

```bash
git fetch origin && git worktree add --track -b <local-review-branch> .worktrees/<name> origin/<branch>
```

For an existing worktree on that tracking branch:

```bash
git -C .worktrees/<name> pull --ff-only
```

From the review worktree, run `git log -1 --oneline` and check that the SHA matches
the handoff before opening the review surface.

**Docker Compose:** From the review worktree root, run `docker compose up --build`.
If the stack is already running in that worktree, restart its Vite server with
`docker compose restart frontend` after a source-only pull. The ARQ worker does
not hot-reload backend changes; restart it with `docker compose restart worker`.
Rerun `docker compose up --build` if dependencies or Dockerfiles changed.

**Storybook:** From the review worktree root:

```bash
cd frontend && npm install && npm run storybook
```

Use `npm install` for this interactive review setup; CI uses `npm ci`. Stop and
restart any running Vite or Storybook dev server after pulling, and make sure
the restarted server is running from the review worktree.

## Record the Worktree’s Purpose

When creating a worktree, write one line about its purpose to
`.worktrees/<name>/.purpose`. Keep it local; do not commit it. When asked what a
worktree is for, read `.purpose` first, then consult the branch’s PR and commit log.
