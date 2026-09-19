import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitEngine } from './index.js';

describe('GitEngine', () => {
  it('requires an explicit positive command timeout', () => {
    expect(() => new GitEngine(0)).toThrow('timeout');
  });
  it('inspects a repository without mutating it', async () => {
    const path = mkdtempSync(join(tmpdir(), 'codexflow-engine-'));
    const run = (...args: string[]) => execFileSync('git', args, { cwd: path });
    run('init', '-b', 'main');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'Test');
    writeFileSync(join(path, 'a.txt'), 'a');
    run('add', '.');
    run('commit', '-m', 'initial');
    await expect(new GitEngine().inspect(path)).resolves.toMatchObject({
      branch: 'main',
      dirty: false,
    });
  });
});
