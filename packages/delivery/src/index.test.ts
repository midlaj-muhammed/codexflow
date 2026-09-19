import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, CodexFlowStore } from '@codexflow/database';
import { ApprovalService, CoreAgentPipeline, RiskEngine, TesterAgent } from '@codexflow/agents';
import { GitEngine } from '@codexflow/git';
import { ProviderError, type GitProvider, type RemotePullRequest } from '@codexflow/providers';
import { EventBus, TaskLifecycleManager } from '@codexflow/runtime';
import { classifyDeliveryFailure, DeliveryService, type DeliveryRecord } from './index.js';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

function fixture(withRemote = false) {
  const root = mkdtempSync(join(tmpdir(), 'delivery-'));
  const path = join(root, 'repo');
  mkdirSync(path);
  git(path, 'init', '-b', 'codexflow/task-t');
  git(path, 'config', 'user.email', 'test@example.com');
  git(path, 'config', 'user.name', 'Test');
  const remote = join(root, 'remote.git');
  if (withRemote) {
    mkdirSync(remote);
    git(remote, 'init', '--bare');
    git(path, 'remote', 'add', 'origin', remote);
  }
  writeFileSync(join(path, 'a.txt'), 'old');
  git(path, 'add', 'a.txt');
  git(path, 'commit', '-m', 'base');
  const baseline = git(path, 'rev-parse', 'HEAD');
  writeFileSync(join(path, 'a.txt'), 'new');
  return { root, path, remote, baseline };
}

function provider(options: {
  failCreates?: number;
  existing?: RemotePullRequest;
  created?: RemotePullRequest;
} = {}): GitProvider & { creates: number; finds: number } {
  return {
    creates: 0,
    finds: 0,
    createPullRequest: async () => {
      options.failCreates ??= 0;
      if (options.failCreates > 0) {
        options.failCreates -= 1;
        throw new Error('provider unavailable');
      }
      return (
        options.created ?? {
          id: '42',
          number: 42,
          url: 'https://github.com/a/b/pull/42',
          title: 'CodexFlow: t',
          body: 'ok',
          status: 'OPEN',
        }
      );
    },
    findPullRequest: async () => options.existing,
    authenticate: async () => ({ login: 'x' }),
    listRepositories: async () => [],
    getRepository: async () => {
      throw new Error('unused');
    },
    listBranches: async () => [],
  };
}

function approvalsFor(taskId: string, workspaceId: string, diff: string) {
  const approvals = new ApprovalService();
  approvals.request(taskId, workspaceId, diff, { level: 'HIGH', score: 60, reasons: ['auth'] });
  approvals.approve(taskId, 'human', diff);
  return approvals;
}

function createStore(dbPath = ':memory:') {
  const db = openDatabase(dbPath);
  const store = new CodexFlowStore(db);
  const repo = store.createRepository({
    provider: 'github',
    owner: 'a',
    name: 'b',
    url: 'https://github.com/a/b',
    defaultBranch: 'main',
  });
  const project = store.createProject(String(repo.id), 'project');
  const task = store.createTask(project.id, 'change a.txt');
  return { db, store, task };
}

function workspaceStore(store: CodexFlowStore, taskId: string, repoPath: string, baseline: string) {
  return store.createWorkspace(taskId, repoPath, 'codexflow/task-t', baseline);
}

function record(input: {
  taskId: string;
  workspaceId: string;
  path: string;
  baseline: string;
  diff?: string;
}): DeliveryRecord {
  return {
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workspacePath: input.path,
    branch: 'codexflow/task-t',
    baselineCommit: input.baseline,
    diff: input.diff ?? 'old -> new',
    changedFiles: ['a.txt'],
    verification: { commands: ['test -f a.txt'], requiresNewTests: false, rationale: 'fixture' },
    risk: { level: 'HIGH', score: 60, reasons: ['auth'] },
    owner: 'a',
    repository: 'b',
    baseBranch: 'main',
  };
}

function service(input: {
  approvals: ApprovalService;
  provider?: GitProvider;
  store?: CodexFlowStore;
}) {
  return new DeliveryService(
    new GitEngine(),
    input.approvals,
    new TesterAgent(),
    input.provider ?? provider(),
    ['main', 'master', 'production'],
    undefined,
    input.store,
  );
}

