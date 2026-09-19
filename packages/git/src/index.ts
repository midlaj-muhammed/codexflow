import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr = '',
  ) {
    super(message);
  }
}
export class GitEngine {
  private async run(cwd: string, args: string[]) {
    try {
      const { stdout, stderr } = await exec('git', args, { cwd, maxBuffer: 10_000_000 });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      const result = error as { stderr?: string; message: string };
      throw new GitError(`git ${args[0]} failed`, result.stderr ?? result.message);
    }
  }
  isRepository(path: string) {
    return this.run(path, ['rev-parse', '--is-inside-work-tree'])
      .then(({ stdout }) => stdout === 'true')
      .catch(() => false);
  }
  async inspect(path: string) {
    if (!(await this.isRepository(path))) throw new GitError('Not a Git repository');
    const [{ stdout: branch }, { stdout: head }, { stdout: status }] = await Promise.all([
      this.run(path, ['branch', '--show-current']),
      this.run(path, ['rev-parse', 'HEAD']),
      this.run(path, ['status', '--porcelain']),
    ]);
    return {
      branch: branch || null,
      head,
      dirty: Boolean(status),
      detached: !branch,
      conflicts:
        status
          .split('\n')
          .filter((line) => /^[AUDAU?]{2}/.test(line) && line.slice(0, 2).includes('U')).length > 0,
      untracked: status
        .split('\n')
        .filter((line) => line.startsWith('??'))
        .map((line) => line.slice(3)),
    };
  }
  status(path: string) {
    return this.run(path, ['status', '--porcelain']);
  }
  fetch(path: string) {
    return this.run(path, ['fetch', '--prune']);
  }
  diff(path: string, baseline?: string) {
    return this.run(
      path,
      baseline ? ['diff', '--no-ext-diff', `${baseline}..HEAD`] : ['diff', '--no-ext-diff'],
    );
  }
  async worktreeAdd(path: string, target: string, branch: string, base: string) {
    await this.run(path, ['worktree', 'add', '-b', branch, target, base]);
  }
  async worktreeRemove(path: string, target: string) {
    await this.run(path, ['worktree', 'remove', target]);
  }
  commit(path: string, message: string) {
    return this.run(path, ['commit', '-am', message]);
  }
  push(path: string, remote = 'origin', branch?: string) {
    return this.run(path, ['push', remote, branch ?? 'HEAD']);
  }
}
