import { describe, expect, it } from 'vitest';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import {
  createGitHubAppJwt,
  GitHubAppAuth,
  GitHubProvider,
  ProviderError,
  verifyGitHubWebhookSignature,
} from './index.js';
const json =
  (data: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('GitHubAppAuth', () => {
  it('creates a signed GitHub App JWT', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = createGitHubAppJwt({
      appId: '12345',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      now: new Date('2026-09-20T00:00:00Z'),
    });
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toMatchObject({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toMatchObject({
      iss: '12345',
    });
    expect(signature).toBeTruthy();
  });

  it('mints an installation token for a repository', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const paths: string[] = [];
    const appAuth = new GitHubAppAuth(
      '12345',
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      async (input, init) => {
        paths.push(`${String(init?.method ?? 'GET')} ${String(input)}`);
        if (String(input).endsWith('/repos/acme/demo/installation'))
          return new Response(JSON.stringify({ id: 99 }));
        expect(String(input)).toContain('/app/installations/99/access_tokens');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          repositories: ['demo'],
          permissions: { contents: 'write', pull_requests: 'write' },
        });
        return new Response(JSON.stringify({ token: 'installation-token' }));
      },
    );
    await expect(appAuth.createRepositoryInstallationToken('acme', 'demo')).resolves.toBe(
      'installation-token',
    );
    expect(paths).toEqual([
      'GET https://api.github.com/repos/acme/demo/installation',
      'POST https://api.github.com/app/installations/99/access_tokens',
    ]);
  });
});

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
  it('lists only repositories available through a GitHub App installation', async () => {
    const paths: string[] = [];
    const repository = {
      id: 1,
      owner: { login: 'acme' },
      name: 'installed',
      html_url: 'https://github.com/acme/installed',
      clone_url: 'https://github.com/acme/installed.git',
      default_branch: 'main',
      private: true,
    };
    const provider = new GitHubProvider('ghu_fixture', async (input) => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith('/user/installations'))
        return new Response(JSON.stringify({ installations: [{ id: 42 }] }));
      return new Response(JSON.stringify({ repositories: [repository] }));
    });
    await expect(provider.listRepositories()).resolves.toEqual([
      expect.objectContaining({ name: 'installed' }),
    ]);
    expect(paths).toEqual([
      'https://api.github.com/user/installations',
      'https://api.github.com/user/installations/42/repositories?per_page=100',
    ]);
  });

  it('checks repository contents access before a managed clone', async () => {
    const provider = new GitHubProvider('token', json([]) as typeof fetch);
    await expect(provider.assertRepositoryContentsAccess('acme', 'demo')).resolves.toBeUndefined();
    await expect(
      new GitHubProvider('token', json({}, 403) as typeof fetch).assertRepositoryContentsAccess(
        'acme',
        'demo',
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' } satisfies Partial<ProviderError>);
  });
  it('creates a repository through the authenticated server-side provider', async () => {
    const provider = new GitHubProvider(
      'secret-token',
      json(
        {
          id: 1,
          owner: { login: 'acme' },
          name: 'new-project',
          html_url: 'https://github.com/acme/new-project',
          clone_url: 'https://github.com/acme/new-project.git',
          default_branch: 'main',
          private: true,
        },
        201,
      ) as typeof fetch,
    );
    await expect(
      provider.createRepository({ name: 'new-project', private: true }),
    ).resolves.toMatchObject({
      owner: 'acme',
      name: 'new-project',
      private: true,
    });
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
  it('bounds a stalled provider request with the configured timeout', async () => {
    const provider = new GitHubProvider(
      'token',
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      1,
    );
    await expect(provider.listRepositories()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
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
      if (String(input).endsWith('/pulls/3'))
        return new Response(JSON.stringify({ ...pull, state: 'closed' }));
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
      provider.findPullRequest({
        owner: 'acme',
        name: 'demo',
        head: 'codexflow/task-1',
        base: 'main',
      }),
    ).resolves.toMatchObject({ number: 3, headSha: 'abc123' });
    await expect(
      provider.getPullRequest({ owner: 'acme', name: 'demo', number: 3 }),
    ).resolves.toMatchObject({
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
  it('retrieves checks and uses controlled GitHub issue comments for PR feedback', async () => {
    const provider = new GitHubProvider('token', async (input, init) => {
      const path = String(input);
      if (path.includes('/check-runs')) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                name: 'test',
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/acme/demo/runs/1',
              },
            ],
          }),
        );
      }
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 9,
            body: 'Please review.',
            user: { login: 'codexflow' },
            created_at: '2026-01-01T00:00:00Z',
          }),
          { status: 201 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: 8,
            body: 'Looks good.',
            user: { login: 'human' },
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      );
    });
    await expect(
      provider.getCommitChecks({ owner: 'acme', name: 'demo', sha: 'abc123' }),
    ).resolves.toEqual([
      {
        name: 'test',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        url: 'https://github.com/acme/demo/runs/1',
      },
    ]);
    await expect(
      provider.listPullRequestComments({ owner: 'acme', name: 'demo', number: 3 }),
    ).resolves.toEqual([
      { id: '8', body: 'Looks good.', author: 'human', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    await expect(
      provider.createPullRequestComment({
        owner: 'acme',
        name: 'demo',
        number: 3,
        body: 'Please review.',
      }),
    ).resolves.toMatchObject({ id: '9', author: 'codexflow' });
  });
  it('validates GitHub webhook signatures without exposing the secret', () => {
    const secret = 'webhook-secret';
    const payload = '{"action":"opened"}';
    const valid = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(verifyGitHubWebhookSignature(secret, payload, valid)).toBe(true);
    expect(verifyGitHubWebhookSignature(secret, payload, 'sha256=wrong')).toBe(false);
    expect(verifyGitHubWebhookSignature('', payload, valid)).toBe(false);
  });
});
