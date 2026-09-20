import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  constructor(private readonly timeoutMs = 60_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Git timeout must be positive');
  }
  private async run(cwd: string, args: string[]) {
    try {
      const { stdout, stderr } = await exec('git', args, {
        cwd,
        maxBuffer: 10_000_000,
        timeout: this.timeoutMs,
      });
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
  stage(path: string, files: string[]) {
    if (!files.length) throw new GitError('No files selected for staging');
    return this.run(path, ['add', '--', ...files]);
  }
  revParse(path: string, ref = 'HEAD') {
    return this.run(path, ['rev-parse', ref]);
  }
  changedFiles(path: string) {
    return this.run(path, ['diff', '--name-only']);
  }
  commitStaged(path: string, message: string) {
    return this.run(path, ['commit', '-m', message]);
  }
  push(path: string, remote = 'origin', branch?: string) {
    return this.run(path, ['push', remote, branch ?? 'HEAD']);
  }
  remoteBranchHead(path: string, remote = 'origin', branch: string) {
    return this.run(path, ['ls-remote', remote, `refs/heads/${branch}`]);
  }
  remoteUrl(path: string, remote = 'origin') {
    return this.run(path, ['remote', 'get-url', remote]);
  }
  listTrackedFiles(path: string) {
    return this.run(path, ['ls-files']);
  }
  addRemote(path: string, remote: string, url: string) {
    return this.run(path, ['remote', 'add', remote, url]);
  }
  pushSetUpstream(path: string, remote: string, branch: string) {
    return this.run(path, ['push', '--set-upstream', remote, branch]);
  }
  async pushSetUpstreamAuthenticated(path: string, remote: string, branch: string, token: string) {
    try {
      await exec('git', ['push', '--set-upstream', remote, branch], {
        cwd: path,
        maxBuffer: 10_000_000,
        timeout: this.timeoutMs,
        // Keep an OAuth token out of remotes, command arguments, and process output.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
        },
      });
    } catch (error) {
      const result = error as { stderr?: string; message: string };
      throw new GitError('git push failed', result.stderr ?? result.message);
    }
  }
  async initializeSnapshot(path: string, branch = 'main') {
    await this.run(path, ['init', '-b', branch]);
    await this.run(path, ['add', '--', '.']);
    await this.run(path, ['-c', 'user.name=CodexFlow', '-c', 'user.email=codexflow@local.invalid', 'commit', '-m', 'Import local project']);
    return this.inspect(path);
  }
  async cloneGitHubRepository(url: string, target: string, branch: string, token: string) {
    await mkdir(dirname(target), { recursive: true });
    try {
      await exec('git', ['clone', '--branch', branch, '--single-branch', url, target], {
        maxBuffer: 10_000_000, timeout: this.timeoutMs,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` },
      });
    } catch (error) {
      const result = error as { stderr?: string; message: string };
      throw new GitError('git clone failed', result.stderr ?? result.message);
    }
  }
}
