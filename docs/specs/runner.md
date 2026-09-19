# SDD: Agent Runner

## Purpose

Execute specialized agents through a provider abstraction inside an isolated workspace.

## Agent Provider

```ts
interface AgentProvider {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
  stream(runId: string): AsyncIterable<AgentEvent>;
}
```

## Roles

- Planner: read-only
- Coder: read/write + limited execute
- Reviewer: read-only
- Tester: read + execute
- Repair: read/write + limited execute
- Reporter: read
- Supervisor: control flow

## Requirements

- Stream progress to the UI.
- Persist run metadata.
- Support cancellation.
- Enforce timeouts.
- Enforce workspace and command policy.
- Never expose ignored secrets to agent context.
- Capture provider errors.

## Mock provider

A deterministic mock provider is required for unit/integration tests.

## Acceptance Criteria

- Real provider and mock provider share the same interface.
- Agent runs are traceable to tasks.
- Failed runs produce structured errors.
- Cancellation works.
