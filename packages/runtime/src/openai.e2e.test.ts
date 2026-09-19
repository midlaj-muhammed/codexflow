import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAIResponsesProvider } from '@codexflow/agents';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { GitEngine } from '@codexflow/git';
import { WorkspaceManager } from '@codexflow/workspace';
import { EventBus, RuntimeExecutor, type RuntimeEvent } from './index.js';

const realOpenAiEnabled =
  process.env.CODEXFLOW_REAL_OPENAI_E2E === '1' && Boolean(process.env.OPENAI_API_KEY);
const describeRealOpenAi = realOpenAiEnabled ? describe : describe.skip;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codexflow-openai-e2e-'));
  const repositoryPath = join(root, 'repo');
  mkdirSync(join(repositoryPath, 'src'), { recursive: true });
  mkdirSync(join(repositoryPath, 'tests'), { recursive: true });
  git(repositoryPath, 'init', '-b', 'main');
  git(repositoryPath, 'config', 'user.email', 'test@example.com');
  git(repositoryPath, 'config', 'user.name', 'Test');
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { test: 'node tests/math.test.js' } }, null, 2),
  );
  writeFileSync(
    join(repositoryPath, 'src', 'math.js'),
    'export function add(a, b) {\n  return 0;\n}\n',
  );
  writeFileSync(
    join(repositoryPath, 'tests', 'math.test.js'),
    [
      "import { strict as assert } from 'node:assert';",
      "import { add } from '../src/math.js';",
      'assert.equal(add(2, 3), 5);',
      "console.log('math ok');",
      '',
    ].join('\n'),
  );
  writeFileSync(join(repositoryPath, 'README.md'), '# CodexFlow OpenAI E2E Fixture\n');
  git(repositoryPath, 'add', 'package.json', 'src/math.js', 'tests/math.test.js', 'README.md');
  git(repositoryPath, 'commit', '-m', 'base');

  const store = new CodexFlowStore(openDatabase());
  const repository = store.createRepository({
    provider: 'github',
    owner: 'codexflow',
    name: 'openai-e2e-fixture',
    url: 'https://github.com/codexflow/openai-e2e-fixture',
    defaultBranch: 'main',
    localPath: repositoryPath,
  });
  const project = store.createProject(String(repository.id), 'OpenAI E2E fixture');
  const task = store.createTask(
    project.id,
    'Update only src/math.js. Implement add(a, b) so that it returns the sum of the two arguments. Do not modify package.json, tests, README, or unrelated files.',
  );
  return { root, repositoryPath, store, task };
}

describeRealOpenAi('RuntimeExecutor real OpenAI E2E', () => {
  it('executes a real OpenAI structured coder request through RuntimeExecutor', async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    expect(Boolean(apiKey)).toBe(true);
    const fixture = await createFixture();
    const runtimeEvents: RuntimeEvent[] = [];
    const eventBus = new EventBus();
    eventBus.subscribe((event) => {
      runtimeEvents.push(event);
    });
    let requestCount = 0;
    const provider = new OpenAIResponsesProvider(apiKey!, 'gpt-5', async (url, init) => {
      requestCount += 1;
      return fetch(url, init);
    });

    const result = await new RuntimeExecutor({
      store: fixture.store,
      events: eventBus,
      provider,
      workspaceManager: new WorkspaceManager(new GitEngine(), join(fixture.root, 'workspaces')),
    }).execute(String(fixture.task.id));

    expect(requestCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      finalState: 'READY_FOR_APPROVAL',
      changedFiles: ['src/math.js'],
      review: { verdict: 'APPROVED' },
      tests: [expect.objectContaining({ command: 'node tests/math.test.js', status: 'PASSED' })],
    });
    expect(result.workspace?.rootPath).toBeTruthy();
    expect(result.workspace?.rootPath).not.toBe(fixture.repositoryPath);
    expect(result.diff).toContain('src/math.js');
    expect(result.diff).toContain('return 0');
    expect(result.diff).toMatch(/return\s+a\s*\+\s*b/);

    const sourceMath = readFileSync(join(fixture.repositoryPath, 'src', 'math.js'), 'utf8');
    const workspaceMath = readFileSync(join(result.workspace!.rootPath, 'src', 'math.js'), 'utf8');
    expect(sourceMath).toContain('return 0');
    expect(workspaceMath).toMatch(/return\s+a\s*\+\s*b/);
    expect(readFileSync(join(result.workspace!.rootPath, 'README.md'), 'utf8')).toBe(
      '# CodexFlow OpenAI E2E Fixture\n',
    );

    expect(fixture.store.getTask(String(fixture.task.id))).toMatchObject({
      status: 'READY_FOR_APPROVAL',
    });
    expect(fixture.store.getPlan(String(fixture.task.id))).toMatchObject({
      content: expect.stringContaining('Update only src/math.js'),
    });
    expect(fixture.store.getReview(String(fixture.task.id))).toMatchObject({
      verdict: 'APPROVED',
    });
    expect(fixture.store.listTestRuns(String(fixture.task.id))).toEqual([
      expect.objectContaining({
        command: 'node tests/math.test.js',
        status: 'PASSED',
        exitCode: 0,
        stdout: expect.stringContaining('math ok'),
      }),
    ]);
    expect(fixture.store.listAgentRuns(String(fixture.task.id))).toEqual([
      expect.objectContaining({ role: 'PLANNER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'CODER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'REVIEWER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'TESTER', status: 'COMPLETED' }),
    ]);

    const persisted = JSON.stringify({
      events: runtimeEvents,
      runs: fixture.store.listAgentRuns(String(fixture.task.id)),
      plan: fixture.store.getPlan(String(fixture.task.id)),
      review: fixture.store.getReview(String(fixture.task.id)),
      tests: fixture.store.listTestRuns(String(fixture.task.id)),
    });
    expect(persisted).not.toContain(apiKey);
    expect(persisted).not.toContain('Bearer ');
    expect(persisted).not.toContain('Authorization');
  }, 120_000);
});

describe('RuntimeExecutor real OpenAI E2E gate', () => {
  it('is explicitly environment gated', () => {
    expect(process.env.CODEXFLOW_REAL_OPENAI_E2E === '1' || !realOpenAiEnabled).toBe(true);
  });
});
