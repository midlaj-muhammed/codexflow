import { scanProject, type ProjectMetadata } from '@codexflow/agents';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { GitEngine } from '@codexflow/git';

type GlobalControlPlane = typeof globalThis & {
  __codexflowControlPlane?: { store: CodexFlowStore; git: GitEngine };
};

const globalControlPlane = globalThis as GlobalControlPlane;

/** Server-only gateway to the existing SQLite store and Git engine. */
export function controlPlane() {
  if (!globalControlPlane.__codexflowControlPlane) {
    const path = process.env.CODEXFLOW_DATABASE_PATH ?? '/tmp/codexflow-control-plane.sqlite';
    globalControlPlane.__codexflowControlPlane = {
      store: new CodexFlowStore(openDatabase(path)),
      git: new GitEngine(),
    };
  }
  return globalControlPlane.__codexflowControlPlane;
}

export async function importLocalRepository(input: {
  provider: 'github';
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  localPath: string;
}) {
  const { store, git } = controlPlane();
  const state = await git.inspect(input.localPath);
  const metadata = await scanProject(input.localPath);
  const repository = store.createRepository(input);
  const project = store.createProject(String(repository.id), input.name, metadata as Record<string, unknown>);
  return { repository, project, git: state, scan: metadata };
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
  return {
    task,
    project,
    repository,
    workspace,
    agents: store.listTaskTimeline(taskId),
    plans: store.listPlans(taskId),
    reviews: store.listReviews(taskId),
    tests: store.listTestRuns(taskId),
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

export type ScanMetadata = ProjectMetadata;
