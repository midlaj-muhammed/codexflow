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
      count: 3,
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
});
