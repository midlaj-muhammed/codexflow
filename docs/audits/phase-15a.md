# Phase 15A — Specialist Stage Contracts

## Status

PASS WITH ENVIRONMENT NOTE

## Implementation

- `SecurityReviewerAgent` is a read-only specialist stage. The `SECURITY` strategy invokes it through `CoreAgentPipeline`; high-risk findings prevent the pipeline from reaching approval.
- `TestGeneratorAgent` reuses `CoderAgent`'s structured, validated workspace edit boundary. It is invoked only when `OrchestrationSupervisor` selects `TEST_GENERATION`.
- `TEST_GENERATOR` is a real pipeline stage between Coder and Reviewer. Its provider output is validated through the existing `StructuredCoderProvider` contract before the existing workspace safety policy writes files.
- Both specialists use existing typed pipeline events, RuntimeExecutor AgentRun persistence, EventBus forwarding, task lifecycle, isolated workspaces, Reviewer, and Tester. No lifecycle state, provider client, workspace writer, approval path, or delivery path was added.

## Deterministic Evidence

- TestGenerator integration test writes a generated test file through the safe edit mechanism and proves stage order: Planner → Coder → TestGenerator → Reviewer → Tester.
- Generated tests are then executed by the real Tester command.
- SecurityReviewer tests prove clean and sensitive-diff outcomes without workspace mutation.

## External E2E

Not run in this focused change. The existing real OpenAI E2E infrastructure is environment-gated; deterministic specialist tests use an explicit provider boundary and do not claim an external-provider result.

## Regression

- `pnpm --filter @codexflow/agents test` — PASS (21 tests)
- `pnpm --filter @codexflow/runtime test` — PASS
- `pnpm --filter @codexflow/evaluation test` — PASS

## Security

TestGenerator uses the same path traversal, `.env`, `.git`, key, and credential restrictions as CoderAgent. SecurityReviewer has no write or execute capability. No secrets are added to stage results or event payloads.

## Limitation

The real provider-specific TestGenerator E2E was not rerun in this focused implementation. This is an environment-verification note, not a mocked external PASS. Phase 15 overall still requires full strategy/budget/cancellation coverage and full regression evidence.
