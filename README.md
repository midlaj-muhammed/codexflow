# CodexFlow

CodexFlow is a web-based mission control system for AI coding agents. It manages the controlled path from a repository task through an isolated worktree, verification, human approval, and a pull request.

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

The project is intentionally being built phase-by-phase. See [the roadmap](docs/roadmap.md) and [architecture](docs/architecture.md).
