# CodexFlow --- Product Requirements Document (PRD)

> **Historical implementation baseline.** This document records the original
> hackathon planning scope and is not the current implementation authority.
> CodexFlow's completed product scope is GitHub-only; proposed GitLab and
> Bitbucket material below remains deferred. See `FINAL-SYSTEM-AUDIT.md` for
> the verified current state.

**Version:** 1.0\
**Status:** Hackathon Implementation Baseline\
**Product:** CodexFlow\
**Positioning:** Mission Control for AI Coding Agents

## 1. Product Overview

CodexFlow is a web-based control plane for AI coding agents. A developer
connects a Git repository, creates a coding task, delegates work to
specialized agents, executes the work in an isolated Git worktree,
verifies the result with real tools, reviews risk-aware diffs, approves
or rejects the changes, and turns approved work into a commit, push, and
Pull Request.

**Core loop**

``` text
Import Repository → Create Task → Plan → Worktree → Code
→ Review → Verify → Repair if needed → Diff/Risk Review
→ Human Approval → Commit → Push → Pull Request → Evaluate
```

**Positioning:** CodexFlow is an agent control plane sitting between the
developer, Git, CI, and AI coding agents.

## 2. Problem

AI coding agents can generate code quickly, but developers still need to
manage repository context, task decomposition, isolated execution,
concurrent work, review, testing, failures, risky changes, Git branches,
commits, and Pull Requests. CodexFlow provides one controlled lifecycle
around these operations.

## 3. Goals

1.  Provide a web-first developer interface for AI coding tasks.
2.  Support GitHub repository import as the primary repository workflow.
3.  Execute coding tasks in isolated Git worktrees.
4.  Provide a composable plugin-based agent runtime.
5.  Support Planner, Coder, Reviewer, Tester, Repair, Reporter,
    Supervisor, and Integration plugins.
6.  Give every task a verification strategy.
7.  Create tests when additional coverage is required.
8.  Execute real tests, linting, and builds.
9.  Automatically repair failed implementations.
10. Provide deterministic risk analysis plus AI review.
11. Require human approval for high-risk/application decisions.
12. Commit, push, and create Pull Requests.
13. Measure agent reliability with benchmark evaluations.

## 4. Non-Goals for the Hackathon

Do not block the MVP on:

-   Electron/Desktop
-   desktop packaging or IPC
-   native desktop filesystem management
-   mobile
-   enterprise RBAC
-   billing
-   multi-tenant SaaS
-   Kubernetes
-   vector databases
-   huge benchmark datasets
-   complex workflow builders
-   ten-plus agent types
-   full CI/CD replacement

GitHub is the first concrete provider. GitLab and Bitbucket remain
provider abstractions for later. Direct arbitrary local-folder import is
also later; remote repository import is the primary web workflow.

## 5. Target User

A software developer who understands Git and Pull Requests and wants to
delegate coding work to AI agents while retaining control over
isolation, verification, review, approval, commits, and PRs.

## 6. Core User Stories

### Repository

-   Connect GitHub.
-   Browse repositories.
-   Import a repository.
-   Select a base branch.

### Tasks

-   Create a natural-language coding task.
-   See the generated plan.
-   Track task state.
-   Cancel/retry tasks.

### Agents

-   Use specialized agents.
-   See live agent activity.
-   Run agents in isolated workspaces.

### Verification

-   Run relevant existing tests.
-   Create task-specific tests when required.
-   Create regression tests for appropriate bug fixes.
-   Use actual process execution as the source of truth.

### Approval

-   Inspect diffs.
-   See risk.
-   Approve, reject, retry, or rollback.

### Git/PR

-   Commit approved work.
-   Push the branch.
-   Generate and create a Pull Request.

### Evaluation

-   Measure Pass@1, Pass@3, regression rate, repair rate, retries, and
    duration.

## 7. Web-First Architecture

Electron is explicitly excluded from the hackathon.

``` text
Browser
  ↓
Next.js Web App
  ↓
Node.js / TypeScript Backend
  ↓
Composable Agent Runtime
  ↓
Workspace Manager
  ↓
Git Worktree
  ↓
AI Agents
```

Primary workflow:

