# CodexFlow — Final Hackathon Implementation Plan

> **Historical planning document.** This is retained for design provenance, not
> as a statement of current supported providers or phase status. The completed
> product is GitHub-only; GitLab and Bitbucket entries below are deferred. See
> `FINAL-SYSTEM-AUDIT.md` and the Phase 19/20 audits for current evidence.

## 1. Product Definition

**CodexFlow** is a web-based mission control system for AI coding agents.

It allows developers to connect a Git repository, create coding tasks, delegate work to specialized AI agents, execute agents inside isolated Git worktrees, automatically verify their changes, review risk-aware diffs, approve or reject the result, and commit, push, and create Pull Requests.

### Core positioning

> **CodexFlow is an agent control plane sitting between the developer, Git, CI, and AI coding agents.**

This is not simply an AI coding assistant.

The product combines:

```text
AI Coding
+
Multi-Agent Orchestration
+
Composable Plugins
+
Git Worktree Isolation
+
Automated Verification
+
Risk Analysis
+
Human Approval
+
Git / Pull Requests
+
Agent Evaluation
```

---

# 2. Hackathon Strategy

The hackathon version must prioritize the complete core loop over feature quantity.

The primary goal is:

```text
Import Repository
        ↓
Create Task
        ↓
Plan
        ↓
Code
        ↓
Review
        ↓
Test
        ↓
Repair if necessary
        ↓
Review Diff
        ↓
Human Approval
        ↓
Commit
        ↓
Push
        ↓
Create PR
```

Everything else supports this workflow.

---

# 3. Platform Decision

## Web-first only

Electron/Desktop is **removed from the hackathon scope**.

Do not build:

- Electron
- Desktop packaging
- Desktop installers
- Electron IPC
- Desktop auto-updates
- Native desktop filesystem management

The product will be a web application.

### Architecture

```text
Browser
   ↓
CodexFlow Web App
   ↓
Backend / Agent Runtime
   ↓
Workspace Manager
   ↓
Git Worktree
   ↓
AI Agents
```

---

# 4. Important Web Architecture Decision

A normal browser cannot freely access arbitrary local folders like a desktop application.

Therefore, the primary hackathon workflow is:

```text
GitHub Repository
       ↓
CodexFlow Backend
       ↓
Server-side Repository Workspace
       ↓
Git Worktree
       ↓
Agent Execution
```

The primary entry point is therefore:

> **Import Repository**

Local-folder support can be added later through browser filesystem APIs or a local CLI/agent bridge.

It is **not part of the critical hackathon path**.

---

# 5. Recommended Technology Stack

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
Monaco Editor
Zustand
```

## Backend

```text
Node.js
TypeScript
Next.js API / backend services
```

## Database

```text
SQLite
```

## Git

```text
Git CLI
Git worktrees
```

## AI

```text
Codex/OpenAI adapter
Mock Agent Provider
```

## Testing

```text
Vitest
Playwright
Real repository fixtures
```

## Validation

```text
Zod
```

## Monorepo

```text
pnpm
Turborepo
```

---

# 6. High-Level Architecture

```text
                              CODEXFLOW
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
              WEB APP                         BACKEND
                 │                                 │
        ┌────────┼────────┐                ┌───────┴────────┐
        │        │        │                │                │
     Projects  Tasks     PRs          Agent Runtime     Git Engine
        │        │        │                │                │
        └────────┴────────┘                │             Worktrees
                                           │
                                  ┌────────┴─────────┐
                                  │                  │
                              Plugins             Scheduler
                                  │
             ┌────────────────────┼────────────────────┐
             │        │       │    │      │      │      │
          Planner   Coder  Reviewer Tester Repair Reporter
                                  │
                              Supervisor
                                  │
                             Integration
                                  │
                                  ▼
                         Verification / Risk
                                  │
                                  ▼
                           Human Approval
                                  │
                              Git Commit
                                  │
                              Git Push
                                  │
                              Pull Request
