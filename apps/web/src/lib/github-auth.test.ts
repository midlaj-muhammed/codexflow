import { describe, expect, it } from 'vitest';
import { githubOAuthOrigin } from './github-auth';

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
