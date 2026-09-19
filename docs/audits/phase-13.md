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
- Added Phase 13C real OpenAI RuntimeExecutor E2E coverage. The test is explicitly gated by `CODEXFLOW_REAL_OPENAI_E2E=1` and uses the ignored local `OPENAI_API_KEY`.
- Hardened `OpenAIResponsesProvider.runCoder()` to request strict schema-constrained JSON output from the Responses API and to parse the actual nested Responses output shape as well as the unit-test `output_text` fixture shape.
- Added bounded safe workspace context to RuntimeExecutor prompts so the real provider receives the task, plan, verification command, and selected non-secret repository files.

## Architecture Compliance

- The web app uses the existing SQLite store and Git engine through a server-only control-plane gateway.
- No new state machine, delivery service, Git abstraction, provider abstraction, or persistence layer was introduced.
- Approval remains backend-enforced. Tokens and environment values are never returned by the APIs.
- Delivery remains the Phase 10 durable delivery service; the UI only reads its persisted records.
- Runtime stage observability is callback-based inside the existing agent package so a future RuntimeExecutor can forward those truthful boundaries into the existing `EventBus` using `agent.started`, `agent.completed`, and `agent.failed`.
- `RuntimeExecutor` now performs that forwarding for real pipeline execution. It does not call `runMockWorkflow`, does not use a mock provider fallback, does not approve tasks, and does not commit, push, or create PRs.
- OpenAI credentials remain server-side only. Phase 13C tests assert the key, bearer headers, and authorization labels are absent from runtime events and persisted runtime records.

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

## Phase 13C Real OpenAI Execution

- Test file: `packages/runtime/src/openai.e2e.test.ts`.
- Command: `pnpm test:openai-e2e`.
- Provider/model: `OpenAIResponsesProvider` using the existing default model `gpt-5`.
- API key availability: `OPENAI_API_KEY configured: true` verified without printing the value.
- Actual OpenAI requests: 1.
- Fixture repository: temporary Git repository under `/tmp/codexflow-openai-e2e-*` with `src/math.js`, `tests/math.test.js`, `package.json`, and `README.md`.
- Task: update only `src/math.js` so `add(a, b)` returns the sum of the two arguments.
- Runtime path: `RuntimeExecutor.execute(taskId)` -> isolated worktree -> `CoreAgentPipeline` -> real OpenAI structured coder -> Coder -> Reviewer -> real Tester.
- Result: PASS. Final lifecycle state was `READY_FOR_APPROVAL`.
- Workspace isolation: source repository retained `return 0`; isolated task worktree contained the OpenAI-generated `return a + b` implementation.
- Verification: actual test command `node tests/math.test.js` passed and was persisted as a `TestRun`.
- Persistence: agent runs, plan, review, and test run were verified after execution.
- Secret safety: runtime events and persisted execution records were checked for absence of the API key, `Bearer `, and `Authorization`.

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
- `pnpm --filter @codexflow/agents test` — PASS: 18 tests, including stage boundary success/failure, repair callbacks, and schema-constrained OpenAI coder request coverage.
- `pnpm --filter @codexflow/runtime typecheck` — PASS.
- `pnpm --filter @codexflow/runtime test` — PASS: 12 passed, 1 skipped. Includes RuntimeExecutor success, failure persistence, missing provider, invalid state, duplicate execution, reusable agent boundary event names, and the gated OpenAI E2E file.
- `pnpm --filter @codexflow/runtime lint` — PASS.
- `pnpm --filter @codexflow/workspace test` — PASS: 2 tests.
- `pnpm --filter @codexflow/git test` — PASS: 2 tests.
- `pnpm test:openai-e2e` — PASS: real OpenAI E2E executed with 1 actual request.

## Regression Review

- Phase 10 delivery tests — PASS.
- Phase 11 provider tests — PASS through `pnpm test`.
- Phase 12 real GitHub E2E — PASS.
- No delivery, approval, GitHub, or Phase 10-12 recovery source changes were made for Phase 13C.

## Remaining Blockers

- Provider-backed automated repair is not implemented. `VerificationRepairLoop` is present, but it cannot yet re-enter `CoreAgentPipeline` with a failure-aware structured provider request and a review-before-retest lifecycle transition without adding a new pipeline path. Failed verification is truthfully persisted as `BLOCKED`; it is never reported as approval-ready.