```

---

# 7. Composable Agent Runtime

CodexFlow should use a **composable, plugin-based runtime architecture**.

The runtime should not hardcode:

```text
planner()
→ coder()
→ tester()
```

Instead, agents should be independently registered components that communicate through typed commands and events.

### Core runtime components

```text
Runtime
├── Plugin Registry
├── Event Bus
├── Command Bus
├── Scheduler
├── Task Lifecycle Manager
├── Workspace Context
└── Agent Execution Manager
```

---

# 8. External Harness / Cordis Strategy

The Composable Agent Harness / Cordis concept remains part of the architectural direction.

However:

**Do not make CodexFlow depend directly on unverified external APIs.**

Use an abstraction:

```text
CodexFlow
    ↓
Composable Runtime Interface
    ↓
┌─────────────────────────────┐
│                             │
│ Native CodexFlow Runtime    │
│                             │
│ Optional Cordis/Harness     │
│ Adapter                     │
│                             │
└─────────────────────────────┘
```

This means CodexFlow can:

- use its own runtime initially,
- experiment with Cordis,
- replace the runtime implementation later,
- avoid breaking the entire application if the external harness changes.

The architecture should preserve the concepts of:

- plugins,
- composability,
- event-driven coordination,
- shared execution context,
- parallel agents,
- evaluation.

But do not assume undocumented APIs, UI, or benchmark capabilities.

---

# 9. Everything-is-a-Plugin Model

The major agent components should be plugins.

```text
Plugin System
│
├── Workspace Plugin
├── Planner Plugin
├── Coder Plugin
├── Reviewer Plugin
├── Tester Plugin
├── Repair Plugin
├── Reporter Plugin
├── Supervisor Plugin
└── Integration Plugin
```

Each plugin should have:

```text
name
version
capabilities
event subscriptions
commands
lifecycle hooks
permissions
```

---

# 10. Workspace Plugin

The Workspace Plugin manages the execution environment.

Responsibilities:

```text
Create workspace
Create Git worktree
Track workspace
Expose repository context
Track file changes
Clean workspace
Destroy workspace
```

Example:

```text
Repository
    ↓
Task
    ↓
Workspace
    ↓
Git Worktree
```

Example filesystem:

```text
~/.codexflow/workspaces/
└── project_123/
    ├── task_001/
    ├── task_002/
    └── task_003/
```

---

# 11. Planner Plugin

The Planner receives a task.

Input:

```text
task_created
```

Responsibilities:

- Understand task
- Inspect repository
- Identify affected files
- Determine implementation strategy
- Determine verification strategy
- Identify risks
- Identify relevant existing tests
- Decide whether new tests are required

Output:

```text
plan_ready
```

---

# 12. Coder Plugin

The Coder receives the plan.

Responsibilities:

- Modify code
- Create required tests
- Follow repository conventions
- Avoid unrelated modifications
- Work only inside its isolated worktree

Output:

```text
code_generated
```

The Coder must not directly modify the user's original working repository.

---

# 13. Reviewer Plugin

The Reviewer receives the generated changes.

Responsibilities:

- Review Git diff
- Detect bugs
- Detect security issues
- Detect unnecessary changes
- Detect hallucinated dependencies/imports
- Check architectural consistency
- Check test coverage
- Identify potential regressions

Output:

```text
review_completed
```

The Reviewer should be read-only.

---

# 14. Tester Plugin

The Tester executes **real commands**.

Examples:

```text
npm test
npm run lint
npm run build

pytest

go test

cargo test
```

The exact commands are determined by the project scanner.

The Tester produces:

```text
test_completed
```

with:

```text
exit code
stdout
stderr
duration
test results
command
```

### Critical rule

The LLM does not decide whether tests passed.

The actual process execution is the source of truth.

---

# 15. Repair Plugin

When the Reviewer or Tester finds a problem:

```text
review_failed
```

or:

```text
test_failed
```

the Supervisor can start the Repair Plugin.

Flow:

```text
Failure
   ↓
Repair
   ↓
Code Changes
   ↓
Reviewer
   ↓
Tester
```

Maximum retries:

```text
2–3 attempts
```

After repeated failure:

```text
BLOCKED
↓
Human Review
```

---

# 16. Supervisor Plugin

The Supervisor controls the workflow.

It determines:

```text
Continue?
Retry?
Repair?
Stop?
Request approval?
Mark blocked?
```

Example:

```text
test_failed
      ↓
Supervisor
      ↓
repair_required
      ↓
