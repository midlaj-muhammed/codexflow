# CodexFlow Final Product Report

## Product Overview

CodexFlow is a GitHub-native control plane between a developer, AI coding
agents, verification, approval, and a durable pull-request workflow.

## Architecture

Browser → Next.js control plane → RuntimeExecutor → deterministic Supervisor
→ isolated Git worktree → agent pipeline → verification → human approval →
DeliveryService → GitHub PR.

## Agent Orchestration

BUG_FIX, REFACTOR, SECURITY, and TEST_GENERATION use real persisted stages.
SecurityReviewer is read-only; TestGenerator, Coder, and Repair share the
validated structured edit policy. Provider calls, repairs, attempts, timeouts,
and cancellation are bounded.

## GitHub Integration

GitHub repository discovery, branch lookup, durable commit/push/PR delivery,
PR refresh, check visibility, controlled feedback capability, and all-state PR
reconciliation are implemented. The SHA invariant is mandatory.

## Security Model

See [security.md](security.md). Credentials are server-only; sensitive paths,
unsafe edits, protected branches, unverified approval, and mismatched PR heads
are rejected.

## Reliability

Runtime state, AgentRuns, delivery checkpoints, evaluation provenance, and
execution leases are persisted. Readiness and Operations endpoints surface
actual stored state and reclaim only expired leases.

## Evaluation

See [evaluation.md](evaluation.md). Metrics are persisted and reproducible;
this report does not invent benchmark values.

## End-to-End Verification

- Browser: PASS — `pnpm test:e2e`
- OpenAI: PASS — `pnpm test:openai-e2e` (3 real runtime/repair tests)
- GitHub: PASS — `pnpm test:github-e2e`, Phase 20 PR #11 head equals delivery
  and remote branch SHA

## Phase Results

- Phase 15: PASS — advanced strategy-aware orchestration and runtime controls.
- Phase 16: PASS — GitHub PR intelligence and remote SHA refresh.
- Phase 17: PASS — readiness, operational state, and stale-lease handling.
- Phase 18: PASS — integrated documentation, demo, and final verification.
- Phase 19: PASS — final hardening and active-runtime cancellation correction.
- Phase 20: PASS — release freeze, real OpenAI/GitHub revalidation, and final
  product audit.

## Known Limitations

GitHub is intentionally the sole supported remote provider. External E2Es need
configured disposable GitHub/OpenAI environments. Provider calls cannot claim
exactly-once semantics across a crash before durable completion persistence.

## Demo Workflow

Follow [demo.md](demo.md) to import a disposable repository, run one of four
strategies, inspect evidence, approve, and verify the GitHub PR SHA.

## Final Test Matrix

The evidence and exact commands are recorded in
[phase-20.md](audits/phase-20.md). Skipped external tests are never counted as
passing.
