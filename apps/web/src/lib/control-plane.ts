import { ApprovalService, TesterAgent, type ProjectMetadata, scanProject } from '@codexflow/agents';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { DeliveryService, type DeliveryRecord } from '@codexflow/delivery';
import { calculateEvaluationMetrics, ensureStarterBenchmark } from '@codexflow/evaluation';
import { GitEngine } from '@codexflow/git';
import { GitHubProvider } from '@codexflow/providers';
import { EventBus, RuntimeExecutor, type RuntimeExecutionResult } from '@codexflow/runtime';
import { basename } from 'node:path';
import { join } from 'node:path';

type GlobalControlPlane = typeof globalThis & {
  __codexflowControlPlane?: {
    store: CodexFlowStore;
    git: GitEngine;
    events: EventBus;
    runtime: RuntimeExecutor;
    executions: Map<string, Promise<RuntimeExecutionResult>>;
  };
};

const globalControlPlane = globalThis as GlobalControlPlane;

/** Server-only gateway to the existing SQLite store and Git engine. */
export function controlPlane() {
  if (!globalControlPlane.__codexflowControlPlane) {
    const path = process.env.CODEXFLOW_DATABASE_PATH ?? '/tmp/codexflow-control-plane.sqlite';
    const store = new CodexFlowStore(openDatabase(path));
    const events = new EventBus();
    globalControlPlane.__codexflowControlPlane = {
      store,
      git: new GitEngine(),
      events,
      runtime: RuntimeExecutor.fromEnvironment({ store, events }),
      executions: new Map(),
    };
  }
  return globalControlPlane.__codexflowControlPlane;
}

function githubToken() {
  return process.env.CODEXFLOW_GITHUB_TOKEN ?? process.env.CODEXFLOW_GITHUB_E2E_TOKEN;
}

export async function githubConnection(token = githubToken()) {
  if (!token) return { connected: false as const };
  const provider = new GitHubProvider(token);
  const account = await provider.authenticate(token);
  return { connected: true as const, login: account.login };
}

export async function githubRepositories(token = githubToken()) {
  if (!token) throw new Error('GitHub is not connected on this server');
  return new GitHubProvider(token).listRepositories();
}
export async function importGitHubRepository(input: { owner: string; name: string; token: string }) {
  const { store, git } = controlPlane();
  const remote = await new GitHubProvider(input.token).getRepository(input.owner, input.name);
  const root = join(process.cwd(), '.codexflow', 'projects', `github-${remote.id}`);
  if (!(await git.isRepository(root))) await git.cloneGitHubRepository(remote.cloneUrl, root, remote.defaultBranch, input.token);
  const state = await git.inspect(root);
  const metadata = await scanProject(root);
  const repository = store.createRepository({ provider: 'github', owner: remote.owner, name: remote.name, url: remote.url, defaultBranch: remote.defaultBranch, localPath: root });
  const project = store.createProject(String(repository.id), remote.name, metadata as Record<string, unknown>);
  return { repository, project, git: state, scan: metadata };
}

/** Starts the existing RuntimeExecutor and deliberately does not orchestrate agents in HTTP code. */
export function startTaskExecution(taskId: string) {
  const plane = controlPlane();
  const existing = plane.executions.get(taskId);
  if (existing) return { started: false, execution: existing };
  if (!plane.store.getTask(taskId)) throw new Error('Task not found');
  const execution = plane.runtime.execute(taskId).finally(() => {
    plane.executions.delete(taskId);
  });
  plane.executions.set(taskId, execution);
  return { started: true, execution };
}

/** Delegates commit/push/PR creation to the frozen durable delivery saga. */
export async function deliverApprovedTask(taskId: string) {
  const { store, git, events } = controlPlane();
  const snapshot = taskSnapshot(taskId);
  if (!snapshot?.task || !snapshot.project || !snapshot.repository || !snapshot.workspace)
    throw new Error('Task delivery context is unavailable');
  if (snapshot.task.status !== 'APPROVED') throw new Error('Task is not approved for delivery');
  const token = process.env.CODEXFLOW_GITHUB_TOKEN ?? process.env.CODEXFLOW_GITHUB_E2E_TOKEN;
  if (!token) throw new Error('GitHub delivery provider is not configured');
  const diff = (await git.diff(String(snapshot.workspace.rootPath))).stdout;
  const changedFiles = (await git.changedFiles(String(snapshot.workspace.rootPath))).stdout
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  const metadata = (snapshot.project.metadata ?? {}) as Record<string, unknown>;
  const command = typeof metadata.testCommand === 'string' ? metadata.testCommand : 'git diff --check';
  const approval = store.loadApproval(taskId);
  if (!approval) throw new Error('Approval record is unavailable');
  const verification = {
    commands: [command],
    requiresNewTests: false,
    rationale: typeof metadata.testCommand === 'string'
      ? 'Project scan final verification'
      : 'No project test command was detected; verify the actual Git diff is syntactically clean.',
  };
  const delivery = new DeliveryService(
    git,
    new ApprovalService(store),
    new TesterAgent(),
    new GitHubProvider(token),
    undefined,
    undefined,
    store,
    { lifecycle: { recordDeliveryState: async (_taskId, status) => status }, events },
  );
  return delivery.deliver({
    taskId,
    workspaceId: String(snapshot.workspace.id),
    workspacePath: String(snapshot.workspace.rootPath),
    branch: String(snapshot.workspace.branch),
    baselineCommit: String(snapshot.workspace.baselineCommit),
    diff,
    changedFiles,
    verification,
    risk: approval.risk,
    owner: String(snapshot.repository.owner),
    repository: String(snapshot.repository.name),
    baseBranch: String(snapshot.repository.defaultBranch),
    taskPrompt: String(snapshot.task.prompt),
    agentRuns: snapshot.agents.map((agent) => ({ role: String(agent.role), status: String(agent.status) })),
    reviewFindings: snapshot.reviews[0]?.findings,
  });
}