Repair
```

If everything passes:

```text
tests_passed
review_passed
      ↓
Supervisor
      ↓
approval_required
```

The Supervisor must not bypass human approval rules.

---

# 17. Reporter Plugin

The Reporter generates:

```text
Task summary
Changed files
Implementation summary
Tests executed
Test results
Risk summary
Commit message
PR title
PR description
```

The user can edit generated PR information before publishing.

---

# 18. Integration Plugin

Used when multiple agents work in parallel.

Responsibilities:

- Compare branches
- Detect overlapping files
- Detect conflicts
- Combine changes
- Run verification
- Suggest conflict resolutions

Parallel execution should be based on file ownership/conflict analysis.

---

# 19. Command + Event Architecture

Use a hybrid architecture.

## Commands

Commands represent explicit actions.

```text
createProject()
importRepository()
createTask()
createWorkspace()
runAgent()
cancelTask()
approveTask()
rejectTask()
rollbackTask()
commitChanges()
pushBranch()
createPullRequest()
```

## Events

Events represent state changes.

```text
project.created
project.scanned

repository.imported

task.created
task.started
task.completed
task.failed

workspace.created
workspace.ready

agent.started
agent.progress
agent.completed
agent.failed

plan.created
code.generated

review.started
review.completed

test.started
test.completed

repair.started
repair.completed

evaluation.completed

approval.required
task.approved
task.rejected

commit.created
branch.pushed

pull_request.created
pull_request.updated
```

Do not make every operation event-driven.

Use:

```text
Commands = intentional actions

Events = observations/state changes
```

---

# 20. Task State Machine

```text
CREATED
   ↓
QUEUED
   ↓
PLANNING
   ↓
CONTEXT_READY
   ↓
CODING
   ↓
REVIEWING
   ↓
TESTING
   ↓
REPAIRING ───────┐
   │             │
   └─────────────┘
   ↓
READY_FOR_APPROVAL
   ↓
APPROVED
   ↓
APPLIED
```

Terminal states:

```text
REJECTED
ROLLED_BACK
FAILED
CANCELLED
BLOCKED
```

---

# 21. Task-Based Test Strategy

This is a core CodexFlow principle.

### Every task gets a verification strategy.

But:

> **Not every task needs a new test.**

The Planner decides what verification is appropriate.

---

## Type 1 — Existing Tests

If relevant tests already exist:

```text
Task
 ↓
Identify existing tests
 ↓
Run them
```

Example:

```text
Fix login timeout
        ↓
Existing auth tests
        ↓
Run auth test suite
```

---

## Type 2 — New Task-Specific Tests

If the task introduces or changes behavior that lacks adequate coverage:

```text
Task
 ↓
Planner identifies missing coverage
 ↓
Create test plan
 ↓
Coder creates test
 ↓
Implement code
 ↓
Run test
```

---

## Type 3 — Regression Tests

For bug fixes:

```text
Bug
 ↓
Create test reproducing bug
 ↓
Implement fix
 ↓
Run regression test
 ↓
Run existing suite
```

This is especially important for demonstrating reliable agent behavior.

---

# 22. Test Plan

The Planner should produce a structured test plan.

Example:

```ts
type TestPlan = {
  verificationRequired: boolean;

  existingTests: string[];

  testsToCreate: {
    name: string;
    file: string;
    reason: string;
  }[];

  commands: string[];

  expectedBehavior: string[];
};
```

Example:

```json
{
  "verificationRequired": true,
  "existingTests": [
    "tests/auth/session.test.ts"
  ],
  "testsToCreate": [
    {
      "name": "refreshes expired session",
      "file": "tests/auth/refresh.test.ts",
      "reason": "Regression coverage for the reported timeout bug"
    }
  ],
  "commands": [
    "npm test",
    "npm run lint",
    "npm run build"
  ],
  "expectedBehavior": [
    "Expired sessions are refreshed",
    "Invalid refresh tokens are rejected"
  ]
}
```

---

# 23. Verification Pipeline

```text
Task
 ↓
Planner
 ↓
Test Strategy
 ↓
Coder
 ├── Implementation
 └── Required Tests
 ↓
Reviewer
 ↓
Tester
 ├── Existing Tests
 ├── New Tests
 ├── Lint
 └── Build
 ↓
