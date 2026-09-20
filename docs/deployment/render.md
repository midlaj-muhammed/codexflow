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
CODEXFLOW_PUBLIC_URL=https://YOUR-RENDER-SERVICE.onrender.com
GITHUB_APP_SLUG=<your-github-app-slug>
# or:
GITHUB_APP_INSTALL_URL=https://github.com/apps/<your-github-app-slug>/installations/new
GITHUB_APP_ID=<numeric GitHub App ID>
GITHUB_APP_PRIVATE_KEY_BASE64=<base64-encoded GitHub App private key PEM>
```

`DATABASE_URL` currently persists encrypted GitHub OAuth sessions. The main
CodexFlow control-plane store remains SQLite and is persisted on `/data`.

## GitHub App permissions and installation

This deployment uses a GitHub App client ID. GitHub App user tokens are limited
to both the user's access and the repositories where the app is installed.
Before importing a private repository, install the app on the account or
organization that owns it and include that repository. Grant at least:

- **Repository contents:** Read and write — required for managed clone and
  later authenticated push.
- **Pull requests:** Read and write — required for durable PR delivery.

After changing app permissions or repository selection, accept the updated
installation permissions and reconnect GitHub in CodexFlow. Traditional OAuth
`repo` scopes do not add permissions to a GitHub App user token.

Set either `GITHUB_APP_SLUG` or `GITHUB_APP_INSTALL_URL` in Render. When a
signed-in user has authorized the app but has not installed it on any accessible
account or repository, CodexFlow will show an **Install GitHub App** action that
opens GitHub's installation flow.

Set `GITHUB_APP_ID` and either `GITHUB_APP_PRIVATE_KEY` or
`GITHUB_APP_PRIVATE_KEY_BASE64` for managed clone/import. The OAuth user token
is used for the user session and repository selection; CodexFlow mints a
short-lived GitHub App installation token for the actual Git clone so GitHub's
repository installation permissions remain authoritative. The private key is a
server-only secret and must never be committed.

Only add `CODEXFLOW_GITHUB_TOKEN` when the configured delivery flow requires
a server-managed GitHub credential. OAuth tokens are encrypted server-side and
must never be placed in browser storage.

## After deployment

1. Open the Render `onrender.com` URL and confirm the landing page loads.
2. Verify `https://YOUR-RENDER-URL/auth/github` redirects to GitHub.
3. Update the GitHub OAuth App homepage URL and callback URL, and ensure
   `CODEXFLOW_PUBLIC_URL` is exactly the same public origin (without a path):

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
