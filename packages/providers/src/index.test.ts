import { describe, expect, it } from 'vitest';
import { GitHubProvider, ProviderError } from './index.js';
const json =
  (data: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
describe('GitHubProvider', () => {
  it('lists and maps repositories without retaining a token in results', async () => {
    const provider = new GitHubProvider(
      'secret-token',
      json([
        {
          id: 1,
          owner: { login: 'acme' },
          name: 'demo',
          html_url: 'https://github.com/acme/demo',
          clone_url: 'https://github.com/acme/demo.git',
          default_branch: 'main',
          private: true,
        },
      ]) as typeof fetch,
    );
    await expect(provider.listRepositories()).resolves.toEqual([
      expect.objectContaining({ provider: 'github', name: 'demo' }),
    ]);
  });
  it('maps authentication and availability failures to structured errors', async () => {
    await expect(
      new GitHubProvider('token', json({}, 401) as typeof fetch).listRepositories(),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' } satisfies Partial<ProviderError>);
    await expect(
      new GitHubProvider('token', async () => {
        throw new Error('offline');
      }).listRepositories(),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
