import {
  ApprovalService,
  type RiskResult,
  type TesterAgent,
  type VerificationPlan,
} from '@codexflow/agents';
import { GitEngine } from '@codexflow/git';
import type { CodexFlowStore } from '@codexflow/database';
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
  async commit(record: DeliveryRecord, message = this.reporter.commit(record).subject) {
    if (record.commit) return record.commit;
    this.assertSafe(record);
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
      diffFingerprint: this.approvals.fingerprint(record.diff),
    });
    return record.commit;
  }
  async push(record: DeliveryRecord) {
    if (!record.commit) throw new Error('Commit is required before push');
    if (record.pushed) return;
    this.assertSafe(record);
    try {
      await this.git.push(record.workspacePath, 'origin', record.branch);
      record.pushed = true;
      this.store?.createDeliveryPush({
        taskId: record.taskId,
        workspaceId: record.workspaceId,
        branch: record.branch,
        remote: 'origin',
        commitSha: record.commit.sha,
        status: 'SUCCEEDED',
        attempt: 1,
      });
    } catch (error) {
      this.store?.createDeliveryPush({
        taskId: record.taskId,
        workspaceId: record.workspaceId,
        branch: record.branch,
        remote: 'origin',
        commitSha: record.commit.sha,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Push failed',
        attempt: 1,
      });
      throw error;
    }
  }
  async createPullRequest(record: DeliveryRecord, metadata = this.reporter.pr(record)) {
    if (record.pullRequest) return record.pullRequest;
    if (!record.pushed || !record.commit)
      throw new Error('Successful push is required before creating a pull request');
    this.assertSafe(record);
    return (record.pullRequest = await this.provider.createPullRequest({
      owner: record.owner,
      name: record.repository,
      head: record.branch,
      base: record.baseBranch,
      title: metadata.title,
      body: metadata.body,
    }));
  }
}
