# CodexFlow Architecture

## Purpose

This document defines the implementation architecture for the CodexFlow hackathon MVP.

## System

```text
Browser
  ↓
Next.js Web App
  ↓
Next.js / TypeScript Control Plane
  ↓
RuntimeExecutor + Supervisor
  ↓
Workspace Manager
  ↓
Git Worktree
  ↓
Planner → Coder → Specialists → Reviewer → Tester → Repair
  ↓
Verification / Risk
  ↓
Human Approval
  ↓
Durable Commit → Push → GitHub Pull Request
```

## Major boundaries

- Web UI: user interaction, task views, agent timeline, diff review, PR and evaluation views.
- Backend: orchestration APIs, persistence, Git operations, workspace lifecycle.
- Runtime: `RuntimeExecutor` owns task execution, execution leases,
  cancellation, bounded timeouts, lifecycle transitions, and persistence.
- Supervisor: deterministically selects BUG_FIX, REFACTOR, SECURITY, or
  TEST_GENERATION and supplies bounded specialist plans.
- Workspace: isolated Git worktrees and execution policies.
- Git Engine: local Git operations.
- Git Provider: GitHub-only repository, PR, check-run, and PR-refresh operations.
- Agents: specialized reasoning/execution components.
- Verification: real process execution and result collection.
- Risk: deterministic signals plus AI review.
- Evaluation: benchmark execution and metrics.

## Runtime principle

Use a hybrid command/event model.

Commands are explicit operations such as `createTask`, `createWorkspace`, `approveTask`, `commitChanges`, and `createPullRequest`.

Events describe state changes such as `task.created`, `agent.started`, `code.generated`, `test.completed`, and `approval.required`.

Do not make every operation event-driven.

## Execution isolation

Every coding task receives an isolated Git worktree. Agents never modify the developer's primary branch directly.

## External composable runtime

Cordis or another composable-agent harness may be integrated through an adapter. It is not a hard dependency until its actual APIs and behavior are verified.

## Core flow

```text
GitHub repository
  ↓
Task
  ↓
Planner
  ↓
Worktree
  ↓
Coder
  ↓
Specialist stage when selected
  ↓
Reviewer + Tester
  ↓
Repair loop when required
  ↓
Risk + Diff
  ↓
Human Approval
  ↓
Commit
  ↓
Push
  ↓
GitHub Pull Request
```

Delivery only succeeds when the persisted delivery commit, remote task branch,
and GitHub PR head all reference the same SHA. PR refresh rechecks this
invariant before exposing current remote status or checks.
