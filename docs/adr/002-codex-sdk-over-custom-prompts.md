# ADR-002: Codex SDK/Provider Adapter Over Custom Prompt Orchestration

## Status

Accepted

## Context

CodexFlow needs an AI execution layer without coupling the entire application to raw prompt strings or a single implementation.

## Decision

Create an `AgentProvider` abstraction and implement the Codex/OpenAI integration behind it.

The runtime owns:

- task lifecycle
- workspace context
- permissions
- tool policy
- events
- persistence
- verification

The provider owns AI execution.

## Interface

```ts
interface AgentProvider {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
  stream(runId: string): AsyncIterable<AgentEvent>;
}
```

A mock provider must also exist for deterministic tests.

## Consequences

- Agent execution can be replaced without rewriting orchestration.
- Tests can run without an external AI service.
- Provider-specific implementation details remain isolated.