## Final Decision

BLOCKED — Phase 13D–F are implemented and externally verified, but provider-backed repair remains a required runtime capability before the entire phase can be marked PASS.

## Next Phase Readiness

## Phase 13D — HTTP Runtime Bridge

- Commit: `881a7e4 feat: connect control plane runtime execution`.
- Added `POST /api/tasks/:id/execute`. It validates UUID input, invokes the existing server-side `RuntimeExecutor`, returns an accepted/current task snapshot, and never accepts browser-supplied edits, paths, provider configuration, or credentials.
- The server-only control-plane gateway owns a process-local execution registry only for response coalescing; `RuntimeExecutor` owns actual execution.
- Added the existing SQLite database's minimal `task_execution_locks` migration. Lease acquisition is an atomic conditional upsert, release is owner-bound, and expired leases are reclaimable. Runtime tests cover two executor instances; database tests cover acquisition/release.

## Phase 13E — Browser Runtime Control

- The existing task detail now shows **Start task** only for `CREATED`/`QUEUED` tasks and calls the execute endpoint.
- The dashboard polls persisted task records while a task is active. Agent runs, safe agent events, plan, review, tests, workspace, approval, and delivery records are reloaded after refresh; no browser-only progress state exists.
- Runtime continues to publish the existing safe `EventBus` stage events. The UI reads their persisted agent-event counterparts rather than exposing model prompts, provider headers, or credentials.
- Browser validation (headless Playwright against the running application) created a task through the rendered UI, pressed **Start task**, and observed `PLANNER`, `CODER`, `REVIEWER`, `TESTER`, and `READY_FOR_APPROVAL` on the selected task.

## Phase 13F — Approval, Delivery, and GitHub

- `RuntimeExecutor` now creates the existing fingerprint-bound `ApprovalService` request only after real review and verification complete. It calculates deterministic risk from the actual diff, review findings, and test outcomes.
- The existing approval endpoint remains server-side authoritative: it calculates the live workspace diff, approves via `ApprovalService`, then delegates to the frozen `DeliveryService`. A repeated approval request safely resumes an already-approved durable delivery.
- Final verification uses the project scan's actual test command. Repositories with no detected test command use the existing-safe `git diff --check` fallback rather than fabricating a test pass.
- Fixed an actual workspace baseline bug found by E2E: `WorkspaceManager` now persists the newly-created worktree's actual base commit, not the source checkout's potentially unrelated branch HEAD.
- Hardened `DeliveryService` to retrieve a newly-created PR when the provider supports retrieval and verify its `headSha` before recording `PR_CREATED`.
- Browser approval was exercised against the disposable repository. Persisted task `bd27f778-3918-42f0-a34b-db40d4e94186` reached `APPROVED` with delivery `PR_CREATED`; commit `b43958fe316f8ce49a671eb15092af312cf14e07` and PR [#5](https://github.com/midlaj-muhammed/codexflow-github-e2e/pull/5) have matching persisted commit/head identity.

## External Verification

- `pnpm test:openai-e2e` — PASS. Real OpenAI RuntimeExecutor test executed with one real request.
- `pnpm test:github-e2e` — PASS after creating a fresh clean disposable branch. The first run correctly blocked reuse of an old PR whose head SHA differed; that was environment state, not bypassed. The final rerun exercised creation, retrieval, and durable PR persistence.
- Browser + HTTP + OpenAI + approval + durable delivery verification — PASS against the disposable GitHub repository. It produced PR #5 above without exposing credentials.

## Final Regression

- `pnpm lint` — PASS (one pre-existing React hook-dependency warning; no lint errors).
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS.
- `pnpm test:e2e` — PASS: Playwright browser smoke suite.
- Package tests for database, runtime, workspace, agents, git, delivery, and providers — PASS through the full suite.
- `.env` is ignored. Boolean-only environment preflight confirmed OpenAI and disposable GitHub E2E configuration without reading/logging secret values. Searches found no public OpenAI/GitHub environment variable and no token persistence path.

## Final Limitation

The complete browser-to-GitHub path, approval, durable delivery, PR retrieval, persistence, and cross-process execution lease are implemented and evidenced. Automated provider-backed repair remains the sole Phase 13 blocker; test/review failures are correctly persisted and blocked instead of fabricated as success.
