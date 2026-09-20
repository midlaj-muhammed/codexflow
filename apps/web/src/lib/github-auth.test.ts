import { describe, expect, it } from 'vitest';
import { githubAppInstallUrl, githubOAuthOrigin } from './github-auth';

describe('githubOAuthOrigin', () => {
  it('uses the configured public origin instead of a reverse proxy listener', () => {
    expect(
      githubOAuthOrigin('http://0.0.0.0:10000', {
        CODEXFLOW_PUBLIC_URL: 'https://codexflow.onrender.com/',
        NODE_ENV: 'production',
      }),
    ).toBe('https://codexflow.onrender.com');
  });

  it('uses the request origin for local development when none is configured', () => {
    expect(githubOAuthOrigin('http://localhost:3000', {})).toBe('http://localhost:3000');
  });

  it('rejects a path or insecure public URL in production', () => {
    expect(() =>
      githubOAuthOrigin('http://localhost:3000', {
        CODEXFLOW_PUBLIC_URL: 'https://codexflow.onrender.com/auth',
        NODE_ENV: 'production',
      }),
    ).toThrow('origin without a path');
    expect(() =>
      githubOAuthOrigin('http://localhost:3000', {
        CODEXFLOW_PUBLIC_URL: 'http://codexflow.onrender.com',
        NODE_ENV: 'production',
      }),
    ).toThrow('must use HTTPS');
  });
});

describe('githubAppInstallUrl', () => {
  it('builds the GitHub App install URL from a slug', () => {
    expect(githubAppInstallUrl({ GITHUB_APP_SLUG: 'codexflow-dev' })).toBe(
      'https://github.com/apps/codexflow-dev/installations/new',
    );
  });

  it('accepts an explicit GitHub install URL', () => {
    expect(
      githubAppInstallUrl({
        GITHUB_APP_INSTALL_URL: 'https://github.com/apps/codexflow-dev/installations/new',
      }),
    ).toBe('https://github.com/apps/codexflow-dev/installations/new');
  });

  it('rejects non-GitHub install URLs', () => {
    expect(() =>
      githubAppInstallUrl({ GITHUB_APP_INSTALL_URL: 'https://example.com/install' }),
    ).toThrow('https://github.com URL');
  });
});
