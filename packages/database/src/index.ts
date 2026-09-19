import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type Database = DatabaseSync;
const now = () => new Date().toISOString();

const migrations = [
  `CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, provider TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, default_branch TEXT NOT NULL, local_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id), name TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), prompt TEXT NOT NULL, status TEXT NOT NULL, risk_level TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), root_path TEXT NOT NULL, branch TEXT NOT NULL, baseline_commit TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), workspace_id TEXT REFERENCES workspaces(id), role TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL, started_at TEXT, finished_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL REFERENCES agent_runs(id), type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), agent_run_id TEXT REFERENCES agent_runs(id), content TEXT NOT NULL, affected_files TEXT NOT NULL, risks TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS test_plans (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), strategy TEXT NOT NULL, commands TEXT NOT NULL, requires_new_tests INTEGER NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), test_plan_id TEXT REFERENCES test_plans(id), command TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, stdout TEXT NOT NULL, stderr TEXT NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), agent_run_id TEXT REFERENCES agent_runs(id), verdict TEXT NOT NULL, findings TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), decision TEXT NOT NULL, approved_by TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS commits (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), sha TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS pull_requests (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), provider_id TEXT NOT NULL, number INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS pull_request_comments (id TEXT PRIMARY KEY, pull_request_id TEXT NOT NULL REFERENCES pull_requests(id), provider_id TEXT, body TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), benchmark_id TEXT NOT NULL, pass_at_1 INTEGER NOT NULL, pass_at_3 INTEGER NOT NULL, regression_detected INTEGER NOT NULL, repair_attempts INTEGER NOT NULL, duration_ms INTEGER NOT NULL, files_changed INTEGER NOT NULL, lines_added INTEGER NOT NULL, lines_removed INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
];

export function openDatabase(path = ':memory:'): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  migrations.forEach((sql, index) => {
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(index + 1)) {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(index + 1);
    }
  });
  return db;
}

type CreateRepository = {
  provider: 'github' | 'gitlab' | 'bitbucket';
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  localPath?: string;
};
const createRepositorySchema = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  defaultBranch: z.string().min(1),
  localPath: z.string().optional(),
});
export class CodexFlowStore {
  constructor(private readonly db: Database) {}
  createRepository(input: CreateRepository) {
    const value = createRepositorySchema.parse(input);
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        value.provider,
        value.owner,
        value.name,
        value.url,
        value.defaultBranch,
        value.localPath ?? null,
        timestamp,
        timestamp,
      );
    return this.getRepository(id)!;
  }
  getRepository(id: string) {
    return this.db
      .prepare(
        'SELECT id, provider, owner, name, url, default_branch AS defaultBranch, local_path AS localPath, created_at AS createdAt, updated_at AS updatedAt FROM repositories WHERE id = ?',
      )
      .get(id) as Record<string, unknown> | undefined;
  }
  createProject(repositoryId: string, name: string, metadata: Record<string, unknown> = {}) {
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, repositoryId, name, JSON.stringify(metadata), timestamp, timestamp);
    return { id, repositoryId, name, metadata, createdAt: timestamp, updatedAt: timestamp };
  }
  createTask(projectId: string, prompt: string) {
    if (!prompt.trim()) throw new Error('Task prompt must not be empty');
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, prompt, 'CREATED', null, timestamp, timestamp);
    return this.getTask(id)!;
  }
  getTask(id: string) {
    return this.db
      .prepare(
        'SELECT id, project_id AS projectId, prompt, status, risk_level AS riskLevel, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?',
      )
      .get(id) as Record<string, unknown> | undefined;
  }
  transitionTask(id: string, status: string) {
    const result = this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);
    if (result.changes !== 1) throw new Error(`Task not found: ${id}`);
    return this.getTask(id)!;
  }
  createWorkspace(taskId: string, rootPath: string, branch: string, baselineCommit: string) {
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, taskId, rootPath, branch, baselineCommit, 'ACTIVE', timestamp, timestamp);
    return {
      id,
      taskId,
      rootPath,
      branch,
      baselineCommit,
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  listTaskTimeline(taskId: string) {
    return this.db
      .prepare(
        'SELECT ar.id, ar.role, ar.status, ar.attempt, ar.started_at AS startedAt, ar.finished_at AS finishedAt FROM agent_runs ar WHERE ar.task_id = ? ORDER BY ar.created_at',
      )
      .all(taskId);
  }
}
