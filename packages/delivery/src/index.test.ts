import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalService, TesterAgent } from '@codexflow/agents';
import { GitEngine } from '@codexflow/git';
import { DeliveryService } from './index.js';
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'delivery-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path });
  git('init', '-b', 'codexflow/task-t');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(path, 'a.txt'), 'old');
  git('add', 'a.txt');
  git('commit', '-m', 'base');
  const baseline = git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(path, 'a.txt'), 'new');
  return { path, baseline };
}
describe('DeliveryService', () => {
  it('runs final verification, commits explicit files, and is idempotent', async () => {
    const { path, baseline } = fixture();
    const approvals = new ApprovalService();
    const diff = 'old → new';
    const risk = { level: 'HIGH' as const, score: 60, reasons: ['auth'] };
    approvals.request('t', 'w', diff, risk);
    approvals.approve('t', 'human', diff);
    const provider = {
      createPullRequest: async () => ({
        id: '1',
        number: 1,
        url: 'https://github.com/a/b/pull/1',
        title: 'x',
        body: '',
        status: 'OPEN' as const,
      }),
      authenticate: async () => ({ login: 'x' }),
      listRepositories: async () => [],
      getRepository: async () => {
        throw new Error('unused');
      },
      listBranches: async () => [],
    };
    const record = {
      taskId: 't',
      workspaceId: 'w',
      workspacePath: path,
      branch: 'codexflow/task-t',
      baselineCommit: baseline,
      diff,
      changedFiles: ['a.txt'],
      verification: { commands: ['test -f a.txt'], requiresNewTests: false, rationale: 'fixture' },
      risk,
      owner: 'a',
      repository: 'b',
      baseBranch: 'main',
    };
    const service = new DeliveryService(new GitEngine(), approvals, new TesterAgent(), provider);
    const first = await service.commit(record);
    expect(first.sha).toMatch(/[0-9a-f]{40}/);
    await expect(service.commit(record)).resolves.toEqual(first);
  });
  it('blocks stale approval and sensitive staging', async () => {
    const { path, baseline } = fixture();
    const approvals = new ApprovalService();
    approvals.request('t', 'w', 'before', { level: 'HIGH', score: 60, reasons: ['x'] });
    approvals.approve('t', 'human', 'before');
    const provider = {
      createPullRequest: async () => {
        throw new Error('unused');
      },
      authenticate: async () => ({ login: 'x' }),
      listRepositories: async () => [],
      getRepository: async () => {
        throw new Error('unused');
      },
      listBranches: async () => [],
    };
    const record = {
      taskId: 't',
      workspaceId: 'w',
      workspacePath: path,
      branch: 'codexflow/task-t',
      baselineCommit: baseline,
      diff: 'after',
      changedFiles: ['.env'],
      verification: { commands: ['true'], requiresNewTests: false, rationale: 'fixture' },
      risk: { level: 'HIGH' as const, score: 60, reasons: ['x'] },
      owner: 'a',
      repository: 'b',
      baseBranch: 'main',
    };
    await expect(
      new DeliveryService(new GitEngine(), approvals, new TesterAgent(), provider).commit(record),
    ).rejects.toThrow();
  });
});
