# Phase 15 — Advanced Agent Orchestration Audit

## Status

BLOCKED

## Implemented foundation

- Added explicit bounded definitions for the existing Planner, Coder, Reviewer, Tester, and Repair specialists.
- Added `OrchestrationSupervisor`, a deterministic policy that selects one of `BUG_FIX`, `REFACTOR`, `SECURITY`, or `TEST_GENERATION` from persisted task/project input.
- The supervisor selects only the existing safe mutable-workspace order: Planner → Coder → Reviewer → Tester. It does not invent a graph, commands, lifecycle states, or permissions.
- `RuntimeExecutor` now records an actual completed `SUPERVISOR` agent run and safe event metadata (strategy, selected stages, and bounded provider/attempt budgets) before it starts `CoreAgentPipeline`. The selected plan is returned in `RuntimeExecutionResult`.
- Existing lifecycle, workspace isolation, command execution, approval, repair, and delivery remain authoritative and unchanged.
- Phase 15A (`5b8a4b8`) added real read-only `SECURITY_REVIEWER` and provider-backed `TEST_GENERATOR` pipeline stages. Test generation reuses the existing structured Coder output and workspace edit policy; its generated tests run through Reviewer and Tester.

## Why this is not PASS

The specialist-stage blocker is resolved, but the final Phase 15 acceptance remains incomplete: cancellation is not a RuntimeExecutor execution control; overall/stage timeouts and persisted enforcement of the advertised supervisor budgets do not exist; strategy provenance is not stored in Phase 14 evaluation results; restart/resume does not avoid rerunning already completed specialist stages. These are implementation gaps, not environment notes.

## Tests

- `pnpm --filter @codexflow/agents typecheck` — PASS
- `pnpm --filter @codexflow/agents test` — PASS (19 tests)
- `pnpm --filter @codexflow/runtime typecheck` — PASS
- `pnpm --filter @codexflow/runtime test` — PASS (13 tests, 2 external E2Es skipped)
- `pnpm --filter @codexflow/agents lint` — PASS
- `pnpm --filter @codexflow/runtime lint` — PASS
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS

## Required next work

Define and persist actual specialist stage contracts (at minimum SecurityReviewer and TestGenerator), add validated lifecycle-compatible execution strategies, then run full Phase 13/14 regression before Phase 15 can pass. Phase 16 must wait for that completion.