/** Revalidates a delivered PR from GitHub; the delivery SHA must still be its head. */
export async function refreshTaskPullRequest(taskId: string) {
  const { store, git, events } = controlPlane();
  const snapshot = taskSnapshot(taskId);
  if (!snapshot?.workspace || !snapshot.repository || !snapshot.delivery.commit || !snapshot.approval)
    throw new Error('Pull request delivery context is unavailable');
  const pullRequest = snapshot.delivery.pullRequests.find((entry) => entry.status === 'SUCCEEDED');
  if (!pullRequest?.number) throw new Error('No delivered pull request is available');
  const token = process.env.CODEXFLOW_GITHUB_TOKEN ?? process.env.CODEXFLOW_GITHUB_E2E_TOKEN;
  if (!token) throw new Error('GitHub delivery provider is not configured');
  const metadata = (snapshot.project?.metadata ?? {}) as Record<string, unknown>;
  const record: DeliveryRecord = {
    taskId,
    workspaceId: String(snapshot.workspace.id),
    workspacePath: String(snapshot.workspace.rootPath),
    branch: String(snapshot.workspace.branch),
    baselineCommit: String(snapshot.workspace.baselineCommit),
    diff: '',
    changedFiles: [],
    verification: { commands: [typeof metadata.testCommand === 'string' ? metadata.testCommand : 'git diff --check'], requiresNewTests: false, rationale: 'Persisted delivery refresh' },
    risk: snapshot.approval.risk,
    owner: String(snapshot.repository.owner),
    repository: String(snapshot.repository.name),
    baseBranch: String(snapshot.repository.defaultBranch),
    commit: { sha: String(snapshot.delivery.commit.sha), message: String(snapshot.delivery.commit.message) },
    pullRequest: {
      id: String(pullRequest.number), number: Number(pullRequest.number), url: String(pullRequest.url),
      title: String(pullRequest.title), body: String(pullRequest.body),
      status: String(pullRequest.remoteStatus ?? 'OPEN') as 'OPEN' | 'CLOSED' | 'MERGED',
      headSha: pullRequest.headSha ? String(pullRequest.headSha) : undefined,
    },
  };
  const delivery = new DeliveryService(git, new ApprovalService(store), new TesterAgent(), new GitHubProvider(token), undefined, undefined, store,
    { lifecycle: { recordDeliveryState: async (_taskId, status) => status }, events });
  return delivery.refreshPullRequest(record);
}

function githubRemote(remote: string | undefined) {
  if (!remote) return undefined;
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? { owner: match[1], name: match[2], url: `https://github.com/${match[1]}/${match[2]}` } : undefined;
}

export async function importLocalRepository(input: {
  owner?: string;
  name?: string;
  url?: string;
  defaultBranch?: string;
  localPath: string;
}) {
  const { store, git } = controlPlane();
  if (!(await git.isRepository(input.localPath)))
    throw new Error('Selected local folder is not a Git repository. Initialize Git before importing it.');
  const state = await git.inspect(input.localPath);
  let remote: string | undefined;
  try { remote = (await git.remoteUrl(input.localPath)).stdout; } catch { /* local-only repository */ }
  const github = githubRemote(remote);
  const metadata = await scanProject(input.localPath);
  const name = input.name?.trim() || github?.name || basename(input.localPath);
  const owner = input.owner?.trim() || github?.owner || 'local';
  const repository = store.createRepository({
    provider: 'github', owner, name, url: input.url?.trim() || github?.url || `https://github.local/${owner}/${name}`,
    defaultBranch: input.defaultBranch?.trim() || state.branch || 'main', localPath: input.localPath,
  });
  const project = store.createProject(String(repository.id), name, metadata as Record<string, unknown>);
  return { repository, project, git: state, scan: metadata };
}

export async function inspectProjectHealth(projectId: string) {
  const { store, git } = controlPlane();
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const repository = store.getRepository(String((project as Record<string, unknown>).repositoryId));
  if (!repository?.localPath) throw new Error('Project does not have a local path');
  const metadata = (project.metadata ?? {}) as ProjectMetadata;
  const commands = [metadata.lintCommand, metadata.testCommand, metadata.buildCommand].filter(
    (command): command is string => typeof command === 'string' && command.trim().length > 0,
  );
  const gitState = await git.inspect(String(repository.localPath));
  const results = commands.length
    ? await new TesterAgent().verify(String(repository.localPath), { commands, requiresNewTests: false, rationale: 'Explicit project health inspection' })
    : [];
  return { project, repository, metadata, git: gitState, results };
}

