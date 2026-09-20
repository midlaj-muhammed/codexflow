import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import postgres, { type Sql } from 'postgres';
import { GitHubProvider } from '@codexflow/providers';
import { controlPlane } from './control-plane';

const sessionCookie = 'codexflow_github_session';
const stateCookie = 'codexflow_github_oauth_state';
const maxAge = 60 * 60 * 24 * 7;

type SessionRow = { id: string; login: string; tokenCiphertext: string; expiresAt: string };
type GlobalSessions = typeof globalThis & { __codexflowSessionSql?: Sql };
const sessionGlobal = globalThis as GlobalSessions;

function sessionSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('postgres')) return undefined;
  if (!sessionGlobal.__codexflowSessionSql)
    sessionGlobal.__codexflowSessionSql = postgres(databaseUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  return sessionGlobal.__codexflowSessionSql;
}

async function saveSession(input: { login: string; tokenCiphertext: string; expiresAt: string }) {
  const sql = sessionSql();
  if (!sql) return controlPlane().store.createGitHubSession(input);
  const id = randomBytes(24).toString('base64url');
  await sql`insert into codexflow.github_sessions (id, login, token_ciphertext, expires_at, created_at)
    values (${id}, ${input.login}, ${input.tokenCiphertext}, ${input.expiresAt}, ${new Date().toISOString()})`;
  return id;
}

async function loadSession(id: string): Promise<SessionRow | undefined> {
  const sql = sessionSql();
  if (!sql) {
    const row = controlPlane().store.getGitHubSession(id);
    return row
      ? {
          id: String(row.id),
          login: String(row.login),
          tokenCiphertext: String(row.tokenCiphertext),
          expiresAt: String(row.expiresAt),
        }
      : undefined;
  }
  const rows = await sql<
    SessionRow[]
  >`select id, login, token_ciphertext as "tokenCiphertext", expires_at as "expiresAt"
    from codexflow.github_sessions where id = ${id} limit 1`;
  return rows[0];
}

async function removeSession(id: string) {
  const sql = sessionSql();
  if (!sql) {
    controlPlane().store.deleteGitHubSession(id);
    return;
  }
  await sql`delete from codexflow.github_sessions where id = ${id}`;
}

function configuration() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const secret = process.env.CODEXFLOW_SESSION_SECRET;
  if (!clientId || !clientSecret || !secret)
    throw new Error('GitHub OAuth is not configured for this deployment');
  return { clientId, clientSecret, secret };
}
function key(secret: string) {
  return createHash('sha256').update(secret).digest();
}
function encrypt(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decrypt(value: string, secret: string) {
  const raw = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
export function oauthConfigured() {
  return Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID &&
    process.env.GITHUB_OAUTH_CLIENT_SECRET &&
    process.env.CODEXFLOW_SESSION_SECRET,
  );
}

export function githubAppInstallUrl(environment: Record<string, string | undefined> = process.env) {
  const configured = environment.GITHUB_APP_INSTALL_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com')
      throw new Error('GITHUB_APP_INSTALL_URL must be an https://github.com URL');
    return url.toString();
  }
  const slug = environment.GITHUB_APP_SLUG?.trim();
  if (!slug) return undefined;
  if (!/^[a-zA-Z0-9-]+$/.test(slug)) throw new Error('GITHUB_APP_SLUG is invalid');
  return `https://github.com/apps/${slug}/installations/new`;
}

/**
 * Reverse proxies may expose an internal listener URL (for example
 * http://0.0.0.0:10000 on Render) to Next.js. OAuth redirect URIs must use
 * the public URL registered with GitHub, never that internal address.
 */
export function githubOAuthOrigin(
  requestOrigin: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const configured = environment.CODEXFLOW_PUBLIC_URL?.trim();
  if (!configured) return requestOrigin;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('CODEXFLOW_PUBLIC_URL must be an absolute http(s) URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  )
    throw new Error('CODEXFLOW_PUBLIC_URL must be an http(s) origin without a path');
  if (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:')
    throw new Error('CODEXFLOW_PUBLIC_URL must use HTTPS in production');
  return parsed.origin;
}
export async function beginGitHubOAuth(origin: string) {
  const { clientId } = configuration();
  const state = randomBytes(32).toString('base64url');
  const jar = await cookies();
  jar.set(stateCookie, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: `${origin}/auth/github/callback`, scope: 'repo read:user', state })}`;
}
export async function completeGitHubOAuth(origin: string, code: string, state: string) {
  const { clientId, clientSecret, secret } = configuration();
  const jar = await cookies();
  const expected = jar.get(stateCookie)?.value;
  jar.delete(stateCookie);
  if (!expected || expected !== state)
    throw new Error('GitHub authorization state is invalid or expired');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${origin}/auth/github/callback`,
    }),
  });
  if (!response.ok) throw new Error('GitHub authorization code exchange failed');
  const payload = (await response.json()) as { access_token?: string; error_description?: string };
  if (!payload.access_token)
    throw new Error(payload.error_description ?? 'GitHub did not return an access token');
  const provider = new GitHubProvider(payload.access_token);
  const account = await provider.authenticate(payload.access_token);
  const sessionId = await saveSession({
    login: account.login,
    tokenCiphertext: encrypt(payload.access_token, secret),
    expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(),
  });
  jar.set(sessionCookie, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
  return account;
}
export async function currentGitHubSession() {
  if (!oauthConfigured()) return undefined;
  const id = (await cookies()).get(sessionCookie)?.value;
  if (!id) return undefined;
  const session = await loadSession(id);
  if (!session || String(session.expiresAt) <= new Date().toISOString()) return undefined;
  try {
    return {
      id,
      login: String(session.login),
      token: decrypt(String(session.tokenCiphertext), configuration().secret),
    };
  } catch {
    await removeSession(id);
    return undefined;
  }
}
export async function disconnectGitHub() {
  const jar = await cookies();
  const id = jar.get(sessionCookie)?.value;
  if (id) await removeSession(id);
  jar.delete(sessionCookie);
}
