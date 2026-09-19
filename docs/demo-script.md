# CodexFlow Hackathon Demo Script

## Demo goal

Show that CodexFlow is more than an AI coding agent: it controls the full lifecycle from task to Pull Request.

## Scenario

Use a deterministic repository with:

- a small authentication bug
- missing regression coverage
- a minor lint issue

## Demo

### 1. Open CodexFlow

Show the landing page.

Say:

> CodexFlow is mission control for AI coding agents.

### 2. Import Repository

Import the GitHub demo repository.

Show:

- repository
- branch
- project scanner

### 3. Create Task

Use:

```text
Fix the authentication timeout issue and make sure the behavior is covered by automated tests.
```

### 4. Planner

Show:

- affected files
- implementation plan
- verification strategy

Explain:

> Every task gets a verification strategy. A new test is created only when existing coverage is insufficient.

### 5. Worktree

Show that the task has its own branch/worktree.

### 6. Coder

Show code and test changes.

### 7. Reviewer + Tester

Show Reviewer and Tester running.

Tester must display real command output.

### 8. Repair

If the demo is designed to fail once, show:

```text
Test failed
→ Supervisor
→ Repair
→ Reviewer
→ Tester
```

Then show passing results.

### 9. Risk + Diff

Show:

- changed files
- risk
- test status
- reviewer findings

### 10. Approval

Click Approve.

### 11. Git

Show:

```text
Commit
Push
```

### 12. Pull Request

Show generated PR title/body and create the PR.

### 13. Evaluation

Show benchmark/evaluation metrics.

## Closing statement

> CodexFlow doesn't replace the developer. It gives the developer a control plane for supervising AI coding work safely, measurably, and through the normal Git and Pull Request lifecycle.
