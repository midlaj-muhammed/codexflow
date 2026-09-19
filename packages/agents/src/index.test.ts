import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRunner, MockAgentProvider, OpenAIResponsesProvider, scanProject } from './index.js';
describe('scanner and mock provider', () => {
  it('detects a Next/Vitest project from files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        packageManager: 'pnpm@9',
        dependencies: { next: 'x', vitest: 'x' },
        scripts: { test: 'vitest run', build: 'next build' },
      }),
    );
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    const result = await scanProject(root);
    expect(result).toMatchObject({
      framework: 'Next.js',
      testFramework: 'Vitest',
      packageManager: 'pnpm',
      language: expect.arrayContaining(['TypeScript']),
    });
  });
  it('streams deterministic mock agent events', async () => {
    const provider = new MockAgentProvider();
    await provider.run({
      runId: 'r',
      taskId: 't',
      workspacePath: '/tmp',
      role: 'PLANNER',
      prompt: 'x',
    });
    const events = [];
    for await (const event of provider.stream('r')) events.push(event);
    expect(events).toHaveLength(2);
  });
  it('uses the verified Responses API contract without leaking the key in results', async () => {
    const provider = new OpenAIResponsesProvider('top-secret', 'gpt-5', async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer top-secret' });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-5', store: false });
      return new Response(JSON.stringify({ id: 'resp_1', output_text: 'structured result' }));
    });
    await expect(
      provider.run({
        runId: 'r',
        taskId: 't',
        workspacePath: '/tmp',
        role: 'PLANNER',
        prompt: 'Plan',
      }),
    ).resolves.toMatchObject({ output: 'structured result' });
  });
  it('persists runner attempts and failures through a provider-neutral runner', async () => {
    const calls: string[] = [];
    const runner = new AgentRunner(new MockAgentProvider(), {
      createRun: () => {
        calls.push('create');
      },
      appendEvent: () => {
        calls.push('event');
      },
      finishRun: () => {
        calls.push('finish');
      },
    });
    await runner.run({
      runId: 'r',
      taskId: 't',
      workspacePath: '/tmp',
      role: 'PLANNER',
      prompt: 'Plan',
      attempt: 1,
    });
    expect(calls).toEqual(['create', 'event', 'event', 'finish']);
  });
});
