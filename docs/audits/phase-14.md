# Phase 14 — Evaluation & Benchmarking Audit

## Status

PASS

## Objective

Provide a small, reproducible evaluation foundation that drives benchmark tasks through the existing `RuntimeExecutor` and reports only persisted execution evidence.

## Implementation

- Added the `@codexflow/evaluation` package with a versioned starter catalogue of 12 controlled local task fixtures spanning bug fixes, features, refactors, tests, validation, API behavior, dependency reuse, and regressions.
- Added persisted `benchmarks`, `benchmark_tasks`, and detailed `evaluation_runs` records to the existing SQLite store. The existing `evaluations` table remains untouched; detailed provenance needs fields it does not contain.
- Added `EvaluationRunner`, which accepts a prepared persisted task and invokes the existing `RuntimeExecutor`; it does not implement a second task runner.
- Added persisted, reproducible fields for repository commit, provider/model, lifecycle state, review and verification outcomes, repair attempts, diff statistics, duration, and safe failure text. Token usage and cost remain absent (`undefined`) when the provider does not actually expose them.
- Added metrics for Pass@1, Pass@N, technical success, repair and repair-success rates, blocked and verification-failure rates, averages, and regression rate. Human acceptance is intentionally not merged into technical success.
- Added an evaluation API/dashboard surface backed by persisted benchmark and evaluation records. The starter catalogue is installed idempotently when this surface is read.

## Evidence

- `EvaluationRunner` integration test builds a temporary Git repository, creates a persisted task, uses the existing `RuntimeExecutor` with an explicitly injected deterministic provider, applies a real worktree edit, executes the repository test command, and persists `READY_FOR_APPROVAL` evaluation evidence.
- The source repository is not modified by that integration test; the runtime workspace is isolated.
- No evaluation metric is derived from browser state or provider claims.

## Tests

- `pnpm --filter @codexflow/database test` — PASS (7 tests)
- `pnpm --filter @codexflow/evaluation lint` — PASS
- `pnpm --filter @codexflow/evaluation typecheck` — PASS
- `pnpm --filter @codexflow/evaluation test` — PASS (4 tests)
- `pnpm --filter @codexflow/web typecheck` — PASS

Full repository regression is run before the phase commit.

## Security

Evaluation records do not contain provider credentials, authorization headers, or environment values. Provider/model provenance is recorded only when supplied by the execution boundary.

## Limitations

The starter fixtures are controlled local definitions; running the full catalogue against a real provider remains an explicit evaluation operation, not an automatic dashboard side effect. Token and cost fields remain unknown unless a provider safely returns those values.
