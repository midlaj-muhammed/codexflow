import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
export type RemoteCheck = {
  name: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  conclusion?: 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'SKIPPED' | 'TIMED_OUT' | 'ACTION_REQUIRED';
  url?: string;
};
export type RemotePullRequestComment = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
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
  getCommitChecks?(input: { owner: string; name: string; sha: string }): Promise<RemoteCheck[]>;
  listPullRequestComments?(input: { owner: string; name: string; number: number }): Promise<RemotePullRequestComment[]>;
  createPullRequestComment?(input: {
    owner: string;
    name: string;
    number: number;
    body: string;
  }): Promise<RemotePullRequestComment>;
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
const checkRunSchema = z.object({
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z.enum(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required']).nullable(),
  html_url: z.url().nullable(),
});
const commentSchema = z.object({
  id: z.number(),
  body: z.string(),
  user: z.object({ login: z.string() }),
  created_at: z.string(),
});

/**
 * Verifies GitHub's sha256 webhook signature without ever logging the secret
 * or body. Callers should reject unsigned events when a webhook secret is
 * configured.
 */
export function verifyGitHubWebhookSignature(secret: string, rawBody: string, signature?: string): boolean {
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
export class GitHubProvider implements GitProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {
    if (!token.trim()) throw new ProviderError('AUTH_FAILED', 'GitHub token is required');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new ProviderError('VALIDATION', 'GitHub timeout must be positive');
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
        signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
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
  async getCommitChecks(input: { owner: string; name: string; sha: string }): Promise<RemoteCheck[]> {
    const value = z.object({ owner: z.string().min(1), name: z.string().min(1), sha: z.string().min(1) }).parse(input);
    const raw = z.object({ check_runs: z.array(checkRunSchema) }).parse(
      await this.request(
        `/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/commits/${encodeURIComponent(value.sha)}/check-runs`,
      ),
    );
    return raw.check_runs.map((check) => ({
      name: check.name,
      status: check.status.toUpperCase() as RemoteCheck['status'],
      conclusion: check.conclusion?.toUpperCase() as RemoteCheck['conclusion'],
      url: check.html_url ?? undefined,
    }));
  }
  async listPullRequestComments(input: { owner: string; name: string; number: number }): Promise<RemotePullRequestComment[]> {
    const value = z.object({ owner: z.string().min(1), name: z.string().min(1), number: z.number().int().positive() }).parse(input);
    const raw = z.array(commentSchema).parse(
      await this.request(`/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/issues/${value.number}/comments?per_page=100`),
    );
    return raw.map((comment) => ({ id: String(comment.id), body: comment.body, author: comment.user.login, createdAt: comment.created_at }));
  }
  async createPullRequestComment(input: { owner: string; name: string; number: number; body: string }): Promise<RemotePullRequestComment> {
    const value = z.object({ owner: z.string().min(1), name: z.string().min(1), number: z.number().int().positive(), body: z.string().trim().min(1).max(10_000) }).parse(input);
    const raw = commentSchema.parse(
      await this.request(`/repos/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}/issues/${value.number}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: value.body }),
      }),
    );
    return { id: String(raw.id), body: raw.body, author: raw.user.login, createdAt: raw.created_at };
  }
}
