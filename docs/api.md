# CodexFlow API Specification

## Repository APIs

```text
POST   /api/github/connect
GET    /api/repositories
GET    /api/repositories/:id
GET    /api/repositories/:id/branches
POST   /api/repositories/import
```

## Project APIs

```text
GET    /api/projects
GET    /api/projects/:id
POST   /api/projects
```

## Task APIs

```text
POST   /api/tasks
GET    /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/start
POST   /api/tasks/:id/cancel
POST   /api/tasks/:id/retry
POST   /api/tasks/:id/approve
POST   /api/tasks/:id/reject
POST   /api/tasks/:id/rollback
```

## Agent APIs

```text
GET    /api/tasks/:id/agents
GET    /api/agents/:id
GET    /api/agents/:id/events
POST   /api/agents/:id/cancel
```

## Diff / verification APIs

```text
GET    /api/tasks/:id/diff
GET    /api/tasks/:id/reviews
GET    /api/tasks/:id/tests
GET    /api/tasks/:id/risk
```

## Git / PR APIs

```text
POST   /api/tasks/:id/commit
POST   /api/tasks/:id/push
POST   /api/tasks/:id/pull-request
GET    /api/pull-requests
GET    /api/pull-requests/:id
```

## Evaluation APIs

```text
GET    /api/evals
GET    /api/evals/:id
POST   /api/evals/run
GET    /api/benchmarks
```

## API principles

- Validate all inputs with Zod.
- Never expose secrets.
- Enforce task/workspace authorization.
- Return structured errors.
- Long-running agent execution must not depend on a single blocking HTTP request.
