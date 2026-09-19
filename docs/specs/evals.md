# SDD: Evaluation System

## Purpose

Measure how reliably CodexFlow agents solve software-engineering tasks.

## Benchmark

Each benchmark contains:

```text
repository/
task.json
tests/
evaluation rules
```

Initial target: 5–10 benchmark tasks.

## Runner

```text
Benchmark
  ↓
Workspace
  ↓
Task
  ↓
Verification
  ↓
Regression Check
  ↓
Metrics
```

## Metrics

- Pass@1
- Pass@3
- success rate
- regression rate
- repair rate
- average retries
- execution duration
- files changed
- lines added
- lines removed

## Important rule

Technical success and human acceptance should be tracked separately.

## Acceptance Criteria

- Benchmark tasks can execute reproducibly.
- Real tests determine technical success.
- Results are persisted.
- Metrics are visible in the Evals UI.
