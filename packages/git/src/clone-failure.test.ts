import { describe, expect, it } from 'vitest';
import { describeGitCloneFailure, githubGitAuthorizationHeader } from './index.js';

describe('describeGitCloneFailure', () => {
  it('makes a missing Git executable actionable', () => {
    expect(describeGitCloneFailure({ code: 'ENOENT', message: 'spawn git ENOENT' })).toContain(
      'Git is unavailable',
    );
  });

  it('does not expose an OAuth token in authentication errors', () => {
    const message = describeGitCloneFailure({
      stderr: 'remote: Repository not found. Authorization: Bearer secret-token',
    });
    expect(message).toContain('GitHub rejected');
    expect(message).not.toContain('secret-token');
  });

  it('uses GitHub smart-HTTP Basic authentication without putting a token in a URL', () => {
    const header = githubGitAuthorizationHeader('fixture-token');
    expect(header).toMatch(/^Authorization: Basic /);
    expect(
      Buffer.from(header.slice('Authorization: Basic '.length), 'base64').toString('utf8'),
    ).toBe('x-access-token:fixture-token');
    expect(header).not.toContain('github.com');
  });

  it('classifies a non-writable managed workspace', () => {
    expect(describeGitCloneFailure({ stderr: 'mkdir: permission denied' })).toContain(
      'not writable',
    );
  });
});
