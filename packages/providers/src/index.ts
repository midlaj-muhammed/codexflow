import { z } from 'zod';
import type { Provider } from '@codexflow/shared';

export type RemoteRepository = {
  provider: Provider;
  id: string;
  owner: string;
  name: string;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
};
export type RemotePullRequest = {
  id: string;
  number: number;
  url: string;
  title: string;
  body: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  /** The provider's current source commit when it exposes one. */
  headSha?: string;
};
export interface GitProvider {
  authenticate(token: string): Promise<{ login: string }>;
  listRepositories(): Promise<RemoteRepository[]>;
  getRepository(owner: string, name: string): Promise<RemoteRepository>;
  listBranches(owner: string, name: string): Promise<string[]>;
  createPullRequest(input: {
    owner: string;
    name: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<RemotePullRequest>;
  findPullRequest?(input: {
    owner: string;
    name: string;
    head: string;
    base: string;
  }): Promise<RemotePullRequest | undefined>;
  getPullRequest?(input: {
    owner: string;
    name: string;
    number: number;
  }): Promise<RemotePullRequest>;
}
export class ProviderError extends Error {
  constructor(
    public readonly code: 'AUTH_FAILED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'VALIDATION' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
  }
}
const repoSchema = z.object({
  id: z.number(),
  owner: z.object({ login: z.string() }),
  name: z.string(),
  html_url: z.url(),
  clone_url: z.url(),
  default_branch: z.string(),
  private: z.boolean(),
});
const pullRequestSchema = z.object({
  id: z.number(),
  number: z.number(),
  html_url: z.url(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
  head: z.object({ sha: z.string().min(1) }).optional(),
});
export class GitHubProvider implements GitProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!token.trim()) throw new ProviderError('AUTH_FAILED', 'GitHub token is required');
  }
  private async request(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...init?.headers,
        },
      });
    } catch {
      throw new ProviderError('UNAVAILABLE', 'GitHub is unavailable');
    }
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'AUTH_FAILED'
          : response.status === 404
            ? 'NOT_FOUND'
            : response.status >= 500
              ? 'UNAVAILABLE'
              : 'UNKNOWN';
      throw new ProviderError(code, `GitHub request failed (${response.status})`);
    }
    return response.json() as Promise<unknown>;
  }
  private map(raw: unknown): RemoteRepository {
    const value = repoSchema.parse(raw);
    return {
      provider: 'github',
      id: String(value.id),
      owner: value.owner.login,
      name: value.name,
      url: value.html_url,
      cloneUrl: value.clone_url,
      defaultBranch: value.default_branch,
      private: value.private,
    };
  }
  private mapPullRequest(raw: unknown): RemotePullRequest {
    const result = pullRequestSchema.parse(raw);
    return {
      id: String(result.id),
      number: result.number,
      url: result.html_url,
      title: result.title,
      body: result.body ?? '',
      status: result.merged ? 'MERGED' : result.state === 'open' ? 'OPEN' : 'CLOSED',
      headSha: result.head?.sha,
    };
  }
  async authenticate(token: string) {
    if (!token.trim()) throw new ProviderError('AUTH_FAILED', 'GitHub token is required');
    const profile = await this.request('/user');
    return { login: z.object({ login: z.string() }).parse(profile).login };
  }
  async listRepositories() {
    return z
      .array(z.unknown())
      .parse(await this.request('/user/repos?per_page=100&sort=updated'))
      .map((repo) => this.map(repo));
  }
  async getRepository(owner: string, name: string) {
    return this.map(
      await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`),
    );
  }
  async listBranches(owner: string, name: string) {
    return z
      .array(z.object({ name: z.string() }))
      .parse(
        await this.request(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100`,
        ),
      )
      .map(({ name: branch }) => branch);
  }
  async createPullRequest(input: {
    owner: string;
    name: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<RemotePullRequest> {
    const value = z
      .object({
        owner: z.string().min(1),
        name: z.string().min(1),
        head: z.string().min(1),
        base: z.string().min(1),
        title: z.string().min(1),
        body: z.string(),
      })
      .parse(input);
    return this.mapPullRequest(
      await this.request(
        `/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/pulls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            head: value.head,
            base: value.base,
            title: value.title,
            body: value.body,
          }),
        },
      ),
    );
  }
  async findPullRequest(input: { owner: string; name: string; head: string; base: string }) {
    const value = z
      .object({
        owner: z.string().min(1),
        name: z.string().min(1),
        head: z.string().min(1),
        base: z.string().min(1),
      })
      .parse(input);
    const pulls = z
      .array(pullRequestSchema)
      .parse(
        await this.request(
          `/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/pulls?state=all&head=${encodeURIComponent(
            `${value.owner}:${value.head}`,
          )}&base=${encodeURIComponent(value.base)}`,
        ),
      );
    const pull = pulls[0];
    if (!pull) return undefined;
    return this.mapPullRequest(pull);
  }
  async getPullRequest(input: { owner: string; name: string; number: number }) {
    const value = z
      .object({ owner: z.string().min(1), name: z.string().min(1), number: z.number().int().positive() })
      .parse(input);
    return this.mapPullRequest(
      await this.request(
        `/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/pulls/${value.number}`,
      ),
    );
  }
}
