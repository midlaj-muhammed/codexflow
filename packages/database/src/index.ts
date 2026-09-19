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
  `CREATE TABLE IF NOT EXISTS delivery_commits (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, sha TEXT NOT NULL, branch TEXT NOT NULL, message TEXT NOT NULL, baseline_sha TEXT NOT NULL, diff_fingerprint TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS delivery_commits_task_fingerprint ON delivery_commits(task_id, diff_fingerprint);
   CREATE TABLE IF NOT EXISTS delivery_pushes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, branch TEXT NOT NULL, remote TEXT NOT NULL, commit_sha TEXT NOT NULL, status TEXT NOT NULL, error TEXT, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
   CREATE TABLE IF NOT EXISTS delivery_pull_requests (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL, base_branch TEXT NOT NULL, commit_sha TEXT NOT NULL, number INTEGER, url TEXT, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, error TEXT, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);`,
  `ALTER TABLE tasks ADD COLUMN delivery_status TEXT;
   ALTER TABLE tasks ADD COLUMN delivery_error TEXT;
   CREATE INDEX IF NOT EXISTS delivery_pushes_task_commit ON delivery_pushes(task_id, commit_sha);
   CREATE INDEX IF NOT EXISTS delivery_pull_requests_task_commit ON delivery_pull_requests(task_id, commit_sha);
   CREATE UNIQUE INDEX IF NOT EXISTS delivery_pull_requests_success ON delivery_pull_requests(task_id, branch, commit_sha) WHERE status = 'SUCCEEDED';`,
];

export type DeliveryStatus =
  | 'APPROVED'
  | 'COMMITTED'
  | 'PUSH_FAILED'
  | 'PUSHED'
  | 'PR_FAILED'
  | 'PR_CREATED';
