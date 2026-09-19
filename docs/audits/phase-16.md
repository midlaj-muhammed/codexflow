# Phase 16 — GitHub-Native Workflow & PR Intelligence

## Status

PASS

## Objective

Extend the existing GitHub-only delivery workflow with safe PR refresh and
GitHub check/feedback capabilities while retaining the durable delivery saga,
branch protection, approval checks, and SHA reconciliation.

## Implementation

- `GitHubProvider` now reads commit check-runs and PR comments and can post a
  bounded, explicit PR comment. It also exports constant-time GitHub webhook
  signature validation.
- `DeliveryService.refreshPullRequest` re-reads the remote PR, requires its
  head SHA to equal the persisted delivery commit SHA, persists safe remote
  status/head/refresh metadata, and exposes GitHub checks.
- Refresh is available through the existing server-side task gateway and
  dashboard. The browser never supplies a PR number or SHA.
- Existing PR title/body generation continues to use actual verification,
  risk, and changed-file data. No GitHub token, webhook secret, or raw
  credential is persisted or emitted.

## Safety

`delivery SHA == remote branch SHA == PR head SHA` remains mandatory.
The deterministic delivery test proves a moved PR head is rejected. Protected
branch, sensitive-path, approval-fingerprint, explicit staging, and durable
commit/push/PR reconciliation are unchanged.

## Tests

- `pnpm --filter @codexflow/providers test` — PASS (6)
- `pnpm --filter @codexflow/database test` — PASS (7)
- `pnpm --filter @codexflow/delivery test` — PASS (11; GitHub E2E gate skipped)
- `pnpm lint` — PASS (existing web hook warning only)
- `pnpm typecheck` — PASS
- `pnpm test` — PASS
- `pnpm test:github-e2e` — PASS (1)

## Real GitHub Evidence

Disposable repository branch `codexflow/e2e-phase16-20260920` produced delivery
commit `534ce379097214fe8cb4e1e7b7eb021d0b9929a6`. The remote branch and GitHub
PR #9 head both returned that exact SHA. No duplicate PR was created.

## Regression

Phase 15 deterministic, browser, OpenAI, approval, repair, and delivery tests
remain covered by the full test suite. The explicit Phase 15 GitHub invariant
was exercised again by the Phase 16 E2E.

## Limitations

Webhook verification is a provider boundary utility; deployment must configure
its webhook secret before exposing a receiving route. CodexFlow remains
GitHub-only by product design.
