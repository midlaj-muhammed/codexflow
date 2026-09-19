# Phase 15 - Advanced Agent Orchestration Audit

## Status

PASS

Phase 15 runtime-control implementation and all required regression evidence pass. The initial GitHub E2E failure was confirmed as disposable-fixture drift, not an application defect: the configured branch already had a historical pull request, which intentionally did not match the new delivery commit. The stale PR was closed and the explicitly configured disposable worktree was moved to a fresh branch from `origin/main`; delivery SHA verification remained unchanged and the real E2E passed.

## Objective

Close the remaining Phase 15 blockers without redesigning Phase 15A, the deterministic `OrchestrationSupervisor`, `RuntimeExecutor`, `CoreAgentPipeline`, workspace isolation, approval, or durable delivery.

## Architecture

- `OrchestrationSupervisor` remains deterministic and still selects `BUG_FIX`, `REFACTOR`, `SECURITY`, or `TEST_GENERATION`.
- `RuntimeExecutor` now enforces the supervisor plan through provider request budgets, stage timeouts, overall execution timeouts, backend cancellation, and durable specialist-stage reuse.
- `CoreAgentPipeline` remains the execution boundary and now accepts an abort signal, per-stage timeout, and recovered completed stage results.
- No second runtime, lifecycle manager, provider abstraction, workspace editor, EventBus, approval system, delivery system, or evaluation system was introduced.

## Previous Blockers

### Blocker 1: Supervisor budgets are enforced by RuntimeExecutor

Implementation:
- `RuntimeExecutor` counts provider-backed calls (`CODER`, `TEST_GENERATOR`, `REPAIR`) against `OrchestrationPlan.maxProviderRequests`.
- Exceeding the budget raises `BUDGET_EXHAUSTED`, stops downstream execution, persists failure, emits a safe failure event, and does not request approval.

Evidence:
- Runtime test `enforces provider budgets before downstream approval`.

Status: CLOSED

### Blocker 2: Stage and overall execution timeouts are enforced

Implementation:
- `CoreAgentPipeline` wraps each stage in a bounded `runStage` with `stageTimeoutMs`.
- Stage timeout aborts the stage signal, records the AgentRun as `TIMED_OUT`, emits `agent.failed`, and prevents approval.
- `RuntimeExecutor` owns `overallTimeoutMs`; exceeding it aborts execution and returns `EXECUTION_TIMEOUT`.
- `TesterAgent.verify` accepts `AbortSignal` and passes it to subprocess execution where Node supports it.

Evidence:
- Runtime test `times out a stage and records the agent run as timed out`.
- `pnpm --filter @codexflow/runtime test` PASS.

Status: CLOSED

### Blocker 3: Backend cancellation is enforced

Implementation:
- `RuntimeExecutor.cancel(taskId)` cancels active executions through the active `AbortController`.
- Pre-execution cancellation persists `CANCELLED` through `TaskLifecycleManager`.
- Cancelled execution returns `CANCELLED`, does not create approval, and releases the execution lease.

Evidence:
- Runtime tests `cancels active execution, persists cancellation, and releases the execution lease` and `cancels a task before any agent starts`.

Status: CLOSED

### Blocker 4: Completed specialist stages are not blindly rerun after restart

Implementation:
- `RuntimeExecutor` reads durable completed `AgentRun` records for `TEST_GENERATOR` and `SECURITY_REVIEWER`.
- Recovered specialist stages are supplied to `CoreAgentPipeline.completedStages`, so those specialist stages are not started again.
- Recovered `TEST_GENERATOR` uses the actual workspace diff; recovered `SECURITY_REVIEWER` uses its persisted safe event payload.

Evidence:
- Runtime tests `reuses completed TestGenerator specialist state during resumed execution` and `reuses completed SecurityReviewer specialist state during resumed execution`.

Status: CLOSED

### Blocker 5: Evaluation strategy/stage provenance is persisted

Implementation:
- Database migration 7 adds `strategy`, `planned_stages`, `executed_stages`, and `specialist_outcomes` to `evaluation_runs`.
- `EvaluationRunner` stores selected strategy, planned stages, actual stage callbacks, and specialist outcomes from the real `RuntimeExecutionResult`.
- Existing metrics (`Pass@1`, repair rates, blocked rate, verification failure rate, duration, diff stats) remain unchanged.

Evidence:
- Evaluation test `persists specialist provenance for strategy-aware evaluation runs`.
- Database test migration count updated to 7.

Status: CLOSED

### Blocker 6: Phase 13 external/browser/OpenAI/GitHub regression results are documented

Root cause and repair:
- The prior configured E2E branch `codexflow/e2e-phase13-final-20260920` had an existing PR whose head was `a12f8a55caa6afaa6c32a7eaceff9cc75af1dedd`.
- The E2E correctly created and pushed a newer delivery commit, then `DeliveryService.createPullRequest` rejected reuse of that PR because its head SHA differed.
- GitHub retains closed PRs in `state=all`, so merely closing that old PR cannot make its branch reusable under the reconciliation policy.
- Only the disposable fixture was changed: the stale PR was closed and `/tmp/codexflow-github-e2e` was switched to the fresh disposable branch `codexflow/e2e-phase15-20260920` from `origin/main`. No application or delivery code changed.

