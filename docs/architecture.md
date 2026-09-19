# CodexFlow Architecture

## Purpose

This document defines the implementation architecture for the CodexFlow hackathon MVP.

## System

```text
Browser
  ↓
Next.js Web App
  ↓
Node.js / TypeScript Backend
  ↓
Composable Agent Runtime
  ↓
Workspace Manager
  ↓
Git Worktree
  ↓
AI Agent Plugins
  ↓
Verification / Risk
  ↓
Human Approval
  ↓
Commit → Push → Pull Request
```

## Major boundaries

- Web UI: user interaction, task views, agent timeline, diff review, PR and evaluation views.
- Backend: orchestration APIs, persistence, Git operations, workspace lifecycle.
- Runtime: plugin registry, commands, events, scheduling, lifecycle.
- Workspace: isolated Git worktrees and execution policies.
- Git Engine: local Git operations.
- Git Provider: GitHub repository and Pull Request operations.
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
Repository
  ↓
Task
  ↓
Planner
  ↓
Verification Strategy
  ↓
Worktree
  ↓
Coder
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
Pull Request
```
