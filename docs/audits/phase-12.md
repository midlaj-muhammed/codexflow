# Phase 12 Audit

## Status

BLOCKED — REAL GITHUB ENVIRONMENT UNAVAILABLE

## Objective

Verify and harden the production delivery runtime from approval through persisted commit, push, pull request, and restart recovery without changing Phase 10's durable delivery architecture or Phase 11's provider-neutral PR integration.

## Environment

- Local deterministic environment: available.
- File-backed SQLite: verified by delivery restart tests.
- Temporary bare Git remotes: verified by delivery integration tests.
- Dedicated disposable GitHub repository, authenticated task workspace, and opt-in E2E configuration: unavailable.

The following required variables were not jointly configured: `CODEXFLOW_GITHUB_E2E_ENABLED=true`, `CODEXFLOW_GITHUB_E2E_TOKEN`, `CODEXFLOW_GITHUB_E2E_OWNER`, `CODEXFLOW_GITHUB_E2E_REPOSITORY`, `CODEXFLOW_GITHUB_E2E_BASE_BRANCH`, `CODEXFLOW_GITHUB_E2E_WORKSPACE`, and `CODEXFLOW_GITHUB_E2E_CHANGED_FILE`. No credential values were inspected or logged.

## Implemented Hardening

- Extended the existing `approvals` table with workspace, diff fingerprint, risk snapshot, state, and approval timestamp fields.
- Added approval save/load methods to the existing SQLite store; `ApprovalService` now hydrates an approved, fingerprint-bound record after process restart.
- Persisted final verification command results in the existing `test_runs` table; PR metadata remains based on actual process results.
- Added explicit, configurable time bounds: Git commands default to 60 seconds, GitHub requests default to 30 seconds, tester commands default to 60 seconds, and agent runner timeouts now reject and persist a failed run instead of only asking the provider to cancel.
- Added delivery failure classification: `BLOCKED`, `RETRYABLE`, and `PERMANENT_FAILURE`.
- Delivery EventBus payloads now consistently include task, workspace, and branch context without including credentials.
- Preserved existing explicit staging, protected branch, sensitive path, approval fingerprint, durable delivery, and reconciliation behavior.

## Runtime and Lifecycle Validation

The delivery integration test drives the existing runtime lifecycle through `CREATED → QUEUED → PLANNING → CONTEXT_READY → CODING → REVIEWING → TESTING → READY_FOR_APPROVAL → APPROVED`, then performs durable delivery. Task state remains `APPROVED` under the existing task enum while the persisted Phase 10 delivery checkpoint advances to `PR_CREATED`; this is intentional and avoids a competing state machine.

## Recovery and Idempotency

- File-backed SQLite restart reuses the committed SHA and the persisted approval snapshot.
- Final verification run records survive reopening SQLite.
- Existing Phase 10 tests continue to verify real bare-remote push success, push failure/retry after restart, PR failure/retry after restart, and commit/push/PR reconciliation.
- Delivery retries reuse existing commits and successful pushes/PRs rather than creating duplicates.

## Observability and Failure Classification

Delivery publishes its existing EventBus events with safe task/workspace/branch context: `delivery.started`, commit/push/PR started and completed/failed events, `delivery.reconciled`, `delivery.completed`, and `delivery.blocked`.

- Missing/stale approval, sensitive paths, protected branches, failed final verification, and workspace/baseline safety failures classify as `BLOCKED`.
- Git failures and unavailable/unknown provider failures classify as `RETRYABLE`.
- Provider authentication, not-found, and validation failures classify as `PERMANENT_FAILURE`.

## Security Review

- GitHub tokens remain constructor/request scoped and are not stored in SQLite.
- Runtime delivery event payloads do not include authorization headers, tokens, environment contents, or verification stdout/stderr.
- No destructive Git command, broad staging operation, or branch-protection bypass was added.
- Approval remains bound to the SHA-256 diff fingerprint and now survives a SQLite restart.

## Tests Executed

- `pnpm --filter @codexflow/delivery test` — PASS: deterministic delivery, real local bare-remote, retry, restart, idempotency, approval, lifecycle, observability, and failure classification coverage; real GitHub E2E skipped because configuration was absent.
- `pnpm --filter @codexflow/agents test` — PASS: includes agent timeout and persisted approval hydration coverage.
- `pnpm --filter @codexflow/database test` — PASS: includes approval persistence migration coverage.
- `pnpm --filter @codexflow/providers test` — PASS: includes provider timeout and PR lookup/retrieval coverage.
- `pnpm --filter @codexflow/runtime test` — PASS.
- `pnpm --filter @codexflow/git test` — PASS.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS: all workspace package tests passed; the opt-in real GitHub E2E remained skipped.
- `pnpm test:e2e` — PASS: 1 Playwright health smoke test.

## Real GitHub E2E

BLOCKED. The opt-in E2E test is implemented in `packages/delivery/src/github.e2e.test.ts`, but no safe disposable GitHub repository/workspace configuration is available. No real repository, commit SHA, or PR URL can be truthfully reported for this phase.

## Problems Found

- Approval records were process-local and did not survive restart.
- Agent cancellation did not itself bound a provider that ignored cancellation.
- Git, provider, and tester command timeouts were not explicit at their execution boundaries.
- Delivery failures did not expose a normalized operational classification.

## Fixes Applied

- Reused and extended the existing approvals persistence model and service boundary.
- Added bounded agent execution and configurable command/request timeouts.
- Added deterministic failure classification and safe contextual runtime events.
- Added restart/lifecycle/observability regression coverage while preserving Phase 10 and 11 delivery behavior.

## Remaining Blockers

- A dedicated disposable GitHub repository, authenticated isolated workspace, and opt-in environment configuration are required to execute and verify the real external commit/push/PR/restart workflow.

## Final Decision

BLOCKED — deterministic hardening is complete, but the mandatory real GitHub E2E has not executed.
