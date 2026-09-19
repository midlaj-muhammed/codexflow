# ADR-003: Hybrid Orchestrator Instead of Event-Bus-Only Control Flow

## Status

Accepted

## Context

A fully event-driven workflow can become difficult to reason about when deterministic operations such as approval, commit, push, and rollback are represented only as events.

## Decision

Use a hybrid architecture:

```text
Commands → deterministic operations
Events   → observation and decoupling
```

The Supervisor owns task progression while plugins subscribe to relevant events.

Example:

```text
task.created
  ↓
Planner
  ↓
plan.created
  ↓
Coder
  ↓
code.generated
  ├── Reviewer
  └── Tester
  ↓
Supervisor
```

The following remain explicit commands:

```text
approveTask()
rejectTask()
rollbackTask()
commitChanges()
pushBranch()
createPullRequest()
```

## Consequences

The system remains composable without turning the task lifecycle into uncontrolled event spaghetti.
