# Phase 13 Audit

## Status

BLOCKED

## Objective

Add a developer-facing control plane without replacing the existing runtime, approval, Git, or delivery boundaries.

## Implemented

- Replaced the Phase 0 placeholder with a responsive CodexFlow control-plane dashboard.
- Added server-side, SQLite-backed repository, project, and task read/write APIs.
- Repository import performs an actual local Git inspection and deterministic project scan before persisting the repository/project.
- Task detail renders only persisted task, workspace, Planner, Reviewer, agent-run, verification, approval, commit, push, and PR records. Missing records use explicit empty states rather than simulated progress.
- Added backend approval, rejection, and cancellation endpoints. Approval reads the current workspace diff server-side and delegates fingerprint validation to the existing `ApprovalService`; it does not trust a browser fingerprint.
- Added database read models for projects, repositories, tasks, workspaces, plans, reviews, and latest delivery commits.
- Added a browser E2E assertion for the new control-plane page and a database read-model unit test.
- Added Phase 13A runtime foundation contracts without implementing the executor: public SQLite persistence methods now exist for agent runs, plans, and reviews over the existing tables.
- Extended the existing `CoreAgentPipeline` with typed stage callbacks for Planner, Coder, Reviewer, and Tester. The callbacks are emitted from the real stage execution points and carry the actual stage results.
- Extended the existing repair loop with typed repair stage callbacks. No second pipeline, event bus, state machine, or database layer was introduced.
- Added Phase 13B `RuntimeExecutor` inside `packages/runtime`. It loads persisted tasks/projects/repositories, creates or reuses isolated workspaces through `WorkspaceManager`, invokes the existing `CoreAgentPipeline`, persists real stage outputs, forwards agent boundaries through the existing `EventBus`, and stops at the approval boundary.
- Extended `CoreAgentPipeline` narrowly so RuntimeExecutor can resolve structured coder output after the real planner result exists and can observe the real Git diff before review.
- Added public `agent_events` store operations over the existing table so safe stage metadata can be persisted with agent runs.

## Architecture Compliance

- The web app uses the existing SQLite store and Git engine through a server-only control-plane gateway.
- No new state machine, delivery service, Git abstraction, provider abstraction, or persistence layer was introduced.
- Approval remains backend-enforced. Tokens and environment values are never returned by the APIs.
- Delivery remains the Phase 10 durable delivery service; the UI only reads its persisted records.
- Runtime stage observability is callback-based inside the existing agent package so a future RuntimeExecutor can forward those truthful boundaries into the existing `EventBus` using `agent.started`, `agent.completed`, and `agent.failed`.
- `RuntimeExecutor` now performs that forwarding for real pipeline execution. It does not call `runMockWorkflow`, does not use a mock provider fallback, does not approve tasks, and does not commit, push, or create PRs.

## Phase 13A Runtime Foundation

- Planner stage result: existing `PlannerResult`.
- Coder stage result: validated `CoderModelOutput`, applied edits, and changed files.
- Reviewer stage result: existing reviewer verdict and findings.
- Tester stage result: actual `TesterAgent` command results plus pass/fail aggregate.
- Repair stage result: real repair attempt boundary emitted by `VerificationRepairLoop`.
- Persistence contracts: `createAgentRun`, `updateAgentRun`, `getAgentRun`, `listAgentRuns`, `createPlan`, `getPlan`, `createReview`, and `getReview`.
- Test persistence: existing `recordTestRun` and `listTestRuns` remain the authoritative verification record APIs.
- Workspace and Git diff contracts remain the existing `WorkspaceManager` and `GitEngine.diff()` APIs; neither was replaced.

## Phase 13B RuntimeExecutor