``` text
GitHub Repository
  ↓
CodexFlow Backend
  ↓
Server-side Workspace
  ↓
Git Worktree
  ↓
Agent Execution
```

## 8. Technology Stack

### Frontend

-   Next.js
-   React
-   TypeScript
-   Tailwind CSS
-   Monaco Editor
-   Zustand

### Backend

-   Node.js
-   TypeScript
-   Next.js API/backend services

### Data

-   SQLite
-   Zod

### Git

-   Git CLI
-   Git worktrees

### AI

-   Codex/OpenAI adapter
-   Mock Agent Provider

### Testing

-   Vitest
-   Playwright
-   Real repository fixtures

### Monorepo

-   pnpm
-   Turborepo

## 9. System Architecture

``` text
CodexFlow Web
├── Repository Layer
│   ├── GitHub Import
│   ├── Repository Metadata
│   └── Branch Selection
├── Project Scanner
├── Task System
├── Workspace Manager
│   ├── Worktrees
│   ├── File Ownership
│   └── Policies
├── Composable Agent Runtime
│   ├── Plugin Registry
│   ├── Event Bus
│   ├── Command Bus
│   ├── Scheduler
│   └── Lifecycle Manager
├── Agent Plugins
│   ├── Planner
│   ├── Coder
│   ├── Reviewer
│   ├── Tester
│   ├── Repair
│   ├── Reporter
│   ├── Supervisor
│   └── Integration
├── Verification
├── Risk Engine
├── Git Engine
├── Git Providers
├── Pull Request System
└── Evaluation System
```

## 10. Composable Agent Runtime

Agents are independent plugins rather than hardcoded sequential
functions.

Runtime components:

``` text
Plugin Registry
Event Bus
Command Bus
Scheduler
Task Lifecycle Manager
Agent Lifecycle Manager
Workspace Context
```

Each plugin should expose:

``` text
name
version
capabilities
permissions
event subscriptions
commands
lifecycle hooks
```

### Cordis / External Harness

The Composable Agent Harness/Cordis concept is an architectural
direction, not an unverified hard dependency.

``` text
CodexFlow
  ↓
Composable Runtime Interface
  ├── Native CodexFlow Runtime
  └── Optional Cordis/Harness Adapter
```

Do not assume undocumented APIs, UI, or benchmark features. The core
product must remain functional without the external harness.

## 11. Command and Event Model

Commands are explicit operations:

``` text
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

Events represent state changes:

``` text
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

Use commands for deterministic operations and events for
coordination/observation. Do not make every operation event-driven.

## 12. Task State Machine

``` text
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
REPAIRING ↺
 ↓
READY_FOR_APPROVAL
 ↓
APPROVED
 ↓
APPLIED
```

Terminal states:

``` text
REJECTED
ROLLED_BACK
FAILED
CANCELLED
BLOCKED
```

## 13. Agent Requirements

### Planner

-   Understand task.
-   Identify affected files.
-   Produce implementation steps.
-   Identify relevant existing tests.
-   Decide whether new tests are required.
-   Produce a verification strategy.
-   Identify risks.
-   Read-only.

### Coder

-   Work only inside the isolated worktree.
-   Implement the approved plan.
-   Create required tests.
-   Avoid unrelated changes.
-   Emit `code_generated`.

### Reviewer

-   Inspect diff.
-   Check correctness, security, architecture, dependencies, unnecessary
    changes, test coverage, and regressions.
-   Read-only.

### Tester

-   Execute real project commands.
-   Capture exit code, stdout, stderr, duration, and results.
-   Never invent test results.

### Repair

-   Respond to review/test failures.
-   Make changes in the same isolated workspace.
-   Return to Reviewer and Tester.
-   Maximum 2--3 attempts before blocking for human review.

### Supervisor

-   Control workflow.
-   Decide whether to continue, retry, repair, stop, block, or request
    approval.
-   Never bypass approval rules.

### Reporter

-   Generate task summary, changed files, verification summary, risk
    summary, commit message, PR title, and PR body.
-   All generated PR content must remain editable.

### Integration

-   Detect overlapping files.
-   Detect conflicts.
-   Combine compatible agent branches.
-   Suggest conflict resolutions.
-   Re-run verification after integration.