Final evidence:
- `pnpm test:e2e` PASS.
- `pnpm test:openai-e2e` PASS.
- `pnpm test:github-e2e` PASS on the first fresh branch, then PASS again during final revalidation on a second fresh disposable branch.
- Final delivery commit SHA: `94362531e3ac14eef4f44856cca77a26f29771f8`.
- Final remote branch SHA: `94362531e3ac14eef4f44856cca77a26f29771f8`.
- Final GitHub PR #8 head SHA: `94362531e3ac14eef4f44856cca77a26f29771f8`.

Status: CLOSED

## Strategies

- `BUG_FIX`: Planner -> Coder -> Reviewer -> Tester -> bounded Repair if required.
- `REFACTOR`: Planner -> Coder -> Reviewer -> Tester -> bounded Repair if required.
- `SECURITY`: Planner -> Coder -> Reviewer -> SecurityReviewer -> Tester. Completed SecurityReviewer stages are durable and are not rerun on resume.
- `TEST_GENERATION`: Planner -> Coder -> TestGenerator -> Reviewer -> Tester. Completed TestGenerator stages are durable and are not rerun on resume.

The strategy selector was narrowed so ordinary implementation tasks that mention tests as constraints do not accidentally enter `TEST_GENERATION`; explicit test/coverage/spec generation intent still selects `TEST_GENERATION`.

## Specialist Execution

- `SecurityReviewer` remains read-only and records safe structured findings.
- `TestGenerator` remains provider-backed and applies generated tests through the existing Coder edit boundary.
- `Repair` remains provider-backed, bounded by the existing repair loop, and re-enters review and verification before approval.

## Bounds and Cancellation

- Provider request budgets are enforced.
- Stage timeout is enforced.
- Overall execution timeout is enforced.
- Backend cancellation is persisted and prevents approval/delivery.
- Execution lease is released on success, failure, timeout, or cancellation.

## Persistence

- AgentRun status now distinguishes `COMPLETED`, `FAILED`, `TIMED_OUT`, and `CANCELLED` for stage failures where applicable.
- Evaluation runs persist strategy and stage provenance.
- Specialist recovery relies on durable AgentRun plus safe AgentEvent payloads.

## EventBus

The existing `agent.started`, `agent.completed`, and `agent.failed` event pattern is reused. Timeout, cancellation, and budget failures are emitted as safe failure payloads with code/message only. No credentials, tokens, authorization headers, or provider secrets are included.

## Restart / Recovery

Deterministic recovery tests prove that completed `TEST_GENERATOR` and `SECURITY_REVIEWER` stages are not blindly rerun after persisted completion. The implementation does not claim provider exactly-once semantics for a crash before AgentRun completion; incomplete stages remain retryable according to the existing execution model.

## Evaluation

Phase 14 evaluation remains compatible and now records:

- selected strategy
- planned stages
- actual stage callbacks
- specialist outcomes
- existing success/repair/block/duration/diff metrics

## Deterministic Tests

- `pnpm --filter @codexflow/agents test` - PASS (21 tests)
- `pnpm --filter @codexflow/runtime test` - PASS (19 passed, 2 skipped external E2E gates)
- `pnpm --filter @codexflow/database test` - PASS (7 tests)
- `pnpm --filter @codexflow/evaluation test` - PASS (5 tests)
- `pnpm lint` - PASS (existing web hook warning, command exits 0)
- `pnpm typecheck` - PASS
- `pnpm test` - PASS

## Phase 13 Regression

- `pnpm test:e2e` - PASS (web Playwright health/control-plane smoke)
- `pnpm test:openai-e2e` - PASS (real OpenAI runtime and repair E2E)
- `pnpm test:github-e2e` - PASS (real commit, push, PR creation/retrieval, and SHA verification)

## Phase 14 Regression

- `pnpm --filter @codexflow/evaluation test` - PASS
- `pnpm test` - PASS
- Phase 14 metrics remain unchanged; provenance is additive.

## Phase 15A Regression

- SecurityReviewer and TestGenerator tests remain passing through `pnpm --filter @codexflow/agents test`.
- Runtime specialist recovery tests pass through `pnpm --filter @codexflow/runtime test`.

## Security Verification

- No new credential persistence was introduced.
- Timeout/cancellation/budget failures emit safe metadata only.
- TestGenerator/Repair/Coder continue using the existing workspace edit policy.
- Runtime cancellation does not bypass approval or delivery.
- GitHub delivery safety remained enforced: the stale PR mismatch was rejected, then the fresh fixture run verified `delivery commit SHA == remote branch SHA == PR head SHA`.

## Known Limitations

- Provider exactly-once execution is not claimed for crashes before AgentRun completion.
- GitHub E2E branches are intentionally single-use under all-state PR reconciliation; a rerun requires a fresh explicitly configured disposable branch after prior PR history exists.

## Final Acceptance

All six prior blockers are closed. Strategy-dependent execution, runtime controls, recovery/provenance, and browser/OpenAI/GitHub regressions have direct passing evidence. No delivery safety invariant was weakened.
