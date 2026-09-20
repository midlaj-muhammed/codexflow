import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexFlowStore, openDatabase } from './index.js';

describe('CodexFlowStore', () => {
  it('creates a missing parent directory for a durable database path', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexflow-db-'));
    const path = join(root, 'data', 'codexflow.sqlite');
    try {
      const db = openDatabase(path);
      expect(existsSync(path)).toBe(true);
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('migrates and persists the repository to task traceability chain', () => {
    const db = openDatabase();
    const store = new CodexFlowStore(db);
    const repository = store.createRepository({
      provider: 'github',
      owner: 'acme',
      name: 'demo',
      url: 'https://github.com/acme/demo',
      defaultBranch: 'main',
    });
    const project = store.createProject(repository.id as string, 'Demo');
    const task = store.createTask(project.id, 'Fix login timeout');
    const workspace = store.createWorkspace(
      task.id as string,
      '/tmp/task',
      'codexflow/task-x',
      'abc123',
    );
    expect(store.getRepository(repository.id as string)).toMatchObject({
      name: 'demo',
      defaultBranch: 'main',
    });
    expect(store.getTask(task.id as string)).toMatchObject({
      projectId: project.id,
      status: 'CREATED',
      deliveryStatus: null,
    });
    expect(workspace.taskId).toBe(task.id);
    expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toMatchObject({
      count: 9,
    });
  });
  it('persists fingerprint-bound approvals through the existing approvals table', () => {
    const store = new CodexFlowStore(openDatabase());
    const repository = store.createRepository({
      provider: 'github',
      owner: 'acme',
      name: 'approval-fixture',
      url: 'https://github.com/acme/approval-fixture',
      defaultBranch: 'main',
    });
    const project = store.createProject(String(repository.id), 'Approval fixture');
    const task = store.createTask(project.id, 'Persist approval');
    store.saveApproval({
      taskId: String(task.id),
      workspaceId: 'workspace-1',
      fingerprint: 'fingerprint',
      risk: { level: 'HIGH', score: 70, reasons: ['fixture'] },
      state: 'APPROVED',
      approvedBy: 'human',
      approvedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(store.loadApproval(String(task.id))).toMatchObject({
      workspaceId: 'workspace-1',
      fingerprint: 'fingerprint',
      state: 'APPROVED',
      risk: { level: 'HIGH' },
    });
  });
  it('stores OAuth session metadata without treating a credential as task data', () => {
    const store = new CodexFlowStore(openDatabase());
    const id = store.createGitHubSession({
      login: 'octocat',
      tokenCiphertext: 'encrypted-token-fixture',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(store.getGitHubSession(id)).toMatchObject({
      id,
      login: 'octocat',
      tokenCiphertext: 'encrypted-token-fixture',
    });
    store.deleteGitHubSession(id);
    expect(store.getGitHubSession(id)).toBeUndefined();
  });
  it('validates repository input and prevents empty task prompts', () => {
    const store = new CodexFlowStore(openDatabase());
    expect(() =>
      store.createRepository({
        provider: 'github',
        owner: '',
        name: 'x',
        url: 'not-a-url',
        defaultBranch: 'main',
      }),
    ).toThrow();
    expect(() => store.createTask('missing', ' ')).toThrow('Task prompt');
  });
  it('lists control-plane entities and resolves the task workspace', () => {
    const store = new CodexFlowStore(openDatabase());
    const repository = store.createRepository({
      provider: 'github', owner: 'acme', name: 'control-plane',
      url: 'https://github.com/acme/control-plane', defaultBranch: 'main', localPath: '/tmp/control-plane',
    });
    const project = store.createProject(String(repository.id), 'Control plane', { framework: 'Next.js' });
    const task = store.createTask(project.id, 'Show persisted task state');
    store.createWorkspace(String(task.id), '/tmp/control-plane/task', 'codexflow/task-ui', 'base');
    expect(store.listRepositories()).toHaveLength(1);
    expect(store.listProjects()[0]).toMatchObject({ id: project.id, metadata: { framework: 'Next.js' } });
    expect(store.listTasks()).toHaveLength(1);
    expect(store.getWorkspaceForTask(String(task.id))).toMatchObject({ branch: 'codexflow/task-ui' });
  });
  it('persists agent runs, plans, reviews, and real test runs through public contracts', () => {
    const store = new CodexFlowStore(openDatabase());
    const repository = store.createRepository({
      provider: 'github',
      owner: 'acme',
      name: 'runtime-contracts',
      url: 'https://github.com/acme/runtime-contracts',
      defaultBranch: 'main',
    });
    const project = store.createProject(String(repository.id), 'Runtime contracts');
    const task = store.createTask(project.id, 'Expose runtime persistence contracts');
    const workspace = store.createWorkspace(
      String(task.id),
      '/tmp/runtime-contracts/task',
      'codexflow/task-runtime',
      'base-sha',
    );

    const run = store.createAgentRun({
      taskId: String(task.id),
      workspaceId: workspace.id,
      role: 'PLANNER',
      attempt: 1,
    });
    expect(run).toMatchObject({
      taskId: task.id,
      workspaceId: workspace.id,
      role: 'PLANNER',
      status: 'RUNNING',
      attempt: 1,
    });

    const completed = store.updateAgentRun(run.id, { status: 'COMPLETED' });
    expect(completed).toMatchObject({ id: run.id, status: 'COMPLETED' });
    expect(completed.finishedAt).toBeTruthy();
    expect(store.getAgentRun(run.id)).toMatchObject({ id: run.id, status: 'COMPLETED' });
    expect(store.listAgentRuns(String(task.id))).toHaveLength(1);
    expect(store.listTaskTimeline(String(task.id))[0]).toMatchObject({ role: 'PLANNER' });
    const event = store.appendAgentEvent({
      agentRunId: run.id,
      type: 'agent.completed',
      payload: { role: 'PLANNER', safe: true },
    });
    expect(store.getAgentEvent(event.id)).toMatchObject({
      agentRunId: run.id,
      payload: { role: 'PLANNER', safe: true },
    });
    expect(store.listAgentEvents(run.id)).toHaveLength(1);

    const plan = store.createPlan({
      taskId: String(task.id),
      agentRunId: run.id,
      content: 'Plan the change',
      affectedFiles: ['src/message.txt'],
      risks: ['low-risk text update'],
    });
    expect(store.getPlan(String(task.id))).toMatchObject({
      id: plan.id,
      affectedFiles: ['src/message.txt'],
      risks: ['low-risk text update'],
    });
    expect(store.listPlans(String(task.id))).toHaveLength(1);

    const review = store.createReview({
      taskId: String(task.id),
      agentRunId: run.id,
      verdict: 'APPROVED',
      findings: [{ severity: 'LOW', message: 'Looks safe', file: 'src/message.txt' }],
    });
    expect(store.getReview(String(task.id))).toMatchObject({
      id: review.id,
      verdict: 'APPROVED',
      findings: [expect.objectContaining({ message: 'Looks safe' })],
    });
    expect(store.listReviews(String(task.id))).toHaveLength(1);

    const testRunId = store.recordTestRun({
      taskId: String(task.id),
      command: 'printf ok',
      status: 'PASSED',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 5,
    });
    expect(testRunId).toBeTruthy();
    expect(store.listTestRuns(String(task.id))).toEqual([
      expect.objectContaining({ command: 'printf ok', status: 'PASSED', exitCode: 0 }),
    ]);
  });
  it('uses a durable execution lease to prevent concurrent task execution and reclaim stale work', () => {
    const store = new CodexFlowStore(openDatabase());
    const repository = store.createRepository({ provider: 'github', owner: 'acme', name: 'locks', url: 'https://github.com/acme/locks', defaultBranch: 'main' });
    const project = store.createProject(String(repository.id), 'Locks');
    const task = store.createTask(String(project.id), 'Lock execution');
    expect(store.acquireTaskExecutionLock(String(task.id), 'runtime-a', 1_000)).toBe(true);
    expect(store.acquireTaskExecutionLock(String(task.id), 'runtime-b', 1_000)).toBe(false);
    expect(store.getTaskExecutionLock(String(task.id))).toMatchObject({ ownerId: 'runtime-a' });
    store.releaseTaskExecutionLock(String(task.id), 'runtime-a');
    expect(store.acquireTaskExecutionLock(String(task.id), 'runtime-b', 1_000)).toBe(true);
    expect(store.listTaskExecutionLocks()).toHaveLength(1);
    expect(store.releaseExpiredTaskExecutionLocks(new Date(Date.now() + 2_000).toISOString())).toBe(1);
    expect(store.listTaskExecutionLocks()).toHaveLength(0);
  });
  it('persists versioned benchmarks, tasks, and reproducible evaluation results', () => {
    const store = new CodexFlowStore(openDatabase());
    const benchmark = store.createBenchmark({ name: 'starter', description: 'controlled fixtures', version: '1.0.0' });
    const task = store.createBenchmarkTask({
      benchmarkId: benchmark.id,
      name: 'add',
      prompt: 'Implement add.',
      verificationCommand: 'node tests/add.test.js',
      expectedBehavior: '2 + 3 is 5',
      metadata: { fixture: 'math-v1' },
    });
    const run = store.createEvaluationRun({
      benchmarkTaskId: task.id,
      repositoryCommit: 'base-sha',
      provider: 'openai',
      model: 'gpt-test',
      finalState: 'READY_FOR_APPROVAL',
      technicalSuccess: true,
      reviewPassed: true,
      verificationPassed: true,
      repairAttempts: 0,
      durationMs: 7,
      filesChanged: 1,
      linesAdded: 1,
      linesRemoved: 1,
    });
    expect(store.listBenchmarks()).toContainEqual(expect.objectContaining({ id: benchmark.id, version: '1.0.0' }));
    expect(store.getBenchmarkTask(task.id)).toMatchObject({ metadata: { fixture: 'math-v1' } });
    expect(store.getEvaluationRun(run.id)).toMatchObject({ repositoryCommit: 'base-sha', technicalSuccess: true });
  });
});
