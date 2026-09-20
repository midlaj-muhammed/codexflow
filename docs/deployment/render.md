# CodexFlow on Render

## Purpose

Render can host the complete CodexFlow control plane when it runs as one
stateful Docker web service with Git installed and a persistent disk. This is
different from standard Vercel serverless functions, which cannot safely host
managed repositories, Git worktrees, or long-running agent execution.

## Prerequisites

- A Render account and the `midlaj-muhammed/codexflow` GitHub repository.
- A paid Render web-service plan. Render persistent disks are not available on
  the free web-service plan.
- The Supabase session-pooler `DATABASE_URL` if interactive GitHub OAuth is
  enabled.
- Server-side OpenAI and GitHub credentials, entered only in Render's secret
  environment-variable UI.

## Create the service

1. In Render, select **New → Web Service** and connect the CodexFlow GitHub
   repository.
2. Select branch `main`.
3. Select **Docker** as the runtime. Render will use the repository
   `Dockerfile`, which installs Git and starts the Next.js web service.
4. Choose a paid single-instance service. A disk-backed CodexFlow service must
   not be horizontally scaled because one worktree volume belongs to one
   instance.
5. Add a persistent disk:

   - Name: `codexflow-data`
   - Mount path: `/data`
   - Size: choose a size appropriate for repositories and task worktrees.

6. Set the health-check path to `/`.
7. Create the service and wait for the Docker build and first deploy to finish.

Render supplies `PORT`; the Docker entrypoint binds Next.js to `0.0.0.0` on
that port.

## Required environment variables

Set these as Render secrets, never in the Git repository:

```text
OPENAI_API_KEY=<server-side OpenAI key>
CODEXFLOW_DATABASE_PATH=/data/codexflow.sqlite
CODEXFLOW_PROJECT_ROOT=/data/projects
CODEXFLOW_WORKSPACE_ROOT=/data/workspaces
```

For interactive GitHub login and repository browsing, also set:

```text
DATABASE_URL=<Supabase Session Pooler URL>
GITHUB_OAUTH_CLIENT_ID=<GitHub OAuth client ID>
GITHUB_OAUTH_CLIENT_SECRET=<GitHub OAuth client secret>
CODEXFLOW_SESSION_SECRET=<long random secret>
```

`DATABASE_URL` currently persists encrypted GitHub OAuth sessions. The main
CodexFlow control-plane store remains SQLite and is persisted on `/data`.

Only add `CODEXFLOW_GITHUB_TOKEN` when the configured delivery flow requires
a server-managed GitHub credential. OAuth tokens are encrypted server-side and
must never be placed in browser storage.

## After deployment

1. Open the Render `onrender.com` URL and confirm the landing page loads.
2. Verify `https://YOUR-RENDER-URL/auth/github` redirects to GitHub.
3. Update the GitHub OAuth App homepage URL and callback URL:

   ```text
   https://YOUR-RENDER-URL/auth/github/callback
   ```

4. Sign in, import a small disposable repository, and confirm it scans.
5. Create a small task and confirm its workspace is created beneath
   `/data/workspaces`.

## Operational constraints

- Keep one instance while using the local SQLite control-plane store and a
  single mounted disk.
- The disk preserves only paths beneath `/data`; source outside that mount is
  ephemeral.
- Use disposable repositories for external GitHub/OpenAI end-to-end tests.
- Do not use Render's free service for this runtime: the filesystem is
  ephemeral and task workspaces will be lost on restart.

## Troubleshooting

### `Git is unavailable in this runtime`

Confirm the Render service is using this repository's Docker runtime, not a
serverless platform or static-site service. The supplied image installs Git.

### `Structured coder provider is not configured`

Set `OPENAI_API_KEY` in Render's environment settings and redeploy. Do not put
the key in a committed `.env` file.

### Imported project disappears after restart

Confirm all three `CODEXFLOW_*_PATH/ROOT` variables point under `/data` and
that the persistent disk is attached to the same service.
