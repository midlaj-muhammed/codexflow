import {
  ApprovalService,
  type RiskResult,
  type TesterAgent,
  type VerificationPlan,
} from '@codexflow/agents';
import { GitEngine } from '@codexflow/git';
import type { CodexFlowStore, DeliveryStatus } from '@codexflow/database';
import type { GitProvider, RemotePullRequest } from '@codexflow/providers';
export type CommitMetadata = { subject: string; body?: string };
export type PullRequestMetadata = { title: string; body: string };
export type DeliveryRecord = {
  taskId: string;
  workspaceId: string;
  workspacePath: string;
  branch: string;
  baselineCommit: string;
  diff: string;
  changedFiles: string[];
  verification: VerificationPlan;
  risk: RiskResult;
  owner: string;
  repository: string;
  baseBranch: string;
  commit?: { sha: string; message: string };
  pushed?: boolean;
  pullRequest?: RemotePullRequest;
};
const sensitive = /(^|\/)(\.env(?:\..*)?|credentials\.json|secrets\.|.*\.(pem|key))$/i;
export class Reporter {
  commit(input: DeliveryRecord): CommitMetadata {
    return {
      subject: `feat: ${input.taskId}`,
      body: `Risk: ${input.risk.level}\nChanged files: ${input.changedFiles.join(', ')}`,
    };
  }
  pr(input: DeliveryRecord): PullRequestMetadata {
    return {
      title: `CodexFlow: ${input.taskId}`,
      body: `## Summary\n${input.taskId}\n\n## Verification\n${input.verification.commands.map((x) => `- ${x}`).join('\n')}\n\n## Risk\n${input.risk.level}: ${input.risk.reasons.join('; ')}\n\n## Changed Files\n${input.changedFiles.map((x) => `- ${x}`).join('\n')}`,
    };
  }
}
export class DeliveryService {
  constructor(
    private readonly git: GitEngine,
    private readonly approvals: ApprovalService,
    private readonly tester: TesterAgent,
    private readonly provider: GitProvider,
    private readonly protectedBranches = ['main', 'master', 'production'],
    private readonly reporter = new Reporter(),
    private readonly store?: CodexFlowStore,
  ) {}
  private assertSafe(record: DeliveryRecord) {
    if (this.protectedBranches.includes(record.branch))
      throw new Error('Protected branch delivery is forbidden');
    if (record.changedFiles.some((file) => sensitive.test(file)))
      throw new Error('Sensitive files cannot be staged');
    this.approvals.assertMayApply(record.taskId, record.diff);
  }
  private fingerprint(record: DeliveryRecord) {
    return this.approvals.fingerprint(record.diff);
  }
  private mark(record: DeliveryRecord, status: DeliveryStatus, error?: string) {
    this.store?.setTaskDeliveryStatus(record.taskId, status, error);
  }
  private hydrateCommit(record: DeliveryRecord) {
    if (record.commit) return record.commit;
    const persisted = this.store?.findDeliveryCommit(record.taskId, this.fingerprint(record));
    if (!persisted) return undefined;
    record.commit = { sha: String(persisted.sha), message: String(persisted.message) };
    return record.commit;
  }
  private nextAttempt(attempts: Record<string, unknown>[]) {
    return attempts.reduce((max, attempt) => Math.max(max, Number(attempt.attempt)), 0) + 1;
  }
  private async reconcileCommittedHead(record: DeliveryRecord, message: string) {
    const inspected = await this.git.inspect(record.workspacePath);
    if (inspected.detached || inspected.branch !== record.branch)
      throw new Error('Workspace branch changed');
    if (inspected.head === record.baselineCommit) return undefined;
    if (inspected.dirty) throw new Error('Workspace has an unreconciled commit and local changes');
    record.commit = { sha: inspected.head, message };
    this.store?.createDeliveryCommit({
      taskId: record.taskId,
      workspaceId: record.workspaceId,
      sha: inspected.head,
      branch: record.branch,
      message,
      baselineSha: record.baselineCommit,
      diffFingerprint: this.fingerprint(record),
    });
    this.mark(record, 'COMMITTED');
    return record.commit;
  }
  private async remoteHasCommit(record: DeliveryRecord, sha: string) {
    try {
      const result = await this.git.remoteBranchHead(record.workspacePath, 'origin', record.branch);
      return result.stdout.split(/\s+/)[0] === sha;
    } catch {
      return false;
    }
  }
  private async ensurePushed(record: DeliveryRecord) {
    const commit = this.hydrateCommit(record);
    if (!commit) return false;
    if (record.pushed) return true;
    const success = this.store?.findSuccessfulDeliveryPush(record.taskId, commit.sha);
    if (success) {
      record.pushed = true;
      this.mark(record, 'PUSHED');
      return true;
    }
    if (await this.remoteHasCommit(record, commit.sha)) {
      const attempts = this.store?.listDeliveryPushes(record.taskId, commit.sha) ?? [];
      this.store?.createDeliveryPush({
        taskId: record.taskId,
        workspaceId: record.workspaceId,
        branch: record.branch,
        remote: 'origin',
        commitSha: commit.sha,
        status: 'SUCCEEDED',
        attempt: this.nextAttempt(attempts),
      });
      record.pushed = true;
      this.mark(record, 'PUSHED');
      return true;
    }
    return false;
  }
  private persistedPullRequest(record: DeliveryRecord) {
    const commit = this.hydrateCommit(record);
    if (!commit) return undefined;
    const persisted = this.store?.findSuccessfulDeliveryPullRequest(
      record.taskId,
      record.branch,
      commit.sha,
    );
    if (!persisted) return undefined;
    const pullRequest = {
      id: String(persisted.number ?? persisted.id),
      number: Number(persisted.number),
      url: String(persisted.url),
      title: String(persisted.title),
      body: String(persisted.body),
      status: 'OPEN' as const,
    };
    record.pullRequest = pullRequest;
    return pullRequest;
  }
  async commit(record: DeliveryRecord, message = this.reporter.commit(record).subject) {
    this.assertSafe(record);
    const persisted = this.hydrateCommit(record);
    if (persisted) {
      this.mark(record, 'COMMITTED');
      return persisted;
    }
    const reconciled = await this.reconcileCommittedHead(record, message);
    if (reconciled) return reconciled;
    const checks = await this.tester.verify(record.workspacePath, record.verification);
    if (!checks.every((check) => check.status === 'PASSED'))
      throw new Error('Final verification failed');
    const inspected = await this.git.inspect(record.workspacePath);
    if (
      inspected.detached ||
      inspected.branch !== record.branch ||
      inspected.head !== record.baselineCommit
    )
      throw new Error('Workspace branch or baseline changed');
    await this.git.stage(record.workspacePath, record.changedFiles);
    await this.git.commitStaged(record.workspacePath, message);
    const sha = (await this.git.revParse(record.workspacePath)).stdout;
    record.commit = { sha, message };
    this.store?.createDeliveryCommit({
      taskId: record.taskId,
      workspaceId: record.workspaceId,
      sha,
      branch: record.branch,
      message,
      baselineSha: record.baselineCommit,
      diffFingerprint: this.fingerprint(record),
    });
    this.mark(record, 'COMMITTED');
    return record.commit;
  }
  async push(record: DeliveryRecord) {
    const commit = this.hydrateCommit(record);
    if (!commit) throw new Error('Commit is required before push');
    if (await this.ensurePushed(record)) return;
    this.assertSafe(record);
    const attempts = this.store?.listDeliveryPushes(record.taskId, commit.sha) ?? [];
    const attempt = this.nextAttempt(attempts);
    const attemptId = this.store?.createDeliveryPush({
      taskId: record.taskId,
      workspaceId: record.workspaceId,
      branch: record.branch,
      remote: 'origin',
      commitSha: commit.sha,
      status: 'PENDING',
      attempt,
    });
    try {
      await this.git.push(record.workspacePath, 'origin', record.branch);
      record.pushed = true;
      if (attemptId) this.store?.updateDeliveryPush(attemptId, 'SUCCEEDED');
      this.mark(record, 'PUSHED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Push failed';
      if (attemptId) this.store?.updateDeliveryPush(attemptId, 'FAILED', message);
      this.mark(record, 'PUSH_FAILED', message);
      throw error;
    }
  }
  async createPullRequest(record: DeliveryRecord, metadata = this.reporter.pr(record)) {
    if (record.pullRequest) return record.pullRequest;
    const persisted = this.persistedPullRequest(record);
    if (persisted) {
      this.mark(record, 'PR_CREATED');
      return persisted;
    }
    const commit = this.hydrateCommit(record);
    if (!commit || !(await this.ensurePushed(record)))
      throw new Error('Successful push is required before creating a pull request');
    this.assertSafe(record);
    const recovered = await this.provider.findPullRequest?.({
      owner: record.owner,
      name: record.repository,
      head: record.branch,
      base: record.baseBranch,
    });
    if (recovered) {
      this.store?.createDeliveryPullRequest({
        taskId: record.taskId,
        workspaceId: record.workspaceId,
        provider: 'github',
        repository: `${record.owner}/${record.repository}`,
        branch: record.branch,
        baseBranch: record.baseBranch,
        commitSha: commit.sha,
        number: recovered.number,
        url: recovered.url,
        title: recovered.title,
        body: recovered.body,
        status: 'SUCCEEDED',
        attempt: this.nextAttempt(this.store?.listDeliveryPullRequests(record.taskId, commit.sha) ?? []),
      });
      record.pullRequest = recovered;
      this.mark(record, 'PR_CREATED');
      return recovered;
    }
    const attempts = this.store?.listDeliveryPullRequests(record.taskId, commit.sha) ?? [];
    const attemptId = this.store?.createDeliveryPullRequest({
      taskId: record.taskId,
      workspaceId: record.workspaceId,
      provider: 'github',
      repository: `${record.owner}/${record.repository}`,
      branch: record.branch,
      baseBranch: record.baseBranch,
      commitSha: commit.sha,
      title: metadata.title,
      body: metadata.body,
      status: 'PENDING',
      attempt: this.nextAttempt(attempts),
    });
    try {
      const pullRequest = await this.provider.createPullRequest({
        owner: record.owner,
        name: record.repository,
        head: record.branch,
        base: record.baseBranch,
        title: metadata.title,
        body: metadata.body,
      });
      if (attemptId)
        this.store?.updateDeliveryPullRequest(attemptId, {
          status: 'SUCCEEDED',
          number: pullRequest.number,
          url: pullRequest.url,
        });
      record.pullRequest = pullRequest;
      this.mark(record, 'PR_CREATED');
      return pullRequest;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pull request creation failed';
      if (attemptId) this.store?.updateDeliveryPullRequest(attemptId, { status: 'FAILED', error: message });
      this.mark(record, 'PR_FAILED', message);
      throw error;
    }
  }
}
