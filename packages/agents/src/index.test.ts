import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgentProvider, scanProject } from './index.js';
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
});
