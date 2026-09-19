# SDD: Worktree Manager

## Purpose

Provide isolated Git workspaces for every coding task.

## Responsibilities

- Validate repository state.
- Determine base branch and baseline commit.
- Create a task branch.
- Create a Git worktree.
- Track workspace metadata.
- Expose workspace path to authorized runtime components.
- Clean up worktrees after retention rules.
- Detect worktree conflicts and failures.

## Inputs

```ts
type CreateWorkspaceInput = {
  repositoryId: string;
  taskId: string;
  baseBranch: string;
};
```

## Output

```ts
type Workspace = {
  id: string;
  taskId: string;
  rootPath: string;
  branch: string;
  baselineCommit: string;
};
```

## Safety

Before creation inspect:

- Git repository validity
- current/default branch
- dirty state
- untracked files
- merge conflicts
- detached HEAD

Never destroy user changes.

## Acceptance Criteria

- A task gets a unique worktree.
- Worktree changes do not affect the primary branch.
- The baseline commit is recorded.
- The branch name is deterministic and traceable.
- Cleanup failures are observable.
