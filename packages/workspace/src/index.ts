import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GitEngine, GitError } from '@codexflow/git';
export type Workspace = {
  id: string;
  taskId: string;
  rootPath: string;
  branch: string;
  baselineCommit: string;
  status: 'ACTIVE' | 'CLEANED_UP' | 'FAILED';
};
export class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>();
  constructor(
    private readonly git = new GitEngine(),
    private readonly root = join(process.cwd(), '.codexflow', 'workspaces'),
  ) {}
  async createWorkspace(input: { repositoryPath: string; taskId: string; baseBranch: string }) {
    const state = await this.git.inspect(input.repositoryPath);
    if (state.dirty || state.detached || state.conflicts)
      throw new GitError(
        'Repository must be clean, attached, and conflict-free before workspace creation',
      );
    const id = crypto.randomUUID();
    const branch = `codexflow/task-${input.taskId}`;
    const rootPath = resolve(this.root, input.taskId);
    await mkdir(this.root, { recursive: true });
    try {
      await this.git.worktreeAdd(input.repositoryPath, rootPath, branch, input.baseBranch);
    } catch (error) {
      await rm(rootPath, { recursive: true, force: true });
      throw error;
    }
    // The source checkout may be on a task branch. Persist the commit the
    // new worktree actually started from, which is the delivery baseline.
    const worktreeState = await this.git.inspect(rootPath);
    const workspace = {
      id,
      taskId: input.taskId,
      rootPath,
      branch,
      baselineCommit: worktreeState.head,
      status: 'ACTIVE' as const,
    };
    this.workspaces.set(id, workspace);
    return workspace;
  }
  getWorkspace(id: string) {
    return this.workspaces.get(id);
  }
  async getWorkspaceStatus(id: string) {
    const workspace = this.require(id);
    return { workspace, git: await this.git.inspect(workspace.rootPath) };
  }
  async destroyWorkspace(id: string) {
    const workspace = this.require(id);
    try {
      await this.git.worktreeRemove(workspace.rootPath, workspace.rootPath);
      workspace.status = 'CLEANED_UP';
    } catch (error) {
      workspace.status = 'FAILED';
      throw error;
    }
    return workspace;
  }
  cleanupWorkspace(id: string) {
    return this.destroyWorkspace(id);
  }
  private require(id: string) {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error(`Workspace not found: ${id}`);
    return workspace;
  }
}
