# CodexFlow

### AI coding agents. Under control.

CodexFlow is a GitHub-native control plane for AI coding agents. It plans,
executes, reviews, verifies, approves, and safely delivers software changes
without giving an agent unchecked access to a developer's primary branch.

## Live application

**[Open CodexFlow on Vercel](https://codexflow-web.vercel.app/)**

The Vercel deployment serves the public UI and control-plane routes. Full task
execution requires a persistent Node runtime with the Git CLI, durable SQLite
storage, and durable project/worktree roots; see [Deployment](#deployment) for
the supported Docker/Render topology.

## Repository

**[github.com/midlaj-muhammed/codexflow](https://github.com/midlaj-muhammed/codexflow)**

## What is CodexFlow?

AI coding agents can edit a repository, but that alone does not establish what
was changed, whether it was tested, or whether it is safe to deliver. CodexFlow
puts a persisted, auditable control plane around that work:

```text
Task → plan → isolated worktree → code → review → test → bounded repair
     → evaluation/risk → human approval → commit → push → GitHub PR
     → SHA reconciliation
```

The system is intentionally GitHub-only. It does not present GitLab or
Bitbucket as supported product integrations.

## Why CodexFlow?

- **Agents work in isolation.** Task changes are made in a Git worktree, not
  directly in the source checkout or protected branch.
- **Verification is executable evidence.** Tester records actual command
  results; an agent cannot simply assert that a test passed.
- **Approval is enforced by the backend.** A browser request cannot fabricate
  an approval, workspace, fingerprint, or delivery state.
- **Delivery is durable.** Commit, push, and pull-request checkpoints are
  persisted and reconciled after interruption.
- **GitHub state is checked independently.** Delivery succeeds only when:

  ```text
  delivery commit SHA = remote branch SHA = GitHub PR head SHA
  ```

## Core workflow

```text
Developer
   │
   ▼
Select or import a project ──► Scan project ──► Create a persisted task
                                                  │
                                                  ▼
                                      OrchestrationSupervisor
                                                  │
                                                  ▼
Planner → Coder → applicable specialist → Reviewer → Tester
                                                       │
                                      verification fails? ──► bounded Repair
                                                       │
                                                       ▼
                                              Evaluation and risk
                                                       │
                                                       ▼
                                            READY_FOR_APPROVAL
                                                       │
                                                       ▼
                                               Backend approval
                                                       │
                                                       ▼
                                      Commit → push → GitHub PR → SHA check
```

## Product architecture

```text
┌────────────────────────────────────────────────────────────────┐
│ Developer                                                        │
│   Next.js web UI: projects, tasks, runs, approvals, delivery     │
└───────────────────────────────┬────────────────────────────────┘
                                │ HTTP / persisted control-plane state
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ Control plane                                                    │
│ Projects · Tasks · Evaluation · Approval · Delivery · Operations │
└───────────────────────────────┬────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ RuntimeExecutor                                                  │
│ leases · lifecycle · cancellation · timeouts · persistence       │
└───────────────────────────────┬────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ OrchestrationSupervisor                                          │
│ BUG_FIX · REFACTOR · SECURITY · TEST_GENERATION                  │
└───────────────────────────────┬────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ CoreAgentPipeline                                                │
│ Planner → Coder → specialist → Reviewer → Tester → Repair        │
└───────────────────────────────┬────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────┐
│ Isolated Git worktree → verification → approval → DeliveryService│
│                         GitEngine → GitHubProvider → GitHub PR   │
└────────────────────────────────────────────────────────────────┘
```

`RuntimeExecutor` remains the execution authority. The supervisor selects a
deterministic strategy and bounded policy; it is not a second runtime or a
separate lifecycle engine.

## Agent architecture

| Role                    | Actual responsibility                                                                | Permission boundary                                |
| ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Planner                 | Builds a typed plan from the task and detected project metadata.                     | Read-only repository context.                      |
| Coder                   | Requests validated structured edits from the configured provider and applies them.   | Writes only through the workspace edit policy.     |
| SecurityReviewer        | Reads the isolated diff and reports high-severity sensitive-file findings.           | Read-only; no commands or edits.                   |
| TestGenerator           | Requests focused test edits through the existing structured Coder provider boundary. | Same safe isolated edit policy as Coder.           |
| Reviewer                | Evaluates the diff and emits review findings.                                        | Read-only.                                         |
| Tester                  | Runs detected verification commands and records output, exit code, and duration.     | Controlled command execution in the task worktree. |
| Repair                  | Applies provider-backed repairs after verified failure, within the repair limit.     | Safe edits and limited verification.               |
| OrchestrationSupervisor | Selects strategy, verification policy, and bounded execution metadata.               | Control flow only.                                 |

Provider output is parsed as a structured `CoderModelOutput` before edits are
written. Invalid output, unsafe paths, provider failures, timeouts, and
cancellation become persisted failures rather than successful stages.

## Orchestration strategies

Strategy selection is deterministic and uses the persisted task prompt plus
project metadata.

| Strategy          | Trigger class                                                           | Specialist execution                                                                |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `BUG_FIX`         | Default bug/change request.                                             | Planner → Coder → Reviewer → Tester → bounded Repair when verification requires it. |
| `REFACTOR`        | Refactor, rename, or restructuring request.                             | Same core path; verification policy includes lint and build when available.         |
| `SECURITY`        | Security, authentication, credential, or permission request.            | Adds the read-only SecurityReviewer before final reviewer/tester outcome.           |
| `TEST_GENERATION` | Request to add/generate tests, coverage, specs, or regression coverage. | Adds provider-backed TestGenerator after Coder and before review/test.              |

The pipeline records the stages actually executed. A specialist is not reported
as executed just because its strategy was selected.

## Task lifecycle

The runtime validates lifecycle transitions rather than allowing the UI to set
arbitrary state.

```text
CREATED → QUEUED → PLANNING → CONTEXT_READY → CODING → REVIEWING
        → TESTING → READY_FOR_APPROVAL → APPROVED → APPLIED
```

Verification can enter `REPAIRING`, which returns to review/test or ends in
`BLOCKED` when the repair bound is reached. Terminal states defined by the
lifecycle include `REJECTED`, `ROLLED_BACK`, `FAILED`, `CANCELLED`, and
`BLOCKED`.

Cancellation, per-stage timeouts, an overall execution timeout, provider
request limits, repair limits, and execution leases are enforced by the
backend. On recovery, completed specialist AgentRuns are used to avoid blindly
re-executing a durable completed stage; crash boundaries remain honestly
at-least-once where a provider operation completed before persistence.

## Execution and workspace isolation

```text
Managed source checkout
        │
        ▼
Task-specific Git worktree
        │
        ▼
Agent edits, review, and verification
        │
        ▼
Diff / fingerprint / risk evidence
        │
        ▼
Approval and delivery
```

Before a worktree is created, CodexFlow checks that the source repository is
clean, attached to a branch, and conflict-free. The worktree captures its
baseline commit and receives a task branch. The source checkout is not the
agent's edit target.

The workspace policy rejects absolute paths, path traversal, `.git`, `.env`,
and PEM/key writes. Sensitive paths and protected branches are further checked
before delivery. Git operations use argument-array process execution rather
than shell interpolation.

## Verification and repair

Project metadata identifies supported commands from actual project files. The
Tester runs the verification plan in the task worktree and persists command,
status, exit code, safe output, and duration. Depending on the selected policy,
this can include tests, lint, and build commands that were actually detected.

Failed verification may enter the existing bounded repair loop. Repair does
not erase security findings or allow an unverified result to reach approval.

## Human approval

No agent can automatically deliver a change. A task must reach
`READY_FOR_APPROVAL`, then backend approval validates the current workspace,
diff fingerprint, risk snapshot, and verification state. Relevant workspace
changes invalidate approval evidence. The client is not trusted to supply a
commit SHA, branch, PR number, workspace location, risk level, or approval
outcome.

## Git and GitHub delivery

`DeliveryService` performs a durable saga:

```text
APPROVED → committed → pushed → pull request created → reconciled
```

Its checkpoints include persisted commit, push, and pull-request attempts.
Recovery reconciles remote state and avoids duplicate delivery where existing
records prove a completed boundary. PR refresh also checks remote state.

CodexFlow's required invariant is:

```text
Delivery Commit SHA
        =
Remote Branch SHA
        =
GitHub Pull Request Head SHA
```

A mismatch is a delivery failure condition; it is not softened for an E2E or
user-interface convenience. The GitHub integration also includes repository
and branch retrieval, PR retrieval, check visibility, controlled feedback
capability, and a provider-boundary webhook-signature verification utility.

### Pull-request content

PR titles and bodies are generated from persisted task and execution evidence.
When available, they include the task, changed files, verification results,
review notes, risk/change information, executed stages, and delivery metadata.
Unavailable values are omitted rather than fabricated.

## GitHub authentication and repository workflow

CodexFlow implements a server-side GitHub OAuth authorization-code flow:

```text
Browser → /auth/github → GitHub authorization → /auth/github/callback
        → server-side code exchange → encrypted server-side session
        → authenticated repository API
```

The OAuth client secret and access token are never placed in browser storage or
URLs. The state and session cookies are HTTP-only, `SameSite=Lax`, and marked
secure in production. Access tokens are AES-GCM encrypted before persistence.

When configured with a GitHub App client ID, CodexFlow lists repositories from
the user's app installations rather than presenting repositories the app cannot
clone. The app must be installed on the selected repository and have
**Repository contents: Read and write** for managed clone/push, plus **Pull
requests: Read and write** for PR delivery. GitHub App user tokens use the
intersection of user and app permissions; traditional OAuth `repo` scopes do
not expand them.

After sign-in, `/api/github/repositories` obtains repository identity from the
authenticated session; `/api/github/import` creates a managed clone using the
GitHub provider and Git engine. A user does not need to type a server filesystem
path for the GitHub repository workflow.

**Deployment qualification:** OAuth code is implemented, but it requires
`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and
`CODEXFLOW_SESSION_SECRET` on a compatible persistent host. The Vercel public
deployment is not a supported full execution host. Validate OAuth and managed
cloning on the persistent runtime after configuring its production callback
URL.

## Local project workflow

In supported Chromium-family browsers, the local-project UI uses the File
System Access directory picker. It imports the selected files into a
server-managed project directory; it does **not** pretend the server can access
the browser's original absolute path.

During import, client and server filtering exclude common unsafe or unnecessary
paths, including `node_modules`, `.git`, `dist`, `build`, `coverage`, `.env`
and `.env.*`, `credentials.json`, secret-named files, and PEM/key files. The
managed project is initialized as a safe Git snapshot, then task agents still
receive separate isolated worktrees.

The scanner detects supported JavaScript/TypeScript project metadata such as
package manager, framework indicators, source/test directories, and scripts
explicitly declared in `package.json`. Project health executes detected lint,
test, and build checks through the existing Tester boundary. It does not invent
a start command for projects that have not declared one.

This workflow needs a persistent runtime to retain imported projects and run
Git/worktree execution. It cannot perform full agent work on standard Vercel
serverless functions.

## Evaluation system

The evaluation package supplies a persisted benchmark catalogue, benchmark
tasks, evaluation runs, and execution provenance. The starter catalogue has
twelve deterministic local task fixtures. Evaluation records can include the
selected strategy, planned/executed stages, specialist outcomes, lifecycle
outcome, review/test outcome, repair attempts, duration, and diff statistics.

Metrics are calculated only from persisted evaluation runs: Pass@1, Pass@N
where meaningful, technical success, repair and repair-success rates, blocked
rate, verification-failure rate, regression rate, retries, duration, and diff
statistics. No aggregate benchmark, token, or cost number is asserted when no
persisted data supports it.

## Operations and observability

- `GET /api/health` reports basic web-service health.
- `GET /api/readiness` confirms the control-plane store is available and
  returns execution-lease state.
- `GET /api/operations` derives task state counts, AgentRun failures, and lease
  information from persisted state.

Structured logs and event payloads are redacted. Operations data is backend
state, not synthetic dashboard telemetry. Stale execution leases are reclaimed
only when the persisted lease is expired.

## Security model

| Area        | Control                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Credentials | Server-only environment variables; redacted logs and no token storage in browser JavaScript.                                 |
| Agent edits | Structured edit validation plus path traversal, `.git`, `.env`, PEM/key, and sensitive-file restrictions.                    |
| Commands    | Policy-limited command execution, bounded timeouts, abort propagation, safe output handling, and isolated working directory. |
| Git         | Dirty/detached/conflicted source checks, protected-branch safety, worktrees, and destructive-command restrictions.           |
| Approval    | Backend-enforced, persisted, fingerprint- and evidence-bound approval.                                                       |
| Delivery    | Persisted saga, remote reconciliation, and mandatory commit/branch/PR SHA equality.                                          |
| Recovery    | Execution leases, cancellation, timeouts, bounded retries, and persisted AgentRun recovery.                                  |

Git is one layer of the safety model; it is combined with isolation, policy,
verification, approval, persistence, and GitHub reconciliation.

## Data model

The SQLite control-plane store persists the core domain without creating a
parallel runtime database. Major records include:

| Record                                                  | Purpose                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| Repository and Project                                  | Managed source repository and detected project metadata.             |
| Task and Workspace                                      | Prompt, lifecycle state, task worktree, branch, and baseline commit. |
| AgentRun and AgentEvent                                 | Stage attempts, status, timestamps, safe errors, and events.         |
| Plan, Review, TestPlan, and TestRun                     | Planning, review findings, and actual verification evidence.         |
| Approval                                                | Backend approval/rejection evidence.                                 |
| DeliveryCommit, DeliveryPush, and DeliveryPullRequest   | Durable commit/push/PR checkpoints and reconciliation data.          |
| Evaluation, Benchmark, BenchmarkTask, and EvaluationRun | Reproducible evaluation results and provenance.                      |
| Task execution lock                                     | Cross-process execution ownership and stale-lease recovery.          |

When `DATABASE_URL` is a PostgreSQL URL, it is used specifically for encrypted
GitHub OAuth session persistence (`codexflow.github_sessions`). It does not
replace the SQLite control-plane store; production task state remains at
`CODEXFLOW_DATABASE_PATH`.

## API/control-plane areas

The Next.js API groups production routes around:

- **Repositories and projects:** repository listing/import, local import,
  project health, and publication.
- **Tasks and execution:** task creation/detail, execute, cancel, and persisted
  execution evidence.
- **Approval and delivery:** approve, reject, and pull-request refresh.
- **GitHub:** connection status, OAuth-backed repository listing, and managed
  import.
- **Evaluation and operations:** persisted evaluation data, health, readiness,
  and operations snapshots.

Requests are validated at the server boundary and mapped through the existing
safe API error contract. Runtime, worktree, Git, credentials, approval, and
delivery authority remain on the backend.

## Project structure

```text
codexflow/
├── apps/
│   └── web/                 # Next.js UI, API routes, OAuth routes
├── packages/
│   ├── agents/              # pipeline roles and deterministic supervisor
│   ├── database/            # SQLite store and migrations
│   ├── delivery/            # durable Git/GitHub delivery saga
│   ├── evaluation/          # benchmark and evaluation runner
│   ├── git/                 # Git CLI boundary
│   ├── providers/           # OpenAI Responses and GitHub provider boundary
│   ├── runtime/             # lifecycle, leases, execution controls
│   ├── shared/              # shared schemas and domain types
│   └── workspace/           # isolated worktree manager
├── docs/
│   ├── audits/              # phase evidence and final audits
│   ├── deployment/          # persistent-host deployment guides
│   ├── architecture.md
│   ├── security.md
│   ├── evaluation.md
│   └── demo.md
├── Dockerfile               # persistent Node + Git runtime image
├── .env.example
├── pnpm-workspace.yaml
└── package.json
```

## Technology stack

| Layer                     | Technology                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| Web and API               | Next.js 16, React 19, TypeScript                                         |
| Monorepo                  | pnpm 11 and Turborepo                                                    |
| Domain validation         | Zod                                                                      |
| Control-plane persistence | Node SQLite (`node:sqlite`)                                              |
| OAuth session persistence | SQLite by default; PostgreSQL/Supabase when `DATABASE_URL` is configured |
| Agent provider            | Structured OpenAI Responses provider                                     |
| Git and delivery          | Git CLI, GitEngine, GitHubProvider, GitHub REST API                      |
| Testing                   | Vitest and Playwright                                                    |
| Persistent-host packaging | Docker; [Render deployment guide](docs/deployment/render.md)             |

## Getting started

### Requirements

- Node.js 24 (the supplied Docker image uses Node 24)
- pnpm 11.25.0
- Git CLI for project cloning, worktrees, and delivery
- An OpenAI API key for real provider-backed task execution
- A durable filesystem for production project/worktree paths

Clone and install:

```bash
git clone https://github.com/midlaj-muhammed/codexflow.git
cd codexflow
pnpm install
cp .env.example .env
```

Configure only the values needed for your environment in the ignored `.env`
file, then start development:

```bash
pnpm dev
```

The application is served by the web app (normally at `http://localhost:3000`
in development).

## Environment variables

Start with [`.env.example`](.env.example). It contains placeholders only;
never commit real values.

| Variable                     | Required when                          | Purpose                                                                                |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`       | Optional                               | Public application name; no secret belongs in this variable.                           |
| `OPENAI_API_KEY`             | Running real provider-backed tasks     | Server-only OpenAI credential for RuntimeExecutor.                                     |
| `CODEXFLOW_DATABASE_PATH`    | Durable production deployment          | SQLite control-plane database location.                                                |
| `CODEXFLOW_PROJECT_ROOT`     | Durable production deployment          | Root for managed source projects.                                                      |
| `CODEXFLOW_WORKSPACE_ROOT`   | Durable production deployment          | Root for task worktrees.                                                               |
| `CODEXFLOW_GITHUB_TOKEN`     | A configured delivery flow requires it | Server-managed GitHub delivery credential.                                             |
| `GITHUB_OAUTH_CLIENT_ID`     | Interactive GitHub sign-in             | GitHub OAuth app client ID.                                                            |
| `GITHUB_OAUTH_CLIENT_SECRET` | Interactive GitHub sign-in             | GitHub OAuth app client secret; server-only.                                           |
| `CODEXFLOW_SESSION_SECRET`   | Interactive GitHub sign-in             | Long random server-side session/encryption secret.                                     |
| `CODEXFLOW_PUBLIC_URL`       | OAuth behind a reverse proxy           | Exact public GitHub-registered origin; prevents use of an internal listener URL.       |
| `GITHUB_APP_SLUG`            | GitHub App OAuth deployments           | Public GitHub App slug used to open the install flow when no installation exists.      |
| `GITHUB_APP_INSTALL_URL`     | GitHub App OAuth deployments           | Optional explicit GitHub App install URL; overrides the slug-derived URL.              |
| `DATABASE_URL`               | PostgreSQL-backed OAuth sessions       | PostgreSQL/Supabase connection URL for encrypted OAuth session rows only.              |
| `CODEXFLOW_REAL_OPENAI_E2E`  | Real OpenAI E2E                        | Explicit opt-in for the external provider suite.                                       |
| `CODEXFLOW_GITHUB_E2E_*`     | Real GitHub delivery E2E               | Disposable repository, token, and workspace configuration described in `.env.example`. |

OAuth callback routes use the deployment origin:

```text
https://YOUR-PERSISTENT-HOST/auth/github/callback
```

Set production values in the host's secret environment-variable UI. Do not put
OAuth secrets, session secrets, tokens, private keys, or webhook secrets in
the repository, README, browser storage, query strings, or logs.

## Local development and testing

```bash
# Start development services
pnpm dev

# Static checks and deterministic suites
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e

# Explicit external suites; require safe disposable credentials in .env
pnpm test:openai-e2e
pnpm test:github-e2e
```

`test:openai-e2e` and `test:github-e2e` are external integrations. They must
not be treated as passing when their credentials, disposable repository, or
workspace are unavailable.

### Recorded verification evidence

The Phase 20 freeze audit records the following historical verification:

| Command                | Recorded result                                                          |
| ---------------------- | ------------------------------------------------------------------------ |
| `pnpm lint`            | PASS                                                                     |
| `pnpm typecheck`       | PASS                                                                     |
| `pnpm test`            | PASS                                                                     |
| `pnpm test:e2e`        | PASS                                                                     |
| `pnpm test:openai-e2e` | PASS — three real runtime/repair tests                                   |
| `pnpm test:github-e2e` | PASS — real commit, push, PR creation, retrieval, and SHA reconciliation |

See [Phase 20](docs/audits/phase-20.md) for the dates, qualification, and
exact external evidence. Those records are historical evidence, not a claim
that this README edit reran the suites.

## Deployment

### Vercel

The public web application is deployed at
[codexflow-web.vercel.app](https://codexflow-web.vercel.app/). Standard Vercel
functions are **not** a safe full-runtime target for CodexFlow because task
execution needs Git, managed repositories, Git worktrees, durable SQLite state,
and potentially long-running provider/verification processes. The runtime
intentionally blocks task execution when it detects the Vercel serverless
environment instead of pretending that a task ran.

Vercel can therefore host the landing/control-plane UI, but it is not the
deployment described for full repository cloning and agent execution.

### Persistent runtime on Render

This repository includes a Docker image that installs Git and starts the Next.js
web service. The supported deployment shape is one paid Render Docker Web
Service with a persistent disk mounted at `/data`:

```text
Render service (single instance)
  ├── Next.js UI and API
  ├── Git CLI
  ├── /data/codexflow.sqlite
  ├── /data/projects
  └── /data/workspaces
```

Set at least:

```text
OPENAI_API_KEY=<server-side key>
CODEXFLOW_DATABASE_PATH=/data/codexflow.sqlite
CODEXFLOW_PROJECT_ROOT=/data/projects
CODEXFLOW_WORKSPACE_ROOT=/data/workspaces
```

For OAuth-backed GitHub repository browsing, also configure
`DATABASE_URL`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and
`CODEXFLOW_SESSION_SECRET`, plus `CODEXFLOW_PUBLIC_URL`. Keep the deployment
to one disk-owning instance while the control-plane store is local SQLite.

Read the complete guide: **[CodexFlow on Render](docs/deployment/render.md)**.
It covers the Docker runtime, disk, health check, OAuth callback setup, and
operational constraints. The Docker image was smoke-built and launched locally;
an actual Render production deployment must still be verified in its own
environment.

## GitHub OAuth configuration

After a compatible persistent host has a public URL:

1. Create or configure a GitHub OAuth App in GitHub Developer Settings.
2. Set its homepage URL to the persistent host URL.
3. Set its authorization callback URL to
   `https://YOUR-PERSISTENT-HOST/auth/github/callback`.
4. Put the OAuth client ID, client secret, and a strong
   `CODEXFLOW_SESSION_SECRET` in the host's secret environment variables.
5. Redeploy and test sign-in, repository listing, import, and scan using a
   disposable repository first.

The callback is implemented at `/auth/github/callback`; the secrets are not
stored in the frontend.

## End-to-end example

For the task:

> Fix authentication handling for expired access tokens and add regression
> tests.

1. The developer imports a project or authenticates with GitHub and selects a
   repository.
2. CodexFlow scans project metadata and persists the exact task prompt.
3. The supervisor selects `SECURITY` because the request concerns
   authentication.
4. RuntimeExecutor creates an isolated worktree; Planner and Coder run.
5. SecurityReviewer examines the isolated diff, then Reviewer and Tester
   produce persisted evidence.
6. A verified failure can enter bounded Repair; a blocking security finding or
   exhausted repair bound cannot progress to approval.
7. After successful verification and risk evidence, the task reaches
   `READY_FOR_APPROVAL`.
8. The developer approves through the backend-controlled approval flow.
9. DeliveryService commits, pushes, creates/retrieves the GitHub PR, and checks
   that the delivery, remote, and PR-head SHAs match.

## Implementation history

The current final-system audit preserves the historical phase qualifications.

| Phase | Focus                                       | Status                     |
| ----- | ------------------------------------------- | -------------------------- |
| 0     | Web foundation, logging, health             | PASS WITH NOTES            |
| 1     | SQLite persistence foundation               | PASS                       |
| 2     | GitHub provider boundary                    | PASS WITH NOTES            |
| 3     | Isolated worktrees                          | PASS WITH NOTES            |
| 4     | Deterministic project scanning              | PASS WITH NOTES            |
| 5     | Runtime foundation                          | PASS                       |
| 6     | Agent-provider boundary                     | PASS WITH NOTES            |
| 7     | Core Planner/Coder/Reviewer/Tester pipeline | PASS WITH NOTES            |
| 8     | Verification and bounded repair             | PASS                       |
| 9     | Risk and backend approval                   | PASS                       |
| 10    | Durable commit/push/PR saga                 | PASS                       |
| 11    | GitHub PR SHA reconciliation                | PASS WITH ENVIRONMENT NOTE |
| 12    | Delivery hardening and real GitHub E2E      | PASS                       |
| 13    | Runtime/control-plane external execution    | PASS                       |
| 14    | Persisted evaluation                        | PASS                       |
| 15    | Strategy-aware specialist orchestration     | PASS                       |
| 16    | GitHub PR intelligence                      | PASS                       |
| 17    | Operations and readiness                    | PASS                       |
| 18    | Product integration and documentation       | PASS                       |
| 19    | Final hardening                             | PASS                       |
| 20    | Product freeze and external revalidation    | PASS                       |

See [Final System Audit](docs/FINAL-SYSTEM-AUDIT.md) and the individual
[`docs/audits`](docs/audits) for exact commits and historical evidence.

## Known limitations

1. GitHub is the only supported external Git provider.
2. Full repository cloning, worktrees, and agent execution require a
   persistent runtime with Git and durable storage; standard Vercel serverless
   functions are intentionally blocked from running tasks.
3. Browser directory import relies on the File System Access API, so it is most
   suitable for Chromium-family browsers; imported code is transferred to a
   managed server workspace.
4. OAuth and external GitHub/OpenAI E2Es require explicitly configured,
   disposable credentials and workspaces. They are environment-gated, not
   implicit test prerequisites.
5. GitHub E2E branches are single-use because historical PR reconciliation is
   intentionally enforced.
6. Evaluation metrics, provider token data, and costs exist only when actual
   persisted runs provide them; unavailable values are not represented as zero.
7. Provider calls cannot guarantee exactly-once behavior across a crash that
   occurs after external completion but before durable stage persistence.
8. A receiving webhook deployment must separately configure its GitHub webhook
   secret; the repository supplies verification utility code, not a hosted
   webhook service configuration.

## Deferred scope

The roadmap intentionally does not include GitLab, Bitbucket, desktop/Electron,
mobile, billing, enterprise RBAC, Kubernetes, or vector databases.

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Evaluation](docs/evaluation.md)
- [Demo workflow](docs/demo.md)
- [Render deployment](docs/deployment/render.md)
- [Final product report](docs/FINAL-PRODUCT-REPORT.md)
- [Final system audit](docs/FINAL-SYSTEM-AUDIT.md)

## Contributing

1. Create a branch from `main`.
2. Make a focused change without bypassing runtime, workspace, approval, or
   delivery controls.
3. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; run relevant E2Es only
   with safe configured environments.
4. Open a pull request with evidence for the behavior changed.

## License

License: **not currently specified**. No license has been added or inferred by
this documentation.
