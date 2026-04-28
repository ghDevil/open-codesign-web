import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';

export interface StoredCopilotAuth {
  accessToken: string;
  login: string | null;
  host: string;
  baseUrl: string;
  source: 'env' | 'config';
}

const COPILOT_CONFIG_DIR = join(homedir(), '.copilot');
const ENV_TOKEN_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;
const MAX_SCAN_DEPTH = 3;
const MAX_JSON_BYTES = 1_000_000;

interface CopilotConfigRecord {
  copilotTokens?: Record<string, unknown>;
  lastLoggedInUser?: { host?: unknown; login?: unknown };
}

function stripJsonLineComments(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
    .trim();
}

function normalizeHost(host: string | undefined): string {
  if (!host || host.trim().length === 0) return 'https://github.com';
  const trimmed = host.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed.replace(/\/+$/, '')
    : `https://${trimmed.replace(/\/+$/, '')}`;
}

function resolveCopilotBaseUrl(host: string): string {
  const override = process.env['COPILOT_API_URL']?.trim();
  if (override) return override.replace(/\/+$/, '');
  try {
    const hostname = new URL(host).hostname.toLowerCase();
    if (hostname === 'github.com') return 'https://api.githubcopilot.com';
    const gheMatch = hostname.match(/^(.+)\.ghe\.com$/);
    if (gheMatch) return `https://copilot-api.${gheMatch[1]}.ghe.com`;
  } catch {
    // Fall back to the public endpoint when the stored host is malformed.
  }
  return 'https://api.githubcopilot.com';
}

function isSupportedToken(token: string): boolean {
  return token.trim().length > 0 && !token.startsWith('ghp_');
}

function splitStoredAccountKey(key: string): { host: string; login: string | null } {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex === -1) {
    return { host: normalizeHost(undefined), login: null };
  }
  const host = normalizeHost(key.slice(0, separatorIndex));
  const login = key.slice(separatorIndex + 1).trim();
  return { host, login: login.length > 0 ? login : null };
}

function buildStoredAuth(
  token: string,
  host: string,
  login: string | null,
  source: StoredCopilotAuth['source'],
): StoredCopilotAuth {
  const normalizedHost = normalizeHost(host);
  return {
    accessToken: token,
    login,
    host: normalizedHost,
    baseUrl: resolveCopilotBaseUrl(normalizedHost),
    source,
  };
}

function readEnvAuth(): StoredCopilotAuth | null {
  for (const envVar of ENV_TOKEN_VARS) {
    const token = process.env[envVar]?.trim();
    if (!token || !isSupportedToken(token)) continue;
    const host = normalizeHost(process.env['GITHUB_HOST'] ?? process.env['GH_HOST']);
    return buildStoredAuth(token, host, null, 'env');
  }
  return null;
}

function extractAuthFromConfig(value: unknown): StoredCopilotAuth | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const parsed = value as CopilotConfigRecord;
  const tokens = parsed.copilotTokens;
  if (tokens === undefined || typeof tokens !== 'object' || tokens === null) return null;

  const preferredHost =
    parsed.lastLoggedInUser && typeof parsed.lastLoggedInUser.host === 'string'
      ? normalizeHost(parsed.lastLoggedInUser.host)
      : null;
  const preferredLogin =
    parsed.lastLoggedInUser && typeof parsed.lastLoggedInUser.login === 'string'
      ? parsed.lastLoggedInUser.login.trim() || null
      : null;
  const preferredKey =
    preferredHost !== null && preferredLogin !== null ? `${preferredHost}:${preferredLogin}` : null;

  if (preferredKey !== null && preferredHost !== null) {
    const preferredToken = tokens[preferredKey];
    if (typeof preferredToken === 'string' && isSupportedToken(preferredToken)) {
      return buildStoredAuth(preferredToken, preferredHost, preferredLogin, 'config');
    }
  }

  for (const [accountKey, token] of Object.entries(tokens)) {
    if (typeof token !== 'string' || !isSupportedToken(token)) continue;
    const { host, login } = splitStoredAccountKey(accountKey);
    return buildStoredAuth(token, host, login, 'config');
  }

  return null;
}

