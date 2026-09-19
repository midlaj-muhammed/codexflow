# CodexFlow Data Model

## Core entities

```text
repositories
projects
workspaces
tasks
agent_runs
agent_events
plans
test_plans
test_runs
reviews
evaluations
commits
pull_requests
pull_request_comments
approvals
```

## Core relationships

```text
Repository
  ↓
Project
  ↓
Task
  ↓
Workspace
  ↓
Agent Runs
  ├── Plan
  ├── Code
  ├── Review
  ├── Test
  └── Repair
  ↓
Approval
  ↓
Commit
  ↓
Pull Request
  ↓
Evaluation
```

## Core types

```ts
type Repository = {
  id: string;
  provider: "github" | "gitlab" | "bitbucket";
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
};

type Task = {
  id: string;
  projectId: string;
  prompt: string;
  status: TaskStatus;
  riskLevel?: RiskLevel;
  createdAt: string;
};

type Workspace = {
  id: string;
  taskId: string;
  rootPath: string;
  branch: string;
  baselineCommit: string;
};

type AgentRun = {
  id: string;
  taskId: string;
  role: AgentRole;
  status: AgentStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
};
```

## Traceability requirement

A completed PR must be traceable back to:

```text
Repository
→ Task
→ Workspace
→ Agent Run
→ Verification
→ Approval
→ Commit
→ Pull Request
```
