# CodexFlow Architecture & SDD Documentation

This folder is the implementation documentation baseline for the CodexFlow hackathon MVP.

The documents are intentionally separated into:

- `architecture.md` — overall system architecture
- `adr/` — architecture decisions
- `specs/` — module-level software design specifications
- `data-model.md` — domain/data model
- `api.md` — API surface
- `threat-model.md` — security/threat model
- `eval-methodology.md` — evaluation methodology
- `demo-script.md` — hackathon demo script
- `roadmap.md` — implementation roadmap

These documents are based on the finalized CodexFlow product direction:

Web-first, GitHub-first, Git worktree isolation, composable agent plugins, task-based verification, real test execution, human approval, commit/push/PR lifecycle, and evaluations.

Cordis/external composable-agent harness integration is intentionally treated as an adapter rather than an unverified hard dependency.