## 14. Task-Based Verification

**Every task gets a verification strategy, but not every task gets a new
test.**

### Existing tests

Run relevant tests already present in the repository.

### Task-specific tests

Create tests when the task changes behavior without adequate coverage.

### Regression tests

For appropriate bug fixes:

``` text
Bug
 ↓
Reproduce with test
 ↓
Fix
 ↓
Run regression test
 ↓
Run existing suite
```

### Non-code tasks

Use appropriate verification such as Markdown/link validation,
formatting checks, and builds.

### TestPlan

``` ts
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

## 15. Project Scanner

On repository import, detect:

-   project type
-   package manager
-   framework
-   source directories
-   tests
-   test framework
-   build commands
-   lint commands
-   important configuration
-   documentation
-   Git metadata

Example project types:

``` text
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

## 16. Git Architecture

### Git Engine

``` text
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

### Git Provider

``` text
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

GitHub is the first implementation. GitLab and Bitbucket use the same
abstraction later.

## 17. Git Worktree Isolation

Each task gets its own worktree:

``` text
~/.codexflow/workspaces/
└── project_123/
    ├── task_001/
    ├── task_002/
    └── task_003/
```

Branches:

``` text
codexflow/task-001
codexflow/task-002
codexflow/task-003
```

Agents must not modify the user's primary branch directly.

## 18. Git Safety

Before workspace creation, inspect:

-   current branch
-   default branch
-   dirty state
-   untracked files
-   conflicts
-   detached HEAD
-   repository validity

Never blindly execute:

``` text
git checkout main
git pull
git reset --hard
git clean -fd
```

User changes must be preserved.

## 19. Parallel Agents

Parallel execution is permitted only when safe.

Example:

``` text
Task A → auth.ts
Task B → dashboard.ts
Task C → auth.ts
```

A and C conflict; A and B can run in parallel.

Use file ownership and a conflict graph to determine scheduling.

## 20. Agent Permissions

``` text
Planner   = READ
Reviewer  = READ
Tester    = READ + EXECUTE
Coder     = READ + WRITE + LIMITED EXECUTE
Repair    = READ + WRITE + LIMITED EXECUTE
Reporter  = READ
Supervisor = CONTROL FLOW
```

Unrestricted shell access is disabled by default.

## 21. Command Policy

Safe examples:

``` text
npm test
npm run lint
npm run build
pytest
git status
git diff
```

Restricted examples:

``` text
npm install
pip install
docker build
database migrations
network operations
```

Dangerous examples:

``` text
sudo
rm -rf
git reset --hard
git clean -fd
credential access
```

Restricted/dangerous actions require appropriate policy/approval.

## 22. `.codexignore`

Default patterns:

``` text
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

Enforce the ignore policy in repository scanning, context building,
indexing, and agent file access.

## 23. Risk Engine

Use deterministic signals plus AI review.

Signals may include:

-   authentication changes
-   payment changes
-   database schema changes
-   dependency changes
-   infrastructure/configuration changes
-   secret access
-   file deletion
-   large diffs
-   security-sensitive files
-   failed tests/builds

Risk levels:

``` text
LOW
MEDIUM
HIGH
```

High-risk/application decisions require human approval.

## 24. Diff and Approval

Diff Review must show:

-   changed files
-   additions/deletions
-   risk
-   reviewer findings
-   tests
-   lint
-   build
-   agent explanation

Actions:

``` text
Approve
Reject
Retry
Rollback
```

The developer remains the final authority.

## 25. Commit and PR Workflow

``` text
Human Approval
 ↓
Final Verification
 ↓
Generate Commit Message
 ↓
User Can Edit
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

The commit must be traceable to the task, workspace, agent run, baseline
commit, and verification result.

## 26. PR Intelligence --- Post-MVP

Later:

``` text
PR Comment
 ↓
Task
 ↓
Worktree
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

This does not block the MVP.

## 27. Evaluation System

Start with 5--10 benchmark repositories/tasks.

Each benchmark contains:

``` text
repository
task
expected behavior
tests
evaluation rules
```

Evaluation runner:

``` text
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
Store Result
```

Metrics:

-   Pass@1
-   Pass@3
-   success rate
-   regression rate
-   repair rate
-   average retries
-   execution duration
-   files changed
-   lines added
-   lines removed

## 28. UI Requirements

### Main navigation

``` text
Projects
Repositories
Agent Tasks
Pull Requests
Activity
Evals
Settings
```

### Landing page

Primary action:

``` text
[ Import Repository ]
```

### Repository page

Show repository, branch, files, tasks, PRs, and activity.

### Task page

Show task description, plan, agents, verification, risk, and diff.

### Agent Run page

Hero experience showing:

``` text
Planner
Coder
Reviewer
Tester
Repair
Reporter
Supervisor
```

Also show live events, progress, changed files, test output, review
findings, and risk.

### Diff Review

Show Monaco diff, risk, tests, reviewer findings, and approval controls.

### Pull Request

Show PR information, branch, checks, reviews, comments, and changes.

### Evals

Show evaluation metrics and benchmark results.

## 29. Data Model

Core tables:

``` text
projects
repositories
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

### Core types

``` ts
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
```

## 30. Repository Structure

