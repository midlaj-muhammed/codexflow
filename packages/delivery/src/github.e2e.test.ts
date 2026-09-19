import { appendFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalService, TesterAgent } from '@codexflow/agents';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { GitEngine } from '@codexflow/git';
import { GitHubProvider } from '@codexflow/providers';
import { DeliveryService } from './index.js';

const config = {
  enabled: process.env.CODEXFLOW_GITHUB_E2E_ENABLED === 'true',
  token: process.env.CODEXFLOW_GITHUB_E2E_TOKEN,
  owner: process.env.CODEXFLOW_GITHUB_E2E_OWNER,
  repository: process.env.CODEXFLOW_GITHUB_E2E_REPOSITORY,
  baseBranch: process.env.CODEXFLOW_GITHUB_E2E_BASE_BRANCH,
  workspace: process.env.CODEXFLOW_GITHUB_E2E_WORKSPACE,
  changedFile: process.env.CODEXFLOW_GITHUB_E2E_CHANGED_FILE,
};
const configured =
  config.enabled &&
  [
    config.token,
    config.owner,
    config.repository,
    config.baseBranch,
    config.workspace,
    config.changedFile,
  ].every((value) => typeof value === 'string' && value.length > 0);
const suite = configured ? describe : describe.skip;

suite('GitHub delivery E2E (explicitly configured disposable workspace)', () => {
  it('commits, pushes, creates, and retrieves a GitHub pull request', async () => {
    const workspace = resolve(config.workspace!);
    const changedFile = resolve(workspace, config.changedFile!);
    const safeRelative = relative(workspace, changedFile);
    expect(safeRelative).not.toMatch(/^(\.\.(?:\/|$)|\.git(?:\/|$)|\.env(?:\.|$)|.*\.(?:pem|key)$)/i);

    const git = new GitEngine();
    const inspected = await git.inspect(workspace);
    expect(inspected.detached).toBe(false);
    expect(inspected.branch).not.toBe(config.baseBranch);
    expect(inspected.dirty).toBe(false);
    await appendFile(changedFile, '\n# CodexFlow GitHub E2E delivery marker\n', 'utf8');
    const diff = (await git.diff(workspace)).stdout;

    const db = openDatabase();
    const store = new CodexFlowStore(db);
    const repository = store.createRepository({
      provider: 'github',
      owner: config.owner!,
      name: config.repository!,
      url: `https://github.com/${config.owner}/${config.repository}`,
      defaultBranch: config.baseBranch!,
    });
    const project = store.createProject(String(repository.id), 'github-e2e');
    const task = store.createTask(project.id, 'CodexFlow GitHub E2E delivery');
    const taskId = String(task.id);
    const workspaceRecord = store.createWorkspace(taskId, workspace, inspected.branch!, inspected.head);
    const approvals = new ApprovalService();
    approvals.request(taskId, workspaceRecord.id, diff, {
      level: 'HIGH',
      score: 60,
      reasons: ['Explicit end-to-end GitHub delivery test'],
    });
    approvals.approve(taskId, 'github-e2e-test', diff);
    const provider = new GitHubProvider(config.token!);
    const delivery = new DeliveryService(
      git,
      approvals,
      new TesterAgent(),
      provider,
      ['main', 'master', 'production'],
      undefined,
      store,
    );
    const pullRequest = await delivery.deliver({
      taskId,
      workspaceId: workspaceRecord.id,
      workspacePath: workspace,
      branch: inspected.branch!,
      baselineCommit: inspected.head,
      diff,
      changedFiles: [safeRelative],
      verification: {
        commands: ['git diff --check'],
        requiresNewTests: false,
        rationale: 'Checks the explicitly configured disposable GitHub E2E change.',
      },
      risk: { level: 'HIGH', score: 60, reasons: ['Explicit end-to-end GitHub delivery test'] },
      owner: config.owner!,
      repository: config.repository!,
      baseBranch: config.baseBranch!,
    });

    const remote = await provider.getPullRequest!({
      owner: config.owner!,
      name: config.repository!,
      number: pullRequest.number,
    });
    expect(remote.number).toBe(pullRequest.number);
    expect(store.getTask(taskId)?.deliveryStatus).toBe('PR_CREATED');
    expect(store.findSuccessfulDeliveryPullRequest(taskId, inspected.branch!, (await git.revParse(workspace)).stdout)?.url).toBe(
      pullRequest.url,
    );
    db.close();
  }, 120_000);
});
