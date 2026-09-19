# ADR-001: Git Worktrees for Agent Isolation

## Status

Accepted

## Context

Multiple AI coding tasks may execute concurrently. Agents must not modify the developer's active branch or interfere with another agent.

## Decision

Use Git worktrees as the default isolation mechanism for coding tasks.

Each task receives:

- a dedicated workspace directory
- a dedicated branch
- a recorded baseline commit

Example:

```text
~/.codexflow/workspaces/project_123/task_001/
branch: codexflow/task-001
```

## Consequences

### Positive

- Parallel tasks can run safely.
- The user's primary working tree remains untouched.
- Diffs are easy to calculate.
- Each task has clear Git traceability.
- Agent cleanup is straightforward.

### Negative

- Worktree lifecycle must be managed carefully.
- Disk usage can grow with concurrent tasks.
- Merge/conflict handling becomes an explicit subsystem.

## Safety

Never blindly run:

```text
git reset --hard
git clean -fd
git checkout main
```

User changes must be preserved.
