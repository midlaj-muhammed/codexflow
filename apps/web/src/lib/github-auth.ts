import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { GitHubProvider } from '@codexflow/providers';
import { controlPlane } from './control-plane';

const sessionCookie = 'codexflow_github_session';
const stateCookie = 'codexflow_github_oauth_state';
const maxAge = 60 * 60 * 24 * 7;

function configuration() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const secret = process.env.CODEXFLOW_SESSION_SECRET;
  if (!clientId || !clientSecret || !secret)
    throw new Error('GitHub OAuth is not configured for this deployment');
  return { clientId, clientSecret, secret };
}
function key(secret: string) { return createHash('sha256').update(secret).digest(); }
function encrypt(value: string, secret: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decrypt(value: string, secret: string) {
  const raw = Buffer.from(value, 'base64url'); const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
export function oauthConfigured() {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET && process.env.CODEXFLOW_SESSION_SECRET);
}
export async function beginGitHubOAuth(origin: string) {
  const { clientId } = configuration();
  const state = randomBytes(32).toString('base64url');
  const jar = await cookies();
  jar.set(stateCookie, state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: `${origin}/auth/github/callback`, scope: 'repo read:user', state })}`;
}
export async function completeGitHubOAuth(origin: string, code: string, state: string) {
  const { clientId, clientSecret, secret } = configuration();
  const jar = await cookies();
  const expected = jar.get(stateCookie)?.value;
  jar.delete(stateCookie);
  if (!expected || expected !== state) throw new Error('GitHub authorization state is invalid or expired');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${origin}/auth/github/callback` }),
  });
  if (!response.ok) throw new Error('GitHub authorization code exchange failed');
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!payload.access_token) throw new Error(payload.error_description ?? 'GitHub did not return an access token');
  const provider = new GitHubProvider(payload.access_token);
  const account = await provider.authenticate(payload.access_token);
  const sessionId = controlPlane().store.createGitHubSession({ login: account.login, tokenCiphertext: encrypt(payload.access_token, secret), expiresAt: new Date(Date.now() + maxAge * 1000).toISOString() });
  jar.set(sessionCookie, sessionId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge });
  return account;
}
export async function currentGitHubSession() {
  if (!oauthConfigured()) return undefined;
  const id = (await cookies()).get(sessionCookie)?.value;
  if (!id) return undefined;
  const session = controlPlane().store.getGitHubSession(id);
  if (!session || String(session.expiresAt) <= new Date().toISOString()) return undefined;
  try { return { id, login: String(session.login), token: decrypt(String(session.tokenCiphertext), configuration().secret) }; }
  catch { controlPlane().store.deleteGitHubSession(id); return undefined; }
}
export async function disconnectGitHub() {
  const jar = await cookies(); const id = jar.get(sessionCookie)?.value;
  if (id) controlPlane().store.deleteGitHubSession(id);
  jar.delete(sessionCookie);
}
