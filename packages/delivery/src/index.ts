import {
  ApprovalService,
  type RiskResult,
  type TestExecution,
  type TesterAgent,
  type VerificationPlan,
} from '@codexflow/agents';
import { GitEngine, GitError } from '@codexflow/git';
import type { CodexFlowStore, DeliveryStatus } from '@codexflow/database';
import { ProviderError, type GitProvider, type RemotePullRequest } from '@codexflow/providers';
import type { EventBus, TaskLifecycleManager } from '@codexflow/runtime';
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
  /** Actual results from the final verification gate, never model assertions. */
  finalVerification?: TestExecution[];
};
export type DeliveryRuntime = {
  lifecycle: Pick<TaskLifecycleManager, 'recordDeliveryState'>;
  events: Pick<EventBus, 'emit'>;
};
export type DeliveryFailureClassification = 'BLOCKED' | 'RETRYABLE' | 'PERMANENT_FAILURE';
export function classifyDeliveryFailure(error: unknown): DeliveryFailureClassification {
  if (error instanceof ProviderError)
    return error.code === 'UNAVAILABLE' || error.code === 'UNKNOWN'
      ? 'RETRYABLE'
      : 'PERMANENT_FAILURE';
  if (error instanceof GitError) return 'RETRYABLE';
  const message = error instanceof Error ? error.message : '';
  if (/approval|sensitive|protected|verification|workspace branch|baseline|delivery SHA/i.test(message))
    return 'BLOCKED';
  return 'PERMANENT_FAILURE';
}
const sensitive = /(^|\/)(\.env(?:\..*)?|credentials\.json|secrets\.|.*\.(pem|key))$/i;
export class Reporter {
  commit(input: DeliveryRecord): CommitMetadata {
    return {
      subject: `feat: ${input.taskId}`,
      body: `Risk: ${input.risk.level}\nChanged files: ${input.changedFiles.join(', ')}`,
    };
  }
  pr(input: DeliveryRecord, results: readonly TestExecution[] = []): PullRequestMetadata {
    const verification = results.length
      ? results.map((result) => `- ${result.command}: ${result.status}`).join('\n')
      : '- No persisted final-verification result is available for this delivery.';
    return {
      title: `CodexFlow: ${input.taskId}`,
      body: `## Summary\n${input.taskId}\n\n## Verification\n${verification}\n\n## Risk\n${input.risk.level}: ${input.risk.reasons.join('; ')}\n\n## Changed Files\n${input.changedFiles.map((x) => `- ${x}`).join('\n')}\n\n## CodexFlow\nTask: ${input.taskId}\nCommit: ${input.commit?.sha ?? 'pending'}`,
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
    private readonly runtime?: DeliveryRuntime,
  ) {}
  private async emit(
    record: DeliveryRecord,
    type:
      | 'delivery.started'
      | 'commit.started'
      | 'commit.completed'
      | 'commit.failed'
      | 'push.started'
      | 'push.completed'
      | 'push.failed'
      | 'pr.started'
      | 'pr.completed'
      | 'pr.failed'
      | 'delivery.reconciled'
      | 'delivery.completed'
      | 'delivery.blocked',
    payload?: Record<string, unknown>,
  ) {
    await this.runtime?.events.emit({
      type,
      taskId: record.taskId,
      at: new Date().toISOString(),
      payload: { workspaceId: record.workspaceId, branch: record.branch, ...payload },
    });
  }
  private async assertSafe(record: DeliveryRecord) {
    return this.assertSafeInner(record);
  }
  private assertSafeInner(record: DeliveryRecord) {
    if (this.protectedBranches.includes(record.branch))
      throw new Error('Protected branch delivery is forbidden');
    if (record.changedFiles.some((file) => sensitive.test(file)))
      throw new Error('Sensitive files cannot be staged');
    this.approvals.assertMayApply(record.taskId, record.diff);
  }
  private fingerprint(record: DeliveryRecord) {
    return this.approvals.fingerprint(record.diff);
  }
  private async mark(record: DeliveryRecord, status: DeliveryStatus, error?: string) {
    this.store?.setTaskDeliveryStatus(record.taskId, status, error);
    await this.runtime?.lifecycle.recordDeliveryState(record.taskId, status, error);
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
    await this.mark(record, 'COMMITTED');
    await this.emit(record, 'delivery.reconciled', { operation: 'commit', sha: inspected.head });
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
      await this.mark(record, 'PUSHED');
      await this.emit(record, 'delivery.reconciled', { operation: 'push', sha: commit.sha });
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
      await this.mark(record, 'PUSHED');
      await this.emit(record, 'delivery.reconciled', { operation: 'push', sha: commit.sha });
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
    await this.emit(record, 'commit.started');
    try {
      await this.assertSafe(record);
      const persisted = this.hydrateCommit(record);
      if (persisted) {
        await this.mark(record, 'COMMITTED');
        await this.emit(record, 'delivery.reconciled', { operation: 'commit', sha: persisted.sha });
        await this.emit(record, 'commit.completed', { sha: persisted.sha, reused: true });
        return persisted;
      }
      const reconciled = await this.reconcileCommittedHead(record, message);
      if (reconciled) {
        await this.emit(record, 'commit.completed', { sha: reconciled.sha, reconciled: true });
        return reconciled;
      }
      const checks = await this.tester.verify(record.workspacePath, record.verification);
      record.finalVerification = checks;
      for (const check of checks)
        this.store?.recordTestRun({ taskId: record.taskId, ...check });
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
      await this.mark(record, 'COMMITTED');
      await this.emit(record, 'commit.completed', { sha });
      return record.commit;
    } catch (error) {
      await this.emit(record, 'commit.failed', {
        reason: error instanceof Error ? error.message : 'Commit failed',
        classification: classifyDeliveryFailure(error),
      });
      throw error;
    }
  }
  async push(record: DeliveryRecord) {
    await this.emit(record, 'push.started');
    try {
    await this.assertSafe(record);
    const commit = this.hydrateCommit(record);
    if (!commit) throw new Error('Commit is required before push');
    if (await this.ensurePushed(record)) {
      await this.emit(record, 'push.completed', { sha: commit.sha, reused: true });
      return;
    }
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
      await this.mark(record, 'PUSHED');
      await this.emit(record, 'push.completed', { sha: commit.sha });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Push failed';
      if (attemptId) this.store?.updateDeliveryPush(attemptId, 'FAILED', message);
      await this.mark(record, 'PUSH_FAILED', message);
      throw error;
    }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Push failed')
        await this.emit(record, 'push.failed', {
          reason: error instanceof Error ? error.message : 'Push failed',
          classification: classifyDeliveryFailure(error),
        });
      throw error;
    }
  }
  private verificationResults(record: DeliveryRecord): TestExecution[] {
    if (record.finalVerification?.length) return record.finalVerification;
    return (this.store?.listTestRuns(record.taskId) ?? []).map((run) => ({
      command: String(run.command),
      status: run.status === 'PASSED' ? 'PASSED' : 'FAILED',
      exitCode: typeof run.exitCode === 'number' ? run.exitCode : null,
      stdout: String(run.stdout ?? ''),
      stderr: String(run.stderr ?? ''),
      durationMs: Number(run.durationMs ?? 0),
    }));
  }
  async createPullRequest(record: DeliveryRecord, metadata?: PullRequestMetadata) {
    await this.emit(record, 'pr.started');
    try {
    await this.assertSafe(record);
    if (record.pullRequest) return record.pullRequest;
    const persisted = this.persistedPullRequest(record);
    if (persisted) {
      await this.mark(record, 'PR_CREATED');
      await this.emit(record, 'pr.completed', { number: persisted.number, reused: true });
      return persisted;
    }
    const commit = this.hydrateCommit(record);
    if (!commit || !(await this.ensurePushed(record)))
      throw new Error('Successful push is required before creating a pull request');
    const resolvedMetadata = metadata ?? this.reporter.pr(record, this.verificationResults(record));
    const recovered = await this.provider.findPullRequest?.({
      owner: record.owner,
      name: record.repository,
      head: record.branch,
      base: record.baseBranch,
    });
    if (recovered && recovered.headSha && recovered.headSha !== commit.sha)
      throw new Error('Existing pull request does not reference the committed delivery SHA');
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
      await this.mark(record, 'PR_CREATED');
      await this.emit(record, 'delivery.reconciled', { operation: 'pull_request', number: recovered.number });
      await this.emit(record, 'pr.completed', { number: recovered.number, reconciled: true });
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
      title: resolvedMetadata.title,
      body: resolvedMetadata.body,
      status: 'PENDING',
      attempt: this.nextAttempt(attempts),
    });
    try {
      const created = await this.provider.createPullRequest({
        owner: record.owner,
        name: record.repository,
        head: record.branch,
        base: record.baseBranch,
        title: resolvedMetadata.title,
        body: resolvedMetadata.body,
      });
      // Creation responses can be stale or incomplete on some providers. Read
      // the PR back when supported before declaring the durable saga complete.
      const pullRequest = this.provider.getPullRequest
        ? await this.provider.getPullRequest({
            owner: record.owner,
            name: record.repository,
            number: created.number,
          })
        : created;
      if (pullRequest.headSha && pullRequest.headSha !== commit.sha)
        throw new Error('Created pull request does not reference the committed delivery SHA');
      if (attemptId)
        this.store?.updateDeliveryPullRequest(attemptId, {
          status: 'SUCCEEDED',
          number: pullRequest.number,
          url: pullRequest.url,
        });
      record.pullRequest = pullRequest;
      await this.mark(record, 'PR_CREATED');
      await this.emit(record, 'pr.completed', { number: pullRequest.number });
      return pullRequest;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pull request creation failed';
      if (attemptId) this.store?.updateDeliveryPullRequest(attemptId, { status: 'FAILED', error: message });
      await this.mark(record, 'PR_FAILED', message);
      throw error;
    }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Pull request creation failed')
        await this.emit(record, 'pr.failed', {
          reason: error instanceof Error ? error.message : 'Pull request creation failed',
          classification: classifyDeliveryFailure(error),
        });
      throw error;
    }
  }
  async deliver(record: DeliveryRecord, metadata?: PullRequestMetadata) {
    await this.emit(record, 'delivery.started');
    try {
      await this.commit(record);
      await this.push(record);
      const pullRequest = await this.createPullRequest(record, metadata);
      await this.emit(record, 'delivery.completed', { number: pullRequest.number, url: pullRequest.url });
      return pullRequest;
    } catch (error) {
      await this.emit(record, 'delivery.blocked', {
        reason: error instanceof Error ? error.message : 'Delivery failed',
        classification: classifyDeliveryFailure(error),
      });
      throw error;
    }
  }
}
