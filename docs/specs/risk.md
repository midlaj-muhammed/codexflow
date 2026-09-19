# SDD: Risk Engine

## Purpose

Calculate change risk using deterministic repository signals and AI review findings.

## Inputs

- changed files
- additions/deletions
- file categories
- test/build status
- dependency changes
- configuration changes
- authentication/payment/database changes
- secret access indicators
- reviewer findings

## Risk Levels

```text
LOW
MEDIUM
HIGH
```

## Deterministic signals

Examples:

- authentication changes
- payment changes
- database schema changes
- dependency changes
- infrastructure changes
- configuration changes
- secret access
- file deletion
- large diffs
- failed tests/builds

## Principle

The LLM is not the sole risk authority.

Use deterministic rules plus AI review.

## Approval

High-risk changes require explicit human approval.

## Acceptance Criteria

- Risk is reproducible for the same inputs.
- Findings are traceable to signals.
- High-risk tasks cannot bypass approval.
- Risk is displayed beside the diff.
