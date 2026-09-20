# CodexFlow Vercel Deployment

## Status: not supported for the full control plane

CodexFlow is a Next.js application, so Vercel can build the web assets and route handlers. That alone is insufficient for this product. The verified runtime needs Git CLI, durable writable storage for SQLite and managed repositories, Git worktrees, child-process verification, and execution that can outlive an individual request.

Standard Vercel serverless functions have ephemeral filesystems and short-lived execution. They cannot safely preserve CodexFlow's SQLite state, worktrees, leases, imported project sources, or `RuntimeExecutor` work. Deploying the current source to Vercel would produce a potentially renderable UI while core execution and delivery are unreliable; do not use it as the full production host.

## Compatible production runtime

Deploy to a persistent Node.js host or container platform with:

- Node.js 24 and pnpm/Corepack;
- Git available on `PATH`;
- persistent writable volumes for `CODEXFLOW_DATABASE_PATH`, managed projects, and `.codexflow/workspaces`;
- sufficient bounded execution time for verification and agent runs;
- outbound access to GitHub and OpenAI; and
- a server-side secret manager.

Build with `pnpm build` and run the web service with `pnpm --filter @codexflow/web start` behind TLS/reverse proxy infrastructure.

## Environment variables

Copy `.env.example`; set values only in the host's secret manager.

- `CODEXFLOW_DATABASE_PATH` must reference a durable writable location.
- `OPENAI_API_KEY` is required only for real provider execution.
- `CODEXFLOW_GITHUB_TOKEN` is required only for delivery configurations that use it.
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and `CODEXFLOW_SESSION_SECRET` are reserved for deployed OAuth configuration. Never commit their values.

## GitHub OAuth after compatible deployment

After a compatible host supplies a production URL:

1. Create a GitHub OAuth App in GitHub Developer Settings.
2. Set its homepage URL to the deployed application.
3. Set the callback to `https://YOUR-DOMAIN/auth/github/callback`.
4. Store the client ID, client secret, and generated session secret in the host secret manager.
5. Redeploy and perform a controlled OAuth/repository-listing verification.

This document does not create an OAuth application or configure credentials.

## If Vercel is required in the future

It would require an intentional architecture change: persistent database, durable worker filesystem with Git, job queue, and a secure API boundary between Vercel and execution workers. That change is outside this deployment-preparation task.
