# Phase 15 — Advanced Agent Orchestration Audit

## Status

BLOCKED

## Implemented foundation

- Added explicit bounded definitions for the existing Planner, Coder, Reviewer, Tester, and Repair specialists.
- Added `OrchestrationSupervisor`, a deterministic policy that selects one of `BUG_FIX`, `REFACTOR`, `SECURITY`, or `TEST_GENERATION` from persisted task/project input.
- The supervisor selects only the existing safe mutable-workspace order: Planner → Coder → Reviewer → Tester. It does not invent a graph, commands, lifecycle states, or permissions.
- `RuntimeExecutor` now records an actual completed `SUPERVISOR` agent run and safe event metadata (strategy, selected stages, and bounded provider/attempt budgets) before it starts `CoreAgentPipeline`. The selected plan is returned in `RuntimeExecutionResult`.
- Existing lifecycle, workspace isolation, command execution, approval, repair, and delivery remain authoritative and unchanged.

## Why this is not PASS

The requested Phase 15 acceptance requires task-specific execution strategies with additional specialist execution (for example, a real security review or test-generation stage) and strategy-dependent verified execution. The current pipeline’s persisted stage/lifecycle contract has only Planner, Coder, Reviewer, Tester, and Repair. Adding new specialist execution before defining their provider, persistence, command-policy, and lifecycle contracts would be a parallel orchestration path, which the phase explicitly forbids.

The selector is therefore an auditable foundation, not a claim that `SECURITY` or `TEST_GENERATION` has run an unimplemented specialist.

## Tests

- `pnpm --filter @codexflow/agents typecheck` — PASS
- `pnpm --filter @codexflow/agents test` — PASS (19 tests)
- `pnpm --filter @codexflow/runtime typecheck` — PASS
- `pnpm --filter @codexflow/runtime test` — PASS (13 tests, 2 external E2Es skipped)
- `pnpm --filter @codexflow/agents lint` — PASS
- `pnpm --filter @codexflow/runtime lint` — PASS

## Required next work

Define and persist actual specialist stage contracts (at minimum SecurityReviewer and TestGenerator), add validated lifecycle-compatible execution strategies, then run full Phase 13/14 regression before Phase 15 can pass. Phase 16 must wait for that completion.