- Public API: `RuntimeExecutor.execute(taskId)`.
- Production provider: explicit `StructuredCoderProvider`, with `RuntimeExecutor.fromEnvironment(...)` constructing `OpenAIResponsesProvider` only when `OPENAI_API_KEY` is present. Missing provider configuration fails safely with `PROVIDER_NOT_CONFIGURED`.
- Workspace isolation: new execution uses `WorkspaceManager.createWorkspace(...)`; existing persisted workspaces are reused. Execution never runs directly in the primary repository path.
- Lifecycle: persisted task state is adopted into `TaskLifecycleManager` through `hydrate`, then transitions through `QUEUED`, `PLANNING`, `CONTEXT_READY`, `CODING`, `REVIEWING`, `TESTING`, and `READY_FOR_APPROVAL` when successful.
- Persistence: agent runs, agent events, plans, reviews, and test runs are written as the real stage callbacks occur.
- Failure handling: invalid task/project/repository/provider/workspace/pipeline failures return structured failed results, persist reachable lifecycle failure state, and emit safe failure events.
- Duplicate execution: prevented in-process by the executor's active task guard. Durable cross-process execution locking is not implemented in Phase 13B.
- Repair: if the existing pipeline reports `REPAIRING` or `BLOCKED`, RuntimeExecutor truthfully transitions to `BLOCKED`. Provider-backed automated repair remains future work.
- Approval boundary: successful execution stops at `READY_FOR_APPROVAL`; approval and delivery remain existing later boundaries.

## User Experience

The dashboard supports importing a local repository, deterministic project scanning, creating a persisted task, selecting task detail, inspecting persisted status/agent/test/risk/approval/delivery/PR information, and approving/rejecting/cancelling only through backend endpoints. It clearly distinguishes unavailable runtime data from completed delivery.

## Tests

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS.
- `pnpm test:e2e` — PASS: browser control-plane and health test.
- `pnpm test:github-e2e` — PASS on the disposable `codexflow/e2e-phase13` branch after the existing test was given a fresh branch. The original strict PR-head safety check correctly rejects reusing a PR from a different delivery identity.
- `pnpm --filter @codexflow/database typecheck` — PASS.
- `pnpm --filter @codexflow/database test` — PASS: 5 tests.
- `pnpm --filter @codexflow/agents typecheck` — PASS.
- `pnpm --filter @codexflow/agents test` — PASS: 17 tests, including stage boundary success/failure and repair callbacks.
- `pnpm --filter @codexflow/runtime typecheck` — PASS.
- `pnpm --filter @codexflow/runtime test` — PASS: 11 tests, including RuntimeExecutor success, failure persistence, missing provider, invalid state, duplicate execution, and reusable agent boundary event names.
- `pnpm --filter @codexflow/runtime lint` — PASS.
- `pnpm --filter @codexflow/workspace test` — PASS: 2 tests.
- `pnpm --filter @codexflow/git test` — PASS: 2 tests.

## Regression Review

- Phase 10 delivery tests — PASS.
- Phase 11 provider tests — PASS through `pnpm test`.
- Phase 12 real GitHub E2E — PASS.
- No delivery, approval, GitHub, or Phase 10-12 recovery source changes were made for Phase 13B.

## Remaining Blockers

- HTTP start/cancel endpoints are still intentionally unimplemented after Phase 13B.
- The browser is not yet connected to RuntimeExecutor, so a task created from the UI still cannot be started end-to-end from the browser.
- Real OpenAI E2E through RuntimeExecutor has not yet been executed in this phase; Phase 13B uses an explicitly injected deterministic structured coder provider for repeatable runtime tests.
- Provider-backed automated repair is not implemented; failed verification is persisted and surfaced as `BLOCKED`.
- Durable cross-process runtime execution locking is not implemented; duplicate execution prevention is currently in-process.

## Final Decision

BLOCKED — the factual control-plane/read-model layer is implemented and tested, but the required browser-driven agent execution and delivery controls cannot be truthfully marked complete without an existing-runtime orchestration API.

## Next Phase Readiness

NOT READY. The missing runtime-to-HTTP bridge must be implemented before Phase 13 can satisfy the complete developer workflow.
