import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { type StructuredCoderProvider } from '@codexflow/agents';
import { GitEngine } from '@codexflow/git';
import { WorkspaceManager } from '@codexflow/workspace';
import {
  AgentLifecycleManager,
  CommandBus,
  EventBus,
  PluginRegistry,
  RuntimeExecutor,
  TaskLifecycleManager,
  runMockWorkflow,
} from './index.js';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

async function runtimeFixture(testCommand = 'test -f src/message.txt') {
  const root = await mkdtemp(join(tmpdir(), 'runtime-executor-'));
  const repositoryPath = join(root, 'repo');
  mkdirSync(join(repositoryPath, 'src'), { recursive: true });
  git(repositoryPath, 'init', '-b', 'main');
  git(repositoryPath, 'config', 'user.email', 'test@example.com');
  git(repositoryPath, 'config', 'user.name', 'Test');
  writeFileSync(join(repositoryPath, 'src', 'message.txt'), 'hello');
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { test: testCommand } }),
  );
  git(repositoryPath, 'add', 'src/message.txt', 'package.json');
  git(repositoryPath, 'commit', '-m', 'base');

  const store = new CodexFlowStore(openDatabase());
  const repository = store.createRepository({
    provider: 'github',
    owner: 'acme',
    name: 'runtime-fixture',
    url: 'https://github.com/acme/runtime-fixture',
    defaultBranch: 'main',
    localPath: repositoryPath,
  });
  const project = store.createProject(String(repository.id), 'Runtime fixture');
  const task = store.createTask(project.id, 'Change src/message.txt to say hello codexflow');
  return { root, repositoryPath, store, task };
}

function provider(output: { path: string; content: string }): StructuredCoderProvider {
  return {
    runCoder: async () => ({
      edits: [output],
      explanation: 'deterministic runtime fixture',
    }),
  };
}

