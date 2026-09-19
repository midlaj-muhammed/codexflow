# CodexFlow

CodexFlow is a GitHub-native control plane for AI coding work. It manages the
controlled path from a repository task through an isolated worktree, bounded
agent execution, real verification, human approval, and a SHA-verified GitHub
pull request.

## Golden path

```text
GitHub repository → task → RuntimeExecutor → Supervisor → specialists
→ reviewer/tester/repair → READY_FOR_APPROVAL → human approval
→ durable commit/push/PR → GitHub SHA reconciliation
```

The dashboard shows persisted plans, agent runs, verification, risk, delivery,
evaluation, and operational state. It is never authoritative for approval,
Git, provider credentials, or lifecycle transitions.

## Development

```bash
corepack pnpm install
corepack pnpm dev
```

Run quality checks with:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm format:check
```

Explicit external verification is intentionally separate from ordinary tests:

```bash
corepack pnpm test:e2e
corepack pnpm test:openai-e2e
corepack pnpm test:github-e2e
```

See [architecture](docs/architecture.md), [security](docs/security.md),
[evaluation](docs/evaluation.md), and the [demo guide](docs/demo.md).

The project is intentionally being built phase-by-phase. See [the roadmap](docs/roadmap.md) and [architecture](docs/architecture.md).
