# Phase 15 - Advanced Agent Orchestration Audit

## Status

FAIL

Phase 15 runtime-control implementation is complete, but Phase 15 cannot be marked PASS because the required explicit GitHub E2E regression failed in the configured disposable environment. The failure is delivery safety doing the right thing: an existing remote pull request for the configured branch did not reference the newly committed delivery SHA, so delivery refused to continue.

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

Evidence:
- `pnpm test:e2e` PASS.
- `pnpm test:openai-e2e` PASS.
- `pnpm test:github-e2e` FAIL: `Existing pull request does not reference the committed delivery SHA`.

Status: FAILING EXTERNAL REGRESSION

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
- `pnpm test:github-e2e` - FAIL (`Existing pull request does not reference the committed delivery SHA`)

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
- GitHub delivery safety remained enforced and blocked the mismatched-PR E2E instead of accepting an unsafe remote state.

## Known Limitations

- Provider exactly-once execution is not claimed for crashes before AgentRun completion.
- External GitHub E2E is currently failing because the configured disposable remote branch/PR state is not aligned with the newly created delivery commit.

## Final Acceptance

Implementation blockers 1-5 are closed. Phase 15 remains not PASS because blocker 6 produced a real failing GitHub E2E regression.