Verification Result
```

For documentation-only tasks, verification might instead be:

```text
Markdown validation
Link validation
Formatting validation
Build validation
```

The system should choose verification based on the task.

---

# 24. Project Scanner

When a repository is imported:

```text
Repository
 ↓
Scanner
 ↓
Project Type
 ↓
Package Manager
 ↓
Test Framework
 ↓
Build System
 ↓
Lint System
 ↓
Source Structure
 ↓
Important Files
 ↓
Repository Context
```

Detect examples:

```text
Node.js
Python
Go
Rust
Java
C/C++
React
Next.js
Vue
Django
FastAPI
Express
NestJS
```

---

# 25. Git Architecture

Separate Git operations into:

## Git Engine

```text
clone
fetch
status
branch
checkout
worktree
diff
commit
push
merge
rebase
reset
```

## Git Provider

```text
authenticate
listRepositories
getRepository
listBranches
createPullRequest
getPullRequest
updatePullRequest
listPullRequestComments
getChecks
mergePullRequest
```

Providers:

```text
GitHubProvider
GitLabProvider
BitbucketProvider
```

---

# 26. Hackathon Git Scope

Implement **GitHub first**.

Primary:

```text
GitHub
```

Later:

```text
GitLab
Bitbucket
Generic Git URLs
```

Do not spend early hackathon time implementing three providers.

The provider abstraction should exist, but GitHub is the first concrete implementation.

---

# 27. Git Worktree Isolation

Never let multiple agents operate in the same working directory.

Example:

```text
Repository
   │
   ├── Task A → worktree A
   ├── Task B → worktree B
   └── Task C → worktree C
```

Example branches:

```text
codexflow/task-001
codexflow/task-002
codexflow/task-003
```

This enables safe parallel execution.

---

# 28. Git Safety

Before creating a workspace:

```text
Is Git repository?
Current branch?
Default branch?
Dirty?
Untracked files?
Merge conflict?
Detached HEAD?
```

Never blindly run:

```bash
git checkout main
git pull
git reset --hard
git clean -fd
```

The system must preserve the repository state.

---

# 29. Risk Engine

Risk must not depend solely on an LLM.

Use:

```text
Deterministic Risk Engine
+
AI Reviewer
```

Potential risk signals:

```text
Authentication changes
Payment changes
Database schema changes
Dependency changes
Infrastructure changes
Configuration changes
Secret access
File deletion
Large diffs
Security-sensitive files
Test failures
Build failures
```

Risk levels:

```text
LOW
MEDIUM
HIGH
```

High-risk changes require human approval.

---

# 30. Agent Permissions

```text
Planner
READ

Reviewer
READ

Tester
READ + EXECUTE

Coder
READ + WRITE + LIMITED EXECUTE

Repair
READ + WRITE + LIMITED EXECUTE

Reporter
READ

Supervisor
CONTROL FLOW
```

Agents should not automatically receive unrestricted shell access.

---

# 31. `.codexignore`

Protect sensitive files from agent context.

Example:

```text
.env
.env.*
*.pem
*.key
credentials.json
secrets.*
node_modules/
.git/
dist/
build/
coverage/
```

The ignore mechanism should be enforced by the runtime.

It should affect:

```text
Repository scanning
Context building
File indexing
Agent access
```

---

# 32. Pull Request Workflow

After approval:

```text
Human Approval
      ↓
Final Verification
      ↓
Generate Commit Message
      ↓
Commit
      ↓
Push
      ↓
Generate PR
      ↓
User Reviews PR
      ↓
Create PR
```

This is a core MVP feature.

---

# 33. PR Information

CodexFlow should generate:

```text
PR title
PR description
Summary
Changed files
Tests
Risk
Verification results
```

User can edit before creating the PR.

---

# 34. PR Intelligence — Later

After the MVP:

```text
PR Review Comment
        ↓
CodexFlow
        ↓
Convert Comment → Task
        ↓
Create Worktree
        ↓
Agent Fix
        ↓
Review
        ↓
Test
        ↓
Commit
        ↓
Push
        ↓
