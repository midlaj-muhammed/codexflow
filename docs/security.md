# CodexFlow Security Model

## Trust boundaries

The browser is a presentation and command surface. The backend owns task
lifecycle, workspaces, approval validation, provider credentials, Git, and
delivery. No browser-supplied diff fingerprint, workspace path, PR number, or
Git command is trusted.

## Workspace and edit safety

Each task uses an isolated Git worktree. Structured Coder, TestGenerator, and
Repair edits pass the same path policy: absolute paths, traversal, `.git`,
`.env`, credentials, and protected files are rejected. Agents never modify the
primary branch directly.

## Provider and event safety

OpenAI and GitHub credentials remain server-side. Structured logging redacts
secret-shaped keys. Agent events, database records, HTTP responses, audits,
and UI state contain only safe metadata; no token, authorization header, or
environment dump is persisted.

## Approval and delivery safety

Approval validates the server-derived workspace/diff fingerprint and risk
snapshot. Delivery explicitly stages approved files, reruns final verification,
rejects protected branches and sensitive files, persists checkpoints, and
requires `delivery SHA == remote branch SHA == PR head SHA`.

## Webhooks

GitHub webhook signatures are verified with HMAC-SHA256 using constant-time
comparison at the provider boundary. A deployment must configure a webhook
secret before accepting webhook traffic.