async function findConfigAuth(dir: string, depth: number): Promise<StoredCopilotAuth | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    const filePath = join(dir, entry.name);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_JSON_BYTES) continue;
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(stripJsonLineComments(raw)) as unknown;
      const auth = extractAuthFromConfig(parsed);
      if (auth !== null) return auth;
    } catch {
      // Ignore malformed or unrelated files and keep scanning.
    }
  }

  if (depth >= MAX_SCAN_DEPTH) return null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await findConfigAuth(join(dir, entry.name), depth + 1);
    if (nested !== null) return nested;
  }

  return null;
}

async function clearConfigTokens(dir: string, depth: number): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return false;
  }

  let cleared = false;

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    const filePath = join(dir, entry.name);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_JSON_BYTES) continue;
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(stripJsonLineComments(raw)) as CopilotConfigRecord;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        parsed.copilotTokens === undefined ||
        typeof parsed.copilotTokens !== 'object' ||
        parsed.copilotTokens === null
      ) {
        continue;
      }
      const next = {
        ...parsed,
        copilotTokens: {},
        lastLoggedInUser: undefined,
      };
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      cleared = true;
    } catch {
      // Ignore malformed or unrelated files and keep scanning.
    }
  }

  if (depth >= MAX_SCAN_DEPTH) return cleared;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nestedCleared = await clearConfigTokens(join(dir, entry.name), depth + 1);
    cleared = nestedCleared || cleared;
  }

  return cleared;
}

export async function readStoredCopilotAuth(): Promise<StoredCopilotAuth | null> {
  const envAuth = readEnvAuth();
  if (envAuth !== null) return envAuth;
  return findConfigAuth(COPILOT_CONFIG_DIR, 0);
}

export async function getStoredCopilotAccessToken(): Promise<string> {
  const auth = await readStoredCopilotAuth();
  if (auth === null) throw new Error('GitHub Copilot not signed in');
  return auth.accessToken;
}

// VS Code identity headers required by the Copilot API gateway
export const COPILOT_VSCODE_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
};

interface CachedSessionToken {
  token: string;
  expiresAt: number;
}

let cachedSessionToken: CachedSessionToken | null = null;

/**
 * Exchange the stored GitHub OAuth token (ghu_*) for a short-lived Copilot
 * session token. Caches the result until 5 minutes before expiry.
 */
export async function getCopilotSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedSessionToken !== null && cachedSessionToken.expiresAt > now) {
    return cachedSessionToken.token;
  }

  const auth = await readStoredCopilotAuth();
  if (auth === null) throw new Error('GitHub Copilot not signed in');

  const host = new URL(auth.host).hostname;
  const tokenUrl = `https://api.${host}/copilot_internal/v2/token`;

  const response = await fetch(tokenUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
      ...COPILOT_VSCODE_HEADERS,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Copilot session token exchange failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof data.token !== 'string') {
    throw new Error('Copilot session token response missing token field');
  }

  const expiresAt =
    typeof data.expires_at === 'number'
      ? data.expires_at * 1000 - 5 * 60 * 1000
      : now + 25 * 60 * 1000;

  cachedSessionToken = { token: data.token, expiresAt };
  return data.token;
}

export async function clearStoredCopilotAuth(): Promise<void> {
  if (readEnvAuth() !== null) {
    throw new Error(
      'GitHub Copilot auth is coming from COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN. Unset that environment variable to sign out.',
    );
  }
  const cleared = await clearConfigTokens(COPILOT_CONFIG_DIR, 0);
  if (!cleared) throw new Error('GitHub Copilot not signed in');
}

export { COPILOT_CONFIG_DIR, resolveCopilotBaseUrl };