export type DeliveryAttemptStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

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
      .prepare(
        'INSERT INTO tasks (id, project_id, prompt, status, risk_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, prompt, 'CREATED', null, timestamp, timestamp);
    return this.getTask(id)!;
  }
  getTask(id: string) {
    return this.db
      .prepare(
        'SELECT id, project_id AS projectId, prompt, status, risk_level AS riskLevel, delivery_status AS deliveryStatus, delivery_error AS deliveryError, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?',
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
  setTaskDeliveryStatus(id: string, status: DeliveryStatus, error?: string) {
    const result = this.db
      .prepare('UPDATE tasks SET delivery_status = ?, delivery_error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ?? null, now(), id);
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
  recordTestRun(input: {
    taskId: string;
    command: string;
    status: 'PASSED' | 'FAILED';
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  }) {
    const id = randomUUID(),
      timestamp = now();
    this.db
      .prepare(
        'INSERT INTO test_runs (id, task_id, test_plan_id, command, status, exit_code, stdout, stderr, duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.taskId,
        null,
        input.command,
        input.status,
        input.exitCode,
        input.stdout,
        input.stderr,
        input.durationMs,
        timestamp,
        timestamp,
      );
    return id;
  }
  listTestRuns(taskId: string) {
    return this.db
      .prepare(
        'SELECT id, task_id AS taskId, command, status, exit_code AS exitCode, stdout, stderr, duration_ms AS durationMs, created_at AS createdAt FROM test_runs WHERE task_id = ? ORDER BY created_at ASC',
      )
      .all(taskId) as Record<string, unknown>[];
  }
  createDeliveryCommit(input: {
    taskId: string;
    workspaceId: string;
    sha: string;
    branch: string;
    message: string;
    baselineSha: string;
    diffFingerprint: string;
    status?: string;
  }) {
    const id = randomUUID(),
      createdAt = now();
    this.db
      .prepare('INSERT OR IGNORE INTO delivery_commits VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        input.taskId,
        input.workspaceId,
        input.sha,
        input.branch,
        input.message,
        input.baselineSha,
        input.diffFingerprint,
        input.status ?? 'COMMITTED',
        createdAt,
      );
    return this.findDeliveryCommit(input.taskId, input.diffFingerprint)!;
  }
  findDeliveryCommit(taskId: string, diffFingerprint: string) {
    return this.db
      .prepare(
        'SELECT id, task_id AS taskId, workspace_id AS workspaceId, sha, branch, message, baseline_sha AS baselineSha, diff_fingerprint AS diffFingerprint, status, created_at AS createdAt FROM delivery_commits WHERE task_id = ? AND diff_fingerprint = ?',
      )
      .get(taskId, diffFingerprint) as Record<string, unknown> | undefined;
  }
  createDeliveryPush(input: {
    taskId: string;
    workspaceId: string;
    branch: string;
    remote: string;
    commitSha: string;
    status: DeliveryAttemptStatus;
    error?: string;
    attempt: number;
  }) {
    const id = randomUUID(),
      createdAt = now();
    this.db
      .prepare('INSERT INTO delivery_pushes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        input.taskId,
        input.workspaceId,
        input.branch,
        input.remote,
        input.commitSha,
        input.status,
        input.error ?? null,
        input.attempt,
        createdAt,
        input.status === 'SUCCEEDED' ? createdAt : null,
      );
    return id;
  }
  updateDeliveryPush(id: string, status: DeliveryAttemptStatus, error?: string) {
    const completedAt = status === 'PENDING' ? null : now();
    const result = this.db
      .prepare('UPDATE delivery_pushes SET status = ?, error = ?, completed_at = ? WHERE id = ?')
      .run(status, error ?? null, completedAt, id);
    if (result.changes !== 1) throw new Error(`Delivery push not found: ${id}`);
  }
  listDeliveryPushes(taskId: string, commitSha: string) {
    return this.db
      .prepare(
        'SELECT id, task_id AS taskId, workspace_id AS workspaceId, branch, remote, commit_sha AS commitSha, status, error, attempt, created_at AS createdAt, completed_at AS completedAt FROM delivery_pushes WHERE task_id = ? AND commit_sha = ? ORDER BY attempt ASC, created_at ASC',
      )
      .all(taskId, commitSha) as Record<string, unknown>[];
  }
  findSuccessfulDeliveryPush(taskId: string, commitSha: string) {
    return this.db
      .prepare(
        "SELECT id, task_id AS taskId, workspace_id AS workspaceId, branch, remote, commit_sha AS commitSha, status, error, attempt, created_at AS createdAt, completed_at AS completedAt FROM delivery_pushes WHERE task_id = ? AND commit_sha = ? AND status = 'SUCCEEDED' ORDER BY completed_at DESC LIMIT 1",
      )
      .get(taskId, commitSha) as Record<string, unknown> | undefined;
  }
  createDeliveryPullRequest(input: {
    taskId: string;
    workspaceId: string;
    provider: string;
    repository: string;
    branch: string;
    baseBranch: string;
    commitSha: string;
    number?: number;
    url?: string;
    title: string;
    body: string;
    status: DeliveryAttemptStatus;
    error?: string;
    attempt: number;
  }) {
    const id = randomUUID(),
      createdAt = now();
    this.db
      .prepare(
        'INSERT INTO delivery_pull_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.taskId,
        input.workspaceId,
        input.provider,
        input.repository,
        input.branch,
        input.baseBranch,
        input.commitSha,
        input.number ?? null,
        input.url ?? null,
        input.title,
        input.body,
        input.status,
        input.error ?? null,
        input.attempt,
        createdAt,
        input.status === 'SUCCEEDED' || input.status === 'FAILED' ? createdAt : null,
      );
    return id;
  }
  updateDeliveryPullRequest(
    id: string,
    input: {
      status: DeliveryAttemptStatus;
      number?: number;
      url?: string;
      error?: string;
    },
  ) {
    const completedAt = input.status === 'PENDING' ? null : now();
    const result = this.db
      .prepare(
        'UPDATE delivery_pull_requests SET status = ?, number = COALESCE(?, number), url = COALESCE(?, url), error = ?, completed_at = ? WHERE id = ?',
      )
      .run(input.status, input.number ?? null, input.url ?? null, input.error ?? null, completedAt, id);
    if (result.changes !== 1) throw new Error(`Delivery pull request not found: ${id}`);
  }
  listDeliveryPullRequests(taskId: string, commitSha: string) {
    return this.db
      .prepare(
        'SELECT id, task_id AS taskId, workspace_id AS workspaceId, provider, repository, branch, base_branch AS baseBranch, commit_sha AS commitSha, number, url, title, body, status, error, attempt, created_at AS createdAt, completed_at AS completedAt FROM delivery_pull_requests WHERE task_id = ? AND commit_sha = ? ORDER BY attempt ASC, created_at ASC',
      )
      .all(taskId, commitSha) as Record<string, unknown>[];
  }
  findSuccessfulDeliveryPullRequest(taskId: string, branch: string, commitSha: string) {
    return this.db
      .prepare(
        "SELECT id, task_id AS taskId, workspace_id AS workspaceId, provider, repository, branch, base_branch AS baseBranch, commit_sha AS commitSha, number, url, title, body, status, error, attempt, created_at AS createdAt, completed_at AS completedAt FROM delivery_pull_requests WHERE task_id = ? AND branch = ? AND commit_sha = ? AND status = 'SUCCEEDED' ORDER BY completed_at DESC LIMIT 1",
      )
      .get(taskId, branch, commitSha) as Record<string, unknown> | undefined;
  }
}