Update PR
```

This is a strong post-MVP feature but should not block the first demo.

---

# 35. Evaluation System

The evaluation system is important for the hackathon.

Create benchmark repositories containing controlled tasks.

Example:

```text
benchmarks/
├── repo-001/
│   ├── repository/
│   ├── task.json
│   └── tests/
│
├── repo-002/
│   ├── repository/
│   ├── task.json
│   └── tests/
```

Start with approximately:

```text
5–10 benchmark repositories
```

Do not attempt 50+ initially.

---

# 36. Evaluation Runner

```text
Benchmark
 ↓
Create Workspace
 ↓
Run Task
 ↓
Run Verification
 ↓
Detect Regression
 ↓
Collect Metrics
 ↓
Store Evaluation
```

Metrics:

```text
Pass@1
Pass@3
Success Rate
Regression Rate
Repair Rate
Average Retries
Execution Duration
Files Changed
Lines Added
Lines Removed
```

Human acceptance can be tracked separately as a product metric.

---

# 37. Evaluation Dashboard

Show:

```text
Pass@1
Pass@3
Success Rate
Regression Rate
Repair Rate
Average Retries
Average Duration
```

Also show individual runs:

```text
Task
Agent
Repository
Result
Retries
Duration
Tests
Risk
```

---

# 38. Web Application Structure

Main navigation:

```text
Projects
Repositories
Agent Tasks
Pull Requests
Activity
Evals
Settings
```

---

# 39. Main Screens

## Landing

```text
CodexFlow

Mission Control for AI Coding Agents

[ Import Repository ]
```

## Repository

```text
Repository
Branch
Files
Tasks
Pull Requests
Activity
```

## Task

```text
Task description
Planner
Coder
Reviewer
Tester
Repair
Supervisor
```

## Agent Run

This is the **hero screen**.

```text
Planner       ✓
Coder         ✓
Reviewer      ✓
Tester        ●
Repair        ○
Reporter      ○
Supervisor    ●
```

Show:

```text
Live events
Agent progress
Changed files
Test output
Review findings
Risk
```

## Diff Review

```text
Risk
Changed files
Diff
Tests
Reviewer findings

[ Approve ]
[ Reject ]
[ Retry ]
[ Rollback ]
```

## Pull Request

```text
PR
Branch
Checks
Review
Comments
Changes
```

## Evals

```text
Pass@1
Pass@3
Regression
Repair
Duration
```

---

# 40. Project Structure

```text
codexflow/
│
├── apps/
│   └── web/
│       ├── app/
│       │   ├── page.tsx
│       │   ├── repositories/
│       │   ├── projects/
│       │   ├── tasks/
│       │   ├── agents/
│       │   ├── pull-requests/
│       │   ├── evals/
│       │   └── settings/
│       │
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       └── lib/
│
├── packages/
│   ├── runtime/
│   │   ├── core/
│   │   ├── events/
│   │   ├── commands/
│   │   ├── scheduler/
│   │   ├── lifecycle/
│   │   └── plugins/
│   │
│   ├── agents/
│   │   ├── planner/
│   │   ├── coder/
│   │   ├── reviewer/
│   │   ├── tester/
│   │   ├── repair/
│   │   ├── reporter/
│   │   ├── supervisor/
│   │   └── integration/
│   │
│   ├── workspace/
│   │   ├── scanner/
│   │   ├── worktrees/
│   │   ├── locks/
│   │   └── policies/
│   │
│   ├── git/
│   │   ├── engine/
│   │   └── providers/
│   │       ├── github/
│   │       ├── gitlab/
│   │       └── bitbucket/
│   │
│   ├── providers/
│   │   ├── codex/
│   │   └── mock/
│   │
│   ├── evaluation/
│   │   ├── runner/
│   │   ├── benchmarks/
│   │   └── metrics/
│   │
│   ├── database/
│   │
│   └── shared/
│       ├── types/
│       └── validation/
│
├── benchmarks/
├── fixtures/
├── docs/
├── scripts/
├── .codexignore
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

# 41. Core Domain Models

```ts
type Project = {
  id: string;
  name: string;
  repositoryId: string;
  defaultBranch: string;
  projectType?: string;
};

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

type TestPlan = {
  verificationRequired: boolean;
  existingTests: string[];
  testsToCreate: TestSpec[];
  commands: string[];
  expectedBehavior: string[];
};

type Evaluation = {
  taskId: string;
  testsPassed: boolean;
  lintPassed?: boolean;
  buildPassed?: boolean;
  riskScore: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  durationMs: number;
};
```

