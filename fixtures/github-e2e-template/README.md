# CodexFlow GitHub E2E fixture

This is a deliberately minimal, disposable repository template for the opt-in
CodexFlow GitHub delivery test. Do not use it for application code or secrets.

Create a disposable GitHub repository named `codexflow-github-e2e`, copy these
files into it, and make `main` its base branch. Then clone it into the local
workspace named by `CODEXFLOW_GITHUB_E2E_WORKSPACE`, create a clean non-base
task branch, and configure that branch as the E2E workspace.

The local workspace must be exactly `/tmp/codexflow-github-e2e` when using the
provided placeholder configuration, and it must be clean on a branch other
than `main` before the test runs. Its `origin` remote needs separately
configured Git write authentication (for example, an SSH remote or the local
Git credential helper). The E2E token is intentionally used only by the
GitHub REST provider; CodexFlow never writes it into a remote URL.

Create a fine-grained token restricted to this disposable repository with
repository permissions **Contents: read and write** (repository/branch access
and pushing) and **Pull requests: read and write** (create, find, and retrieve
the PR). Metadata read access is included for fine-grained repository tokens.
Do not grant administration permissions.

The E2E test appends a marker to `E2E_MARKER.md`, verifies the diff, creates a
commit, pushes only the task branch, and opens a pull request to `main`.