``` text
codexflow/
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
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       └── lib/
├── packages/
│   ├── runtime/
│   │   ├── core/
│   │   ├── events/
│   │   ├── commands/
│   │   ├── scheduler/
│   │   ├── lifecycle/
│   │   └── plugins/
│   ├── agents/
│   │   ├── planner/
│   │   ├── coder/
│   │   ├── reviewer/
│   │   ├── tester/
│   │   ├── repair/
│   │   ├── reporter/
│   │   ├── supervisor/
│   │   └── integration/
│   ├── workspace/
│   │   ├── scanner/
│   │   ├── worktrees/
│   │   ├── locks/
│   │   └── policies/
│   ├── git/
│   │   ├── engine/
│   │   └── providers/
│   │       ├── github/
│   │       ├── gitlab/
│   │       └── bitbucket/
│   ├── providers/
│   │   ├── codex/
│   │   └── mock/
│   ├── evaluation/
│   │   ├── runner/
│   │   ├── benchmarks/
│   │   └── metrics/
│   ├── database/
│   └── shared/
│       ├── types/
│       └── validation/
├── benchmarks/
├── fixtures/
├── docs/
├── scripts/
├── .codexignore
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 31. Implementation Roadmap

### Phase 1 --- Web Foundation

Next.js, React, TypeScript, Tailwind, SQLite, routing, dashboard shell,
logging, errors.

**Done when:** the web app runs and core pages navigate.

### Phase 2 --- GitHub Integration

Authentication, repository listing, selection, clone, branch selection,
Git engine.

**Done when:** a user can import a GitHub repository.

### Phase 3 --- Workspace + Scanner

Git worktrees, workspace lifecycle, repository scanner, metadata.

**Done when:** every task receives an isolated workspace.

### Phase 4 --- Composable Runtime

Plugin registry, event bus, command bus, scheduler, task/agent
lifecycle.

**Done when:** independent plugins can execute and communicate.

### Phase 5 --- Core Agents

Planner, Coder, Reviewer, Tester, Supervisor, Mock Agent Provider.

**Done when:** a deterministic end-to-end agent workflow works.

### Phase 6 --- Real AI + Repair

Codex provider, Repair plugin, retry loop, real verification.

**Done when:** a real task can be implemented and repaired.

### Phase 7 --- Diff + Approval

Monaco diff, risk engine, findings, test results,
approve/reject/retry/rollback.

**Done when:** a developer can safely review agent changes.

### Phase 8 --- Commit + PR

Commit, push, PR generation, PR creation, PR status.

**Done when:** approved work becomes a GitHub Pull Request.

### Phase 9 --- Evals

Benchmarks, evaluation runner, Pass@1, Pass@3, regression, repair
metrics, dashboard.

**Done when:** agent performance is measurable.

### Phase 10 --- Hackathon Polish

Agent timeline, error/loading states, demo repository, benchmark
results, documentation, reliable demo.

**Done when:** the entire workflow can be demonstrated reliably.

## 32. MVP

Mandatory:

``` text
Web
+
GitHub Import
+
Repository Scanner
+
Git Worktrees
+
Tasks
+
Composable Runtime
+
Planner
+
Coder
+
Reviewer
+
Tester
+
Supervisor
+
Task-Based Verification
+
Repair Loop
+
Diff Review
+
Risk
+
Human Approval
+
Commit
+
Push
+
Pull Request
+
Basic Evals
```

## 33. Post-MVP

-   GitLab
-   Bitbucket
-   Local-folder support
-   PR comment → task
-   Automatic PR repair
-   Advanced parallel scheduling
-   Advanced conflict resolution
-   Larger evaluation suites
-   Cordis adapter after verification
-   Team collaboration
-   Cloud execution

## 34. Security

CodexFlow must:

-   isolate agent workspaces
-   protect primary/protected branches
-   enforce `.codexignore`
-   restrict dangerous commands
-   require approval for high-risk changes
-   avoid exposing credentials to agents
-   record agent actions
-   record Git operations
-   preserve task/workspace traceability

## 35. Error Handling

Handle explicitly:

-   clone failure
-   authentication failure
-   worktree failure
-   invalid Git repository
-   dirty repository state
-   branch failure
-   agent timeout
-   malformed agent output
-   test failure
-   build failure
-   review failure
-   repair failure
-   merge conflict
-   push failure
-   PR creation failure
-   database failure

Failures must produce visible task states and useful logs.

## 36. Observability

Every task should have an execution timeline:

``` text
Task created
Planner started
Plan created
Workspace created
Coder started
Code generated
Reviewer completed
Tests started
Tests failed
Repair started
Repair completed
Tests passed
Approval requested
Approved
Commit created
Branch pushed
PR created
```

## 37. Success Metrics

### Product

-   complete task-to-PR success rate
-   average task duration
-   verification success rate
-   PR creation success rate

### Agent

-   Pass@1
-   Pass@3
-   regression rate
-   repair rate
-   average retries
-   files changed
-   lines changed
-   execution duration

### Reliability

-   agent failure rate
-   workspace failure rate
-   Git failure rate
-   test execution failure rate
-   PR creation failure rate

## 38. Hackathon Demo

Use a deterministic repository containing a small authentication bug,
missing regression test, and minor lint problem.

Demo sequence:

``` text
1. Open CodexFlow.
2. Import GitHub repository.
3. Scanner analyzes project.
4. Create "Fix authentication timeout" task.
5. Planner creates implementation and verification plan.
6. Isolated worktree is created.
7. Coder changes implementation and creates regression test.
8. Reviewer analyzes diff.
9. Tester executes real tests.
10. If needed, Supervisor starts Repair.
11. Verification passes.
12. Risk is calculated.
13. Developer reviews diff.
14. Developer approves.
15. Commit is created.
16. Branch is pushed.
17. Reporter generates PR title/body.
18. Pull Request is created.
19. Evaluation result is shown.
```

## 39. Definition of Done

CodexFlow is complete for the hackathon when a developer can go from:

``` text
GitHub Repository
→ Import
→ Task
→ Plan
→ Verification Strategy
→ Isolated Worktree
→ Code
→ Review
→ Test
→ Repair if needed
→ Risk
→ Diff Review
→ Approval
→ Commit
→ Push
→ Pull Request
→ Evaluation
```

and the system can answer:

``` text
What did the agent do?
Which files changed?
Why did they change?
Which tests ran?
Were tests created?
Why were they created?
Did tests pass?
Did repair occur?
How many attempts were required?
What was the risk?
Which commit contains the work?
Which PR contains the work?
```

## 40. Final Product Principle

``` text
AI
    = reasoning

Agent Runtime
    = orchestration

Plugin System
    = composability

Workspace
    = isolation

Git
    = version control

Git Provider
    = repository + PR operations

Tests
    = verification

Risk Engine
    = deterministic safety

Human
    = final authority

Evaluation
    = measurement
```

**Final product statement:**

> CodexFlow is a web-based mission control system for AI coding agents
> that lets developers delegate coding tasks, execute agents in isolated
> Git worktrees, automatically verify and repair their changes, review
> risk-aware diffs, approve the result, and turn successful work into
> Pull Requests while continuously measuring agent reliability.