---

# 42. MVP Roadmap

## Phase 1 — Web Foundation

Build:

```text
Next.js
React
TypeScript
Tailwind
SQLite
Routing
Dashboard shell
Basic logging
Error handling
```

Deliverable:

> CodexFlow web application running.

---

## Phase 2 — GitHub Integration

Build:

```text
GitHub authentication
Repository listing
Repository selection
Clone
Branch selection
Git engine
```

Deliverable:

> User can import a GitHub repository.

---

## Phase 3 — Workspace + Scanner

Build:

```text
Git worktrees
Task workspace
Workspace lifecycle
Project scanner
Project metadata
```

Deliverable:

> Every task gets an isolated repository workspace.

---

## Phase 4 — Composable Runtime

Build:

```text
Plugin registry
Event bus
Command bus
Scheduler
Task lifecycle
Agent lifecycle
```

Deliverable:

> Agents can operate as independent plugins.

---

## Phase 5 — Core Agents

Implement:

```text
Planner
Coder
Reviewer
Tester
Supervisor
```

First use Mock Agent Provider.

Deliverable:

> Complete deterministic agent pipeline.

---

## Phase 6 — Real AI + Repair

Implement:

```text
Codex provider
Repair plugin
Retry loop
Real verification
```

Deliverable:

> Real AI coding task with automatic repair.

---

## Phase 7 — Diff + Approval

Build:

```text
Monaco diff
Risk engine
Reviewer findings
Test results
Approval
Reject
Retry
Rollback
```

Deliverable:

> Human-controlled agent changes.

---

## Phase 8 — Commit + PR

Build:

```text
Commit
Push
PR generation
PR description
PR creation
PR status
```

Deliverable:

> Complete Git lifecycle.

---

## Phase 9 — Evals

Build:

```text
Benchmark repositories
Evaluation runner
Pass@1
Pass@3
Regression
Repair metrics
Dashboard
```

Deliverable:

> Measurable agent performance.

---

## Phase 10 — Hackathon Polish

Focus on:

```text
UI polish
Agent timeline
Error handling
Demo reliability
Benchmark results
Documentation
Demo flow
```

---

# 43. What Is MVP

The following is the **mandatory MVP**:

```text
✓ Web application
✓ GitHub repository import
✓ Repository scanner
✓ Git worktrees
✓ Task creation
✓ Plugin runtime
✓ Planner
✓ Coder
✓ Reviewer
✓ Tester
✓ Supervisor
✓ Task-based verification
✓ Repair loop
✓ Diff viewer
✓ Risk analysis
✓ Human approval
✓ Commit
✓ Push
✓ Pull Request
✓ Basic evaluations
```

---

# 44. What Is NOT MVP

Do not block the hackathon on:

```text
✗ Electron
✗ Desktop application
✗ Local-folder import
✗ GitLab
✗ Bitbucket
✗ Enterprise RBAC
✗ Billing
✗ Cloud SaaS
✗ Mobile
✗ Kubernetes
✗ Vector database
✗ Complex workflow builder
✗ 10+ agents
✗ Huge benchmark dataset
✗ Advanced PR automation
```

---

# 45. Hackathon Demo

Use a deterministic demo repository.

It should contain a small but realistic problem.

For example:

```text
Authentication bug
Missing regression test
Minor lint issue
```

Demo sequence:

```text
1. Open CodexFlow

2. Import GitHub repository

3. Repository scanner analyzes project

4. Create task:

   "Fix the authentication timeout issue."

5. Planner analyzes task.

6. Planner creates implementation plan.

7. Planner creates verification strategy.

8. Coder modifies implementation.

9. Coder creates regression test.

10. Reviewer inspects diff.

11. Tester runs real tests.

12. If a test fails:
       Supervisor → Repair → Reviewer → Tester

13. Tests pass.

14. CodexFlow calculates risk.

15. Developer reviews diff.

16. Developer approves.

17. CodexFlow creates commit.

18. CodexFlow pushes branch.

19. CodexFlow generates PR title/body.

20. Developer creates PR.

21. Evals dashboard displays task result.
```

