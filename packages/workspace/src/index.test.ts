import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from './index.js';
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'codexflow-git-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: path });
  run('init', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(path, 'README.md'), 'demo');
  run('add', '.');
  run('commit', '-m', 'init');
  return { path, run };
}
describe('WorkspaceManager', () => {
  it('creates isolated parallel worktrees without changing primary branch', async () => {
    const repo = fixture();
    const manager = new WorkspaceManager(
      undefined,
      join(tmpdir(), `codexflow-workspaces-${Date.now()}`),
    );
    const [one, two] = await Promise.all(
      ['one', 'two'].map((taskId) =>
        manager.createWorkspace({ repositoryPath: repo.path, taskId, baseBranch: 'main' }),
      ),
    );
    expect(one.branch).toBe('codexflow/task-one');
    expect(two.branch).toBe('codexflow/task-two');
    expect(
      execFileSync('git', ['branch', '--show-current'], { cwd: repo.path }).toString().trim(),
    ).toBe('main');
  });
  it('refuses dirty repositories', async () => {
    const repo = fixture();
    writeFileSync(join(repo.path, 'dirty.txt'), 'x');
    const manager = new WorkspaceManager();
    await expect(
      manager.createWorkspace({ repositoryPath: repo.path, taskId: 'dirty', baseBranch: 'main' }),
    ).rejects.toThrow('clean');
  });
});
