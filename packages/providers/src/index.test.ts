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
  it('creates, discovers, and retrieves pull requests with provider head evidence', async () => {
    const pull = {
      id: 7,
      number: 3,
      html_url: 'https://github.com/acme/demo/pull/3',
      title: 'Change',
      body: 'Body',
      state: 'open',
      head: { sha: 'abc123' },
    };
    const paths: string[] = [];
    const provider = new GitHubProvider('token', async (input, init) => {
      paths.push(String(input));
      if (init?.method === 'POST') return new Response(JSON.stringify(pull), { status: 201 });
      if (String(input).endsWith('/pulls/3')) return new Response(JSON.stringify({ ...pull, state: 'closed' }));
      return new Response(JSON.stringify([pull]));
    });
    await expect(
      provider.createPullRequest({
        owner: 'acme',
        name: 'demo',
        head: 'codexflow/task-1',
        base: 'main',
        title: 'Change',
        body: 'Body',
      }),
    ).resolves.toMatchObject({ number: 3, status: 'OPEN', headSha: 'abc123' });
    await expect(
      provider.findPullRequest({ owner: 'acme', name: 'demo', head: 'codexflow/task-1', base: 'main' }),
    ).resolves.toMatchObject({ number: 3, headSha: 'abc123' });
    await expect(provider.getPullRequest({ owner: 'acme', name: 'demo', number: 3 })).resolves.toMatchObject({
      number: 3,
      status: 'CLOSED',
      headSha: 'abc123',
    });
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/repos/acme/demo/pulls'),
        expect.stringContaining('/repos/acme/demo/pulls/3'),
      ]),
    );
  });
});