---

# 46. The Important Story

Do not present CodexFlow as:

> "We built another AI coding agent."

Instead:

> **"We built a control plane for AI coding agents."**

The difference:

```text
Traditional AI Coding
Developer
    ↓
AI
    ↓
Code
```

CodexFlow:

```text
Developer
    ↓
CodexFlow
    ↓
Task
    ↓
Planner
    ↓
Isolated Worktree
    ↓
Coder
    ↓
Reviewer + Tester
    ↓
Repair
    ↓
Risk Analysis
    ↓
Human Approval
    ↓
Commit
    ↓
Push
    ↓
Pull Request
    ↓
Evaluation
```

---

# 47. Final Architectural Principles

### Principle 1 — Web First

No Electron during the hackathon.

### Principle 2 — Git First

Repository import, worktrees, commits, pushes, and PRs are core product functionality.

### Principle 3 — Plugin First

Agents are independent composable plugins.

### Principle 4 — Task First

Everything starts from a task.

### Principle 5 — Verification First

Every task gets a verification strategy.

But:

> Not every task requires a new test.

### Principle 6 — Real Execution Is Truth

Tests must actually execute.

The LLM cannot claim that tests passed.

### Principle 7 — Isolated Execution

Every agent task runs in its own workspace/worktree.

### Principle 8 — Human Control

Agents propose and execute inside controlled environments.

The developer controls approval and high-risk operations.

### Principle 9 — Deterministic Safety

Risk and permissions should not rely exclusively on LLM judgment.

### Principle 10 — Measurable Agents

CodexFlow should measure whether agents actually solve tasks.

### Principle 11 — Runtime Independence

Cordis/external composable harness technology can be integrated through an adapter, but CodexFlow must not depend on unverified APIs.

### Principle 12 — Hackathon Focus

Build the complete core loop before adding peripheral features.

---

# 48. Final Product Architecture

```text
                           CODEXFLOW WEB
                                │
                                ▼
                      ┌───────────────────┐
                      │  Repository Layer │
                      └─────────┬─────────┘
                                │
                           GitHub Import
                                │
                                ▼
                      ┌───────────────────┐
                      │ Project Scanner   │
                      └─────────┬─────────┘
                                │
                                ▼
                         ┌─────────────┐
                         │    Task     │
                         └──────┬──────┘
                                │
                                ▼
                   ┌────────────────────────┐
                   │ Composable Agent       │
                   │ Runtime                │
                   └────────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
           Planner            Coder            Supervisor
                                │
                                ▼
                         Isolated Worktree
                                │
                                ▼
                         code_generated
                                │
                         ┌──────┴──────┐
                         ▼             ▼
                      Reviewer       Tester
                         │             │
                         └──────┬──────┘
                                ▼
                           Supervisor
                                │
                         ┌──────┴──────┐
                         │             │
                       Fail          Pass
                         │             │
                         ▼             ▼
                      Repair      Risk Analysis
                         │             │
                         └──────┐      ▼
                                │   Approval
                                │      │
                                ▼      ▼
                              Retry   Commit
                                        │
                                        ▼
                                       Push
                                        │
                                        ▼
                                    Pull Request
                                        │
                                        ▼
                                      Evals
```

# 49. Definition of Done

The hackathon implementation is complete when a user can perform:

```text
GitHub Repository
       ↓
Import
       ↓
Create Task
       ↓
Planner
       ↓
Isolated Worktree
       ↓
Coder
       ↓
Task-Based Test Strategy
       ↓
Reviewer
       ↓
Real Tests
       ↓
Repair if needed
       ↓
Risk Analysis
       ↓
Diff Review
       ↓
Human Approval
       ↓
Commit
       ↓
Push
       ↓
Pull Request
```

and CodexFlow records:

```text
What happened?
Which agent did it?
Which files changed?
Which tests ran?
Did they pass?
Were tests created?
How many repair attempts occurred?
What was the risk?
Which commit contains the changes?
Which PR contains the changes?
```

That is the **final CodexFlow hackathon scope**.

The key is to make this loop extremely reliable and polished rather than attempting to build a huge platform.
