# CodexFlow

**AI coding agents. Under control.** CodexFlow is a developer control plane for AI coding work: it coordinates planning, coding, review, verification, bounded repair, human approval, and GitHub delivery without giving agents direct access to the primary checkout.

> Status: release-candidate source for a persistent Node.js host. The full runtime is **not compatible with standard Vercel serverless**; see [the deployment assessment](docs/deployment/vercel.md). A Docker-based [Render deployment guide](docs/deployment/render.md) is available for the complete Git/worktree runtime.

## How it works

```text
Developer → CodexFlow Web/API → RuntimeExecutor → OrchestrationSupervisor
                                             ├─ Planner / Coder / Reviewer / Tester / Repair
                                             ├─ SecurityReviewer / TestGenerator
                                             ↓
                                      isolated Git worktree → verification
                                             ↓
                                   human approval → durable GitHub PR delivery
```

The dashboard reads persisted lifecycle state, agent runs, reviews, tests, evaluations, approvals, and delivery checkpoints. It is never authoritative for approval, credentials, Git operations, or lifecycle transitions.

## Capabilities

- Managed GitHub checkouts, local-project import, project scanning, and health checks.
- Deterministic `BUG_FIX`, `REFACTOR`, `SECURITY`, and `TEST_GENERATION` strategies.
- Actual lint, test, typecheck, and build command execution with persisted evidence.
- Isolated worktrees, sensitive-path protection, command policy, leases, timeouts, cancellation, and backend approval.
- Durable commit/push/PR delivery with `delivery commit SHA = remote branch SHA = PR head SHA` reconciliation.
- Persisted evaluation provenance, benchmark metrics, readiness, and operations data.

Lifecycle states include `CREATED → QUEUED → PLANNING → CONTEXT_READY → CODING → REVIEWING → TESTING → REPAIRING → READY_FOR_APPROVAL → APPROVED → APPLIED`, plus truthful terminal states such as `FAILED`, `CANCELLED`, `REJECTED`, and `BLOCKED`.

## Local and GitHub workflows

Chromium-based browsers can select a local folder through the File System Access API. CodexFlow copies allowed source files into a managed project source, excludes sensitive/build/dependency paths, and creates separate task worktrees—never modifying the original folder.

GitHub is the only supported external Git provider. The codebase contains server-side OAuth/session routes from the prior onboarding implementation, but they are **not deployed or production-verified** until a compatible host and callback URL are configured. Do not regard OAuth as operational merely because routes are present.

## Requirements and installation

- Node.js 24, pnpm/Corepack, and Git CLI
- Persistent writable disk for SQLite, repositories, and worktrees
- OpenAI and GitHub credentials only for the optional real integrations

```bash
git clone <your-repository-url>
cd CodexFlow
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

The Next.js application is `apps/web`. Build with `pnpm build`; run production web with `pnpm --filter @codexflow/web start` on a persistent Node host.

## Environment

All credentials are server-only and must never be committed, logged, added to browser storage, or included in URLs.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Real OpenAI provider execution. |
| `CODEXFLOW_DATABASE_PATH` | Writable persistent SQLite path. |
| `CODEXFLOW_GITHUB_TOKEN` | Server-side GitHub delivery credential where configured. |
| `GITHUB_OAUTH_CLIENT_ID` | Future deployed GitHub OAuth client ID. |
| `GITHUB_OAUTH_CLIENT_SECRET` | Future deployed GitHub OAuth secret. |
| `CODEXFLOW_SESSION_SECRET` | Session-token encryption secret. |
| `CODEXFLOW_REAL_OPENAI_E2E` | Explicit opt-in real OpenAI E2E. |
| `CODEXFLOW_GITHUB_E2E_*` | Disposable GitHub E2E configuration only. |

## Testing

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:openai-e2e # configured environment only
pnpm test:github-e2e # disposable GitHub environment only
```

## Deployment and security

Read [Vercel deployment](docs/deployment/vercel.md) before choosing a host. Standard Vercel functions cannot safely host CodexFlow’s durable SQLite, Git/worktree, child-process, and long-running runtime requirements. Use a persistent Node host with Git installed for the complete control plane.

After a compatible production URL exists, configure a GitHub OAuth callback such as `https://YOUR-DOMAIN/auth/github/callback` using host-managed secrets. See [architecture](docs/architecture.md), [security](docs/security.md), and [evaluation](docs/evaluation.md).

## Limitations

- GitHub-only external Git support.
- Chromium is required for browser local-folder selection.
- Real OpenAI and GitHub E2Es need disposable configured environments.
- License: not currently specified.