function executorFor(
  fixture: Awaited<ReturnType<typeof runtimeFixture>>,
  coderProvider?: StructuredCoderProvider,
  events?: EventBus,
) {
  return new RuntimeExecutor({
    store: fixture.store,
    events,
    provider: coderProvider,
    workspaceManager: new WorkspaceManager(new GitEngine(), join(fixture.root, 'workspaces')),
  });
}
describe('runtime', () => {
  it('registers plugins and rejects duplicate roles', () => {
    const registry = new PluginRegistry();
    const plugin = {
      id: 'plan',
      role: 'PLANNER' as const,
      permissions: ['READ'] as const,
      run: async () => {},
    };
    registry.register(plugin);
    expect(registry.get('PLANNER')).toBe(plugin);
    expect(() => registry.register(plugin)).toThrow('already registered');
  });
  it('dispatches commands and delivers events', async () => {
    const observed: string[] = [];
    const lifecycle = new TaskLifecycleManager();
    const events = new EventBus();
    events.subscribe((event) => {
      observed.push(event.type);
    });
    const commands = new CommandBus(lifecycle, events);
    await commands.dispatch({ type: 'createTask', taskId: 'x' });
    await commands.dispatch({ type: 'startTask', taskId: 'x' });
    expect(lifecycle.get('x')).toBe('QUEUED');
    expect(observed).toEqual(['task.created', 'task.started']);
  });
  it('delivers reusable agent boundary events for future runtime stage observers', async () => {
    const observed: string[] = [];
    const events = new EventBus();
    events.subscribe((event) => {
      observed.push(`${event.type}:${event.payload?.role ?? 'none'}`);
    });
    await events.emit({
      type: 'agent.started',
      taskId: 'x',
      at: new Date().toISOString(),
      payload: { role: 'PLANNER' },
    });
    await events.emit({
      type: 'agent.completed',
      taskId: 'x',
      at: new Date().toISOString(),
      payload: { role: 'PLANNER', status: 'COMPLETED' },
    });
    await events.emit({
      type: 'agent.failed',
      taskId: 'x',
      at: new Date().toISOString(),
      payload: { role: 'CODER', error: 'invalid structured output' },
    });
    expect(observed).toEqual([
      'agent.started:PLANNER',
      'agent.completed:PLANNER',
      'agent.failed:CODER',
    ]);
  });
  it('rejects invalid transitions', async () => {
    const lifecycle = new TaskLifecycleManager();
    await lifecycle.create('x');
    await expect(lifecycle.transition('x', 'APPLIED')).rejects.toThrow('Invalid');
  });
  it('persists delivery state checkpoints through the lifecycle persistence hook', async () => {
    const saved: string[] = [];
    const lifecycle = new TaskLifecycleManager({
      saveTaskState: () => {},
      saveDeliveryState: (_taskId, status) => {
        saved.push(status);
      },
      appendEvent: () => {},
    });
    await lifecycle.recordDeliveryState('x', 'COMMITTED');
    await lifecycle.recordDeliveryState('x', 'PUSHED');
    expect(lifecycle.getDeliveryState('x')).toBe('PUSHED');
    expect(saved).toEqual(['COMMITTED', 'PUSHED']);
  });
  it('cancels an active plugin', async () => {
    const manager = new AgentLifecycleManager();
    let cancelled = false;
    const plugin = {
      id: 'coder',
      role: 'CODER' as const,
      permissions: ['READ', 'WRITE'] as ('READ' | 'WRITE')[],
      run: async (context: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => {
            cancelled = true;
            resolve();
          }),
        );
      },
    };
    const running = manager.run(plugin, {
      taskId: 'x',
      role: 'CODER',
      permissions: ['READ', 'WRITE'],
      attempt: 1,
    });
    expect(manager.cancel('x', 'CODER')).toBe(true);
    await running;
    expect(cancelled).toBe(true);
  });
  it('executes a persisted task through the real pipeline in an isolated workspace', async () => {
    const fixture = await runtimeFixture();
    const { repositoryPath, store, task } = fixture;
    const observed: string[] = [];
    const events = new EventBus();
    events.subscribe((event) => {
      observed.push(`${event.type}:${event.payload?.role ?? 'none'}`);
    });

    const result = await executorFor(
      fixture,
      provider({ path: 'src/message.txt', content: 'hello codexflow' }),
      events,
    ).execute(String(task.id));

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      finalState: 'READY_FOR_APPROVAL',
      changedFiles: ['src/message.txt'],
      review: { verdict: 'APPROVED' },
      tests: [expect.objectContaining({ command: 'test -f src/message.txt', status: 'PASSED' })],
    });
    expect(result.workspace?.rootPath).not.toBe(repositoryPath);
    expect(readFileSync(join(result.workspace!.rootPath, 'src', 'message.txt'), 'utf8')).toBe(
      'hello codexflow',
    );
    expect(readFileSync(join(repositoryPath, 'src', 'message.txt'), 'utf8')).toBe('hello');
    expect(result.diff).toContain('hello codexflow');
    expect(store.getTask(String(task.id))).toMatchObject({ status: 'READY_FOR_APPROVAL' });
    expect(store.loadApproval(String(task.id))).toMatchObject({
      workspaceId: result.workspace?.id,
      state: 'PENDING',
    });
    expect(store.getWorkspaceForTask(String(task.id))).toMatchObject({
      branch: `codexflow/task-${task.id}`,
    });
    expect(store.listAgentRuns(String(task.id))).toEqual([
      expect.objectContaining({ role: 'PLANNER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'CODER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'REVIEWER', status: 'COMPLETED' }),
      expect.objectContaining({ role: 'TESTER', status: 'COMPLETED' }),
    ]);
    const coderRun = store
      .listAgentRuns(String(task.id))
      .find((run) => run.role === 'CODER');
    const coderEvents = store.listAgentEvents(coderRun!.id);
    expect(JSON.stringify(coderEvents)).toContain('src/message.txt');
    expect(JSON.stringify(coderEvents)).not.toContain('hello codexflow');
    expect(store.getPlan(String(task.id))).toMatchObject({
      content: 'Change src/message.txt to say hello codexflow',
    });
    expect(store.getReview(String(task.id))).toMatchObject({ verdict: 'APPROVED' });
    expect(store.listTestRuns(String(task.id))).toHaveLength(1);
    expect(observed).toEqual(
      expect.arrayContaining([
        'agent.started:PLANNER',
        'agent.completed:PLANNER',
        'agent.started:CODER',
        'agent.completed:CODER',
        'agent.started:REVIEWER',
        'agent.completed:REVIEWER',
        'agent.started:TESTER',
        'agent.completed:TESTER',
      ]),
    );
  });
  it('persists coder failures and never reaches approval after denied edits', async () => {
    const fixture = await runtimeFixture();
    const { store, task } = fixture;
    const result = await executorFor(fixture, provider({ path: '.env', content: 'SECRET=1' })).execute(
      String(task.id),
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      finalState: 'FAILED',
      error: { code: 'PIPELINE_FAILED' },
    });
    expect(store.getTask(String(task.id))).toMatchObject({ status: 'FAILED' });
    expect(store.listAgentRuns(String(task.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'CODER', status: 'FAILED' }),
      ]),
    );
    const coderRun = store
      .listAgentRuns(String(task.id))
      .find((run) => run.role === 'CODER');
    expect(coderRun?.error).toContain('denied');
  });
  it('persists failed verification and blocks instead of pretending approval is ready', async () => {
    const fixture = await runtimeFixture('test -f missing.txt');
    const { store, task } = fixture;
    const result = await executorFor(
      fixture,
      provider({ path: 'src/message.txt', content: 'hello codexflow' }),
    ).execute(String(task.id));

    expect(result).toMatchObject({
      status: 'BLOCKED',
      finalState: 'BLOCKED',
      tests: [expect.objectContaining({ command: 'test -f missing.txt', status: 'FAILED' })],
      error: { code: 'REPAIR_REQUIRED' },
    });
    expect(store.getTask(String(task.id))).toMatchObject({ status: 'BLOCKED' });
    expect(store.listTestRuns(String(task.id))).toEqual([
      expect.objectContaining({ command: 'test -f missing.txt', status: 'FAILED' }),
    ]);
  });
  it('repairs a failed verification with the injected structured provider, then re-reviews and re-tests', async () => {
    const fixture = await runtimeFixture('test "$(cat src/message.txt)" = fixed');
    const outputs = ['broken', 'fixed'];
    const repairProvider: StructuredCoderProvider = {
      runCoder: async () => ({
        edits: [{ path: 'src/message.txt', content: outputs.shift()! }],
        explanation: 'deterministic repair fixture',
      }),
    };
    const result = await executorFor(fixture, repairProvider).execute(String(fixture.task.id));
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      finalState: 'READY_FOR_APPROVAL',
      repairAttempts: 1,
      tests: [expect.objectContaining({ status: 'PASSED' })],
    });
    expect(readFileSync(join(result.workspace!.rootPath, 'src', 'message.txt'), 'utf8')).toBe('fixed');
    expect(readFileSync(join(fixture.repositoryPath, 'src', 'message.txt'), 'utf8')).toBe('hello');
    expect(fixture.store.listAgentRuns(String(fixture.task.id))).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'REPAIR', status: 'COMPLETED' }),
    ]));
    expect(fixture.store.listReviews(String(fixture.task.id))).toHaveLength(2);
    expect(fixture.store.listTestRuns(String(fixture.task.id))).toHaveLength(2);
  });
  it('rejects invalid tasks, invalid states, duplicate active execution, and missing providers', async () => {
    const missingStore = new CodexFlowStore(openDatabase());
    await expect(new RuntimeExecutor({ store: missingStore }).execute('missing')).resolves.toMatchObject(
      { status: 'FAILED', error: { code: 'TASK_NOT_FOUND' } },
    );

    const invalid = await runtimeFixture();
    invalid.store.transitionTask(String(invalid.task.id), 'READY_FOR_APPROVAL');
    await expect(
      executorFor(invalid, provider({ path: 'x.txt', content: 'x' })).execute(String(invalid.task.id)),
    ).resolves.toMatchObject({ status: 'FAILED', error: { code: 'INVALID_TASK_STATE' } });

    const unconfigured = await runtimeFixture();
    await expect(executorFor(unconfigured).execute(String(unconfigured.task.id))).resolves.toMatchObject(
      { status: 'FAILED', finalState: 'FAILED', error: { code: 'PROVIDER_NOT_CONFIGURED' } },
    );

    const duplicate = await runtimeFixture();
    let release!: () => void;
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const slowProvider: StructuredCoderProvider = {
      runCoder: async () => {
        providerStarted();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { edits: [{ path: 'src/message.txt', content: 'hello codexflow' }] };
      },
    };
    const executor = executorFor(duplicate, slowProvider);
    const first = executor.execute(String(duplicate.task.id));
    await providerStartedPromise;
    await expect(executorFor(duplicate, slowProvider).execute(String(duplicate.task.id))).resolves.toMatchObject({
      status: 'FAILED',
      error: { code: 'DUPLICATE_EXECUTION' },
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });
  it('executes deterministic workflow to approval', async () => {
    await expect(runMockWorkflow('x')).resolves.toMatchObject({
      status: 'READY_FOR_APPROVAL',
      timeline: expect.arrayContaining([expect.objectContaining({ type: 'approval.required' })]),
    });
  });
});
