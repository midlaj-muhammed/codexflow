# SDD: Agent Orchestrator

## Purpose

Coordinate task lifecycle and specialized agent plugins.

## Responsibilities

- Create and transition task states.
- Invoke plugins through commands.
- Publish lifecycle events.
- Start safe parallel work.
- Trigger repair loops.
- Enforce maximum retries.
- Request human approval.
- Stop or block failed tasks.

## State Machine

```text
CREATED
→ QUEUED
→ PLANNING
→ CONTEXT_READY
→ CODING
→ REVIEWING
→ TESTING
→ REPAIRING
→ READY_FOR_APPROVAL
→ APPROVED
→ APPLIED
```

Terminal states:

```text
REJECTED
ROLLED_BACK
FAILED
CANCELLED
BLOCKED
```

## Parallel behavior

After `code.generated`, Reviewer and Tester may execute concurrently when their permissions allow it.

## Repair behavior

```text
review/test failure
  ↓
Supervisor
  ↓
Repair
  ↓
Reviewer
  ↓
Tester
```

Maximum repair attempts: 2–3.

## Acceptance Criteria

- State transitions are persisted.
- Invalid transitions are rejected.
- Agent failures become visible task states.
- Approval cannot be bypassed.
- Cancellation is supported.
