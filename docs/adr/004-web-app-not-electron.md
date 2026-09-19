# ADR-004: Web Application Instead of Electron for the Hackathon

## Status

Accepted

## Context

The hackathon has limited implementation time. Electron would add desktop packaging, IPC, native filesystem handling, and distribution complexity.

## Decision

Build CodexFlow as a web-first application.

Primary workflow:

```text
Browser
  ↓
Next.js
  ↓
Backend
  ↓
Server-side Repository Workspace
  ↓
Git Worktree
```

Remote repository import is the primary MVP path.

## Deferred

- Electron
- desktop packaging
- native local-folder workflow
- desktop filesystem bridge

## Consequences

The backend owns repository workspaces during the hackathon. Direct arbitrary local-folder access from the browser is not a critical MVP requirement.
