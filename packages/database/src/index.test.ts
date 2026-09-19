import { describe, expect, it } from 'vitest';
import { CodexFlowStore, openDatabase } from './index.js';

describe('CodexFlowStore', () => {
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
      count: 4,
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
});