const sensitivePath = /(^|\/)(\.env(?:\..*)?|credentials\.json|secrets\.|.*\.(pem|key))$/i;
export async function publishProjectToGitHub(input: { projectId: string; name: string; private: boolean; token?: string }) {
  const { store, git } = controlPlane();
  const token = input.token;
  if (!token) throw new Error('GitHub is not connected on this server');
  const project = store.getProject(input.projectId);
  if (!project) throw new Error('Project not found');
  const repository = store.getRepository(String((project as Record<string, unknown>).repositoryId));
  if (!repository?.localPath) throw new Error('Project does not have a local path');
  const path = String(repository.localPath);
  const state = await git.inspect(path);
  if (state.detached || state.conflicts || state.dirty)
    throw new Error('Publish requires a clean, attached, conflict-free local Git repository');
  try {
    await git.remoteUrl(path);
    throw new Error('An origin remote already exists; CodexFlow will not replace it automatically');
  } catch (error) {
    if (error instanceof Error && error.message.includes('will not replace')) throw error;
  }
  const tracked = (await git.listTrackedFiles(path)).stdout.split('\n').filter(Boolean);
  if (tracked.some((file) => sensitivePath.test(file)))
    throw new Error('Sensitive tracked files must be removed before publishing');
  const provider = new GitHubProvider(token);
  const created = await provider.createRepository({ name: input.name, private: input.private });
  await git.addRemote(path, 'origin', created.cloneUrl);
  await git.pushSetUpstreamAuthenticated(path, 'origin', state.branch!, token);
  const updated = store.updateRepository(String(repository.id), {
    owner: created.owner, name: created.name, url: created.url, defaultBranch: created.defaultBranch,
  });
  return { repository: updated, remote: { owner: created.owner, name: created.name, url: created.url }, branch: state.branch };
}

export async function repositorySnapshot(repository: Record<string, unknown>) {
  const localPath = typeof repository.localPath === 'string' ? repository.localPath : undefined;
  if (!localPath) return { status: 'NOT_CLONED' as const };
  try {
    const status = await controlPlane().git.inspect(localPath);
    return { status: 'AVAILABLE' as const, ...status };
  } catch (error) {
    return {
      status: 'UNAVAILABLE' as const,
      reason: error instanceof Error ? error.message : 'Repository status is unavailable',
    };
  }
}

export function taskSnapshot(taskId: string) {
  const { store } = controlPlane();
  const task = store.getTask(taskId);
  if (!task) return undefined;
  const project = store.getProject(String(task.projectId));
  const repository = project
    ? store.getRepository(String((project as Record<string, unknown>).repositoryId))
    : undefined;
  const workspace = store.getWorkspaceForTask(taskId);
  const approval = store.loadApproval(taskId);
  const commit = store.findLatestDeliveryCommit(taskId);
  const sha = commit ? String(commit.sha) : undefined;
  const agents = store.listTaskTimeline(taskId);
  return {
    task,
    project,
    repository,
    workspace,
    agents,
    agentEvents: agents.flatMap((agent) => store.listAgentEvents(agent.id)),
    plans: store.listPlans(taskId),
    reviews: store.listReviews(taskId),
    tests: store.listTestRuns(taskId),
    evaluations: store.listEvaluationRunsForTask(taskId),
    approval,
    delivery: commit
      ? {
          commit,
          pushes: store.listDeliveryPushes(taskId, sha!),
          pullRequests: store.listDeliveryPullRequests(taskId, sha!),
        }
      : { commit: undefined, pushes: [], pullRequests: [] },
  };
}

export function evaluationSnapshot() {
  const { store } = controlPlane();
  const starter = ensureStarterBenchmark(store);
  const runs = store.listEvaluationRuns();
  return { benchmarks: store.listBenchmarks().map((benchmark) => ({
    ...benchmark,
    taskCount: store.listBenchmarkTasks(benchmark.id).length,
  })), starter, runs, metrics: calculateEvaluationMetrics(runs) };
}

/** Derived solely from persisted runtime state; no synthetic operational metrics. */
export function operationsSnapshot() {
  const { store } = controlPlane();
  const reclaimedStaleLeases = store.releaseExpiredTaskExecutionLocks();
  const tasks = store.listTasks();
  const agentRuns = tasks.flatMap((task) => store.listAgentRuns(String(task.id)));
  const taskStates = tasks.reduce<Record<string, number>>((counts, task) => {
    const status = String(task.status);
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    tasks: { total: tasks.length, byState: taskStates, failed: tasks.filter((task) => ['FAILED', 'BLOCKED', 'CANCELLED'].includes(String(task.status))).length },
    agents: { total: agentRuns.length, failed: agentRuns.filter((run) => ['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(String(run.status))).length },
    execution: { activeLeases: store.listTaskExecutionLocks().length, reclaimedStaleLeases },
  };
}

export type ScanMetadata = ProjectMetadata;