describe('DeliveryService durable delivery', () => {
  it('continues a real planner, coder, reviewer, tester, risk, approval, and delivery flow', async () => {
    const { path, baseline } = fixture(true);
    const { db, store, task } = createStore();
    const workspace = workspaceStore(store, String(task.id), path, baseline);
    const pipeline = await new CoreAgentPipeline().run({
      prompt: 'Improve the fixture text',
      metadata: {
        language: ['TypeScript'],
        testCommand: 'test -f a.txt',
        sourceDirectories: [],
        testDirectories: [],
        configFiles: [],
      },
      workspacePath: path,
      modelOutput: JSON.stringify({ edits: [{ path: 'a.txt', content: 'newer' }] }),
      diff: 'fixture edit',
      changedFiles: ['a.txt'],
    });
    expect(pipeline.next).toBe('READY_FOR_APPROVAL');
    const diff = (await new GitEngine().diff(path)).stdout;
    const risk = new RiskEngine().assess({ changedFiles: pipeline.code.changedFiles, additions: 1, deletions: 1 });
    const delivery = record({ taskId: String(task.id), workspaceId: workspace.id, path, baseline, diff });
    delivery.changedFiles = pipeline.code.changedFiles;
    delivery.verification = pipeline.plan.verification;
    delivery.risk = risk;
    const approvals = new ApprovalService();
    approvals.request(delivery.taskId, delivery.workspaceId, diff, risk);
    approvals.approve(delivery.taskId, 'human', diff);
    const pullRequest = await service({ approvals, store }).deliver(delivery);

    expect(pullRequest.number).toBe(42);
    expect(store.getTask(delivery.taskId)?.deliveryStatus).toBe('PR_CREATED');
    db.close();
  });

  it('runs final verification, commits explicit files, persists, and is restart-idempotent', async () => {
    const { path, baseline } = fixture();
    const sqlite = join(mkdtempSync(join(tmpdir(), 'delivery-db-')), 'codexflow.sqlite');
    const firstStore = createStore(sqlite);
    const workspace = workspaceStore(firstStore.store, String(firstStore.task.id), path, baseline);
    const firstRecord = record({
      taskId: String(firstStore.task.id),
      workspaceId: workspace.id,
      path,
      baseline,
    });
    const firstApprovals = new ApprovalService(firstStore.store);
    firstApprovals.request(firstRecord.taskId, firstRecord.workspaceId, firstRecord.diff, {
      level: 'HIGH',
      score: 60,
      reasons: ['auth'],
    });
    firstApprovals.approve(firstRecord.taskId, 'human', firstRecord.diff);
    const first = await service({
      approvals: firstApprovals,
      store: firstStore.store,
    }).commit(firstRecord);
    firstStore.db.close();

    const secondDb = openDatabase(sqlite);
    const secondStore = new CodexFlowStore(secondDb);
    const secondRecord = record({
      taskId: firstRecord.taskId,
      workspaceId: firstRecord.workspaceId,
      path,
      baseline,
    });
    const second = await service({
      approvals: new ApprovalService(secondStore),
      store: secondStore,
    }).commit(secondRecord);

    expect(second.sha).toBe(first.sha);
    expect(secondStore.findDeliveryCommit(secondRecord.taskId, approvalsFor(secondRecord.taskId, secondRecord.workspaceId, secondRecord.diff).fingerprint(secondRecord.diff))?.sha).toBe(first.sha);
    expect(secondStore.getTask(secondRecord.taskId)?.deliveryStatus).toBe('COMMITTED');
    expect(secondStore.listTestRuns(secondRecord.taskId)).toEqual([
      expect.objectContaining({ command: 'test -f a.txt', status: 'PASSED' }),
    ]);
    secondDb.close();
  });

  it('classifies approval blocks, transient providers, and invalid provider configuration', () => {
    expect(classifyDeliveryFailure(new Error('High-risk task requires explicit human approval'))).toBe(
      'BLOCKED',
    );
    expect(classifyDeliveryFailure(new ProviderError('UNAVAILABLE', 'offline'))).toBe('RETRYABLE');
    expect(classifyDeliveryFailure(new ProviderError('VALIDATION', 'bad repository'))).toBe(
      'PERMANENT_FAILURE',
    );
  });

  it('pushes to a real bare remote and persists PUSHED state', async () => {
    const { path, remote, baseline } = fixture(true);
    const { db, store, task } = createStore();
    const workspace = workspaceStore(store, String(task.id), path, baseline);
    const delivery = record({ taskId: String(task.id), workspaceId: workspace.id, path, baseline });
    const approvals = approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff);
    const deliveryService = service({ approvals, store });

    const commit = await deliveryService.commit(delivery);
    await deliveryService.push(delivery);

    expect(git(remote, 'rev-parse', 'refs/heads/codexflow/task-t')).toBe(commit.sha);
    expect(store.findSuccessfulDeliveryPush(delivery.taskId, commit.sha)?.status).toBe('SUCCEEDED');
    expect(store.getTask(delivery.taskId)?.deliveryStatus).toBe('PUSHED');
    db.close();
  });

  it('persists real push failure and recovers retry after SQLite restart without a new commit', async () => {
    const { path, remote, baseline } = fixture(true);
    const sqlite = join(mkdtempSync(join(tmpdir(), 'delivery-db-')), 'codexflow.sqlite');
    const firstStore = createStore(sqlite);
    const workspace = workspaceStore(firstStore.store, String(firstStore.task.id), path, baseline);
    const delivery = record({
      taskId: String(firstStore.task.id),
      workspaceId: workspace.id,
      path,
      baseline,
    });
    const firstService = service({
      approvals: approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff),
      store: firstStore.store,
    });
    const commit = await firstService.commit(delivery);
    git(path, 'remote', 'set-url', 'origin', join(remote, 'missing.git'));
    await expect(firstService.push(delivery)).rejects.toThrow();
    expect(firstStore.store.getTask(delivery.taskId)?.deliveryStatus).toBe('PUSH_FAILED');
    firstStore.db.close();

    git(path, 'remote', 'set-url', 'origin', remote);
    const secondDb = openDatabase(sqlite);
    const secondStore = new CodexFlowStore(secondDb);
    const secondRecord = record({
      taskId: delivery.taskId,
      workspaceId: delivery.workspaceId,
      path,
      baseline,
    });
    await service({
      approvals: approvalsFor(secondRecord.taskId, secondRecord.workspaceId, secondRecord.diff),
      store: secondStore,
    }).push(secondRecord);

    const attempts = secondStore.listDeliveryPushes(secondRecord.taskId, commit.sha);
    expect(attempts.map((attempt) => attempt.status)).toEqual(['FAILED', 'SUCCEEDED']);
    expect(git(remote, 'rev-parse', 'refs/heads/codexflow/task-t')).toBe(commit.sha);
    expect(secondStore.getTask(secondRecord.taskId)?.deliveryStatus).toBe('PUSHED');
    secondDb.close();

    const thirdDb = openDatabase(sqlite);
    const thirdStore = new CodexFlowStore(thirdDb);
    await service({
      approvals: approvalsFor(secondRecord.taskId, secondRecord.workspaceId, secondRecord.diff),
      store: thirdStore,
    }).push(secondRecord);
    expect(thirdStore.listDeliveryPushes(secondRecord.taskId, commit.sha)).toHaveLength(2);
    thirdDb.close();
  });

  it('persists PR failure and recovers retry after restart without another commit or push', async () => {
    const { path, baseline } = fixture(true);
    const sqlite = join(mkdtempSync(join(tmpdir(), 'delivery-db-')), 'codexflow.sqlite');
    const firstStore = createStore(sqlite);
    const workspace = workspaceStore(firstStore.store, String(firstStore.task.id), path, baseline);
    const delivery = record({
      taskId: String(firstStore.task.id),
      workspaceId: workspace.id,
      path,
      baseline,
    });
    const firstService = service({
      approvals: approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff),
      provider: provider({ failCreates: 1 }),
      store: firstStore.store,
    });
    const commit = await firstService.commit(delivery);
    await firstService.push(delivery);
    await expect(firstService.createPullRequest(delivery)).rejects.toThrow('provider unavailable');
    expect(firstStore.store.getTask(delivery.taskId)?.deliveryStatus).toBe('PR_FAILED');
    firstStore.db.close();

    const secondDb = openDatabase(sqlite);
    const secondStore = new CodexFlowStore(secondDb);
    const secondRecord = record({
      taskId: delivery.taskId,
      workspaceId: delivery.workspaceId,
      path,
      baseline,
    });
    const pullRequest = await service({
      approvals: approvalsFor(secondRecord.taskId, secondRecord.workspaceId, secondRecord.diff),
      provider: provider(),
      store: secondStore,
    }).createPullRequest(secondRecord);

    expect(pullRequest.number).toBe(42);
    expect(secondStore.listDeliveryPushes(secondRecord.taskId, commit.sha)).toHaveLength(1);
    expect(secondStore.listDeliveryPullRequests(secondRecord.taskId, commit.sha).map((attempt) => attempt.status)).toEqual([
      'FAILED',
      'SUCCEEDED',
    ]);
    expect(secondStore.getTask(secondRecord.taskId)?.deliveryStatus).toBe('PR_CREATED');
    secondDb.close();

    const thirdDb = openDatabase(sqlite);
    const thirdStore = new CodexFlowStore(thirdDb);
    const existing = await service({
      approvals: approvalsFor(secondRecord.taskId, secondRecord.workspaceId, secondRecord.diff),
      provider: provider({ failCreates: 1 }),
      store: thirdStore,
    }).createPullRequest(secondRecord);
    expect(existing.number).toBe(42);
    expect(thirdStore.listDeliveryPullRequests(secondRecord.taskId, commit.sha)).toHaveLength(2);
    thirdDb.close();
  });

  it('reconciles commit, push, and PR side effects that succeeded before persistence', async () => {
    const { path, baseline } = fixture(true);
    const { db, store, task } = createStore();
    const workspace = workspaceStore(store, String(task.id), path, baseline);
    const delivery = record({ taskId: String(task.id), workspaceId: workspace.id, path, baseline });
    const approvals = approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff);
    const stateless = service({ approvals, provider: provider() });
    const commit = await stateless.commit(delivery);
    const persisted = record({ taskId: delivery.taskId, workspaceId: delivery.workspaceId, path, baseline });
    const stateful = service({
      approvals: approvalsFor(persisted.taskId, persisted.workspaceId, persisted.diff),
      store,
    });
    expect((await stateful.commit(persisted)).sha).toBe(commit.sha);

    await new GitEngine().push(path, 'origin', persisted.branch);
    const afterPushCrash = record({
      taskId: delivery.taskId,
      workspaceId: delivery.workspaceId,
      path,
      baseline,
    });
    await service({
      approvals: approvalsFor(afterPushCrash.taskId, afterPushCrash.workspaceId, afterPushCrash.diff),
      store,
    }).push(afterPushCrash);
    expect(store.findSuccessfulDeliveryPush(delivery.taskId, commit.sha)?.status).toBe('SUCCEEDED');

    const existingPr: RemotePullRequest = {
      id: '99',
      number: 99,
      url: 'https://github.com/a/b/pull/99',
      title: 'Recovered',
      body: 'Recovered existing PR',
      status: 'OPEN',
    };
    const recovered = await service({
      approvals: approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff),
      provider: provider({ existing: existingPr }),
      store,
    }).createPullRequest(
      record({ taskId: delivery.taskId, workspaceId: delivery.workspaceId, path, baseline }),
    );
    expect(recovered.number).toBe(99);
    expect(store.findSuccessfulDeliveryPullRequest(delivery.taskId, delivery.branch, commit.sha)?.number).toBe(99);
    db.close();
  });

  it('blocks stale approval, sensitive paths, and protected branches', async () => {
    const { path, baseline } = fixture();
    const approvals = new ApprovalService();
    approvals.request('t', 'w', 'before', { level: 'HIGH', score: 60, reasons: ['x'] });
    approvals.approve('t', 'human', 'before');
    const stale = record({ taskId: 't', workspaceId: 'w', path, baseline, diff: 'after' });
    stale.changedFiles = ['.env'];
    await expect(service({ approvals }).commit(stale)).rejects.toThrow();

    const protectedRecord = record({ taskId: 't', workspaceId: 'w', path, baseline, diff: 'before' });
    protectedRecord.branch = 'main';
    await expect(service({ approvals }).commit(protectedRecord)).rejects.toThrow(
      'Protected branch delivery is forbidden',
    );
  });

  it('does not create a duplicate PR when provider discovery reports another commit on the branch', async () => {
    const { path, baseline } = fixture(true);
    const { db, store, task } = createStore();
    const workspace = workspaceStore(store, String(task.id), path, baseline);
    const delivery = record({ taskId: String(task.id), workspaceId: workspace.id, path, baseline });
    const fake = provider({
      existing: {
        id: 'existing',
        number: 8,
        url: 'https://github.com/a/b/pull/8',
        title: 'Existing branch PR',
        body: 'Existing branch PR',
        status: 'OPEN',
        headSha: 'different-commit',
      },
    });
    const deliveryService = service({
      approvals: approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff),
      provider: fake,
      store,
    });
    await deliveryService.commit(delivery);
    await deliveryService.push(delivery);
    await expect(deliveryService.createPullRequest(delivery)).rejects.toThrow(
      'Existing pull request does not reference the committed delivery SHA',
    );
    expect(fake.creates).toBe(0);
    db.close();
  });

  it('orchestrates delivery through runtime events and uses actual verification records in PR metadata', async () => {
    const { path, baseline } = fixture(true);
    const { db, store, task } = createStore();
    const workspace = workspaceStore(store, String(task.id), path, baseline);
    const delivery = record({ taskId: String(task.id), workspaceId: workspace.id, path, baseline });
    const observed: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const lifecycle = new TaskLifecycleManager({
      saveTaskState: (taskId, status) => {
        store.transitionTask(taskId, status);
      },
      saveDeliveryState: (taskId, status, error) => {
        store.setTaskDeliveryStatus(taskId, status, error);
      },
      appendEvent: () => {},
    });
    const events = new EventBus({
      saveTaskState: () => {},
      appendEvent: (event) => {
        observed.push(event);
      },
    });
    events.subscribe((event) => {
      observed.push(event);
    });
    await lifecycle.create(delivery.taskId);
    for (const status of [
      'QUEUED',
      'PLANNING',
      'CONTEXT_READY',
      'CODING',
      'REVIEWING',
      'TESTING',
      'READY_FOR_APPROVAL',
      'APPROVED',
    ] as const)
      await lifecycle.transition(delivery.taskId, status);
    const pullRequest = await new DeliveryService(
      new GitEngine(),
      approvalsFor(delivery.taskId, delivery.workspaceId, delivery.diff),
      new TesterAgent(),
      provider(),
      ['main', 'master', 'production'],
      undefined,
      store,
      { lifecycle, events },
    ).deliver(delivery);

    expect(pullRequest.number).toBe(42);
    expect(store.listTestRuns(delivery.taskId)).toEqual([
      expect.objectContaining({ command: 'test -f a.txt', status: 'PASSED' }),
    ]);
    expect(store.findSuccessfulDeliveryPullRequest(delivery.taskId, delivery.branch, delivery.commit!.sha)?.body).toContain(
      'test -f a.txt: PASSED',
    );
    expect(store.getTask(delivery.taskId)?.deliveryStatus).toBe('PR_CREATED');
    expect(store.getTask(delivery.taskId)?.status).toBe('APPROVED');
    expect(observed.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'delivery.started',
        'commit.completed',
        'push.completed',
        'pr.completed',
        'delivery.completed',
      ]),
    );
    expect(observed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'commit.completed',
          payload: expect.objectContaining({ workspaceId: workspace.id, branch: delivery.branch }),
        }),
      ]),
    );
    expect(JSON.stringify(observed)).not.toContain('top-secret');
    db.close();
  });
});
