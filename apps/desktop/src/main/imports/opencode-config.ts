import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderEntry, WireApi } from '@open-codesign/shared';

/**
 * One-click import for the OpenCode CLI (`github.com/sst/opencode`).
 *
 * Schema was verified against the upstream source (April 2026):
 *   - `packages/opencode/src/auth/index.ts` defines an Effect.Schema discriminated
 *     union written to `<Global.Path.data>/auth.json`: each top-level key is a
 *     provider ID (e.g. "anthropic", "openai", "google", "openrouter") and the
 *     value is `{type: "api", key, metadata?}` | `{type: "oauth", refresh, access,
 *     expires, ...}` | `{type: "wellknown", key, token}`. The file is written
 *     plaintext with mode 0600.
 *   - `packages/opencode/src/global/index.ts` resolves `Global.Path.data` via
 *     `xdg-basedir`. In that package (`github.com/sindresorhus/xdg-basedir`),
 *     `xdgData = XDG_DATA_HOME || ~/.local/share` on every platform, including
 *     macOS and Windows. OpenCode does NOT switch to `~/Library/Application
 *     Support` on macOS or `%APPDATA%` on Windows.
 *   - `packages/opencode/src/config/config.ts` loads `opencode.jsonc` →
 *     `opencode.json` → `config.json` from `xdgConfig/opencode/` and exposes a
 *     `model: "provider/model"` string. That's the closest thing to a persisted
 *     "active model" — there is no `activeProvider` field; the provider is the
 *     slash-prefix of `model`.
 *
 * We import only `type: "api"` entries. OAuth and wellknown are skipped with a
 * warning — reusing them without the CLI's session tracker risks a refresh race
 * with the user's OpenCode session.
 */

type OpencodeProviderKey =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'mistral'
  | 'groq'
  | 'deepseek'
  | 'xai'
  | 'together'
  | 'fireworks'
  | 'cerebras'
  | 'vercel-ai-gateway';

interface ProviderMapping {
  wire: WireApi;
  baseUrl: string;
  defaultModel: string;
  /** Display name used in the Settings list. Falls back to the capitalized
   *  providerId if missing — but we set it explicitly for the common ones
   *  so users see "OpenCode · Anthropic" rather than "OpenCode · anthropic". */
  label: string;
}

const PROVIDER_MAP: Record<OpencodeProviderKey, ProviderMapping> = {
  anthropic: {
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    label: 'Anthropic',
  },
  openai: {
    wire: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    label: 'OpenAI',
  },
  google: {
    wire: 'openai-chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    label: 'Google',
  },
  openrouter: {
    wire: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.6',
    label: 'OpenRouter',
  },
  mistral: {
    wire: 'openai-chat',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    label: 'Mistral',
  },
  groq: {
    wire: 'openai-chat',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    label: 'Groq',
  },
  deepseek: {
    wire: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    label: 'DeepSeek',
  },
  xai: {
    wire: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2',
    label: 'xAI',
  },
  together: {
    wire: 'openai-chat',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: 'Together',
  },
  fireworks: {
    wire: 'openai-chat',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    label: 'Fireworks',
  },
  cerebras: {
    wire: 'openai-chat',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    label: 'Cerebras',
  },
  'vercel-ai-gateway': {
    wire: 'openai-chat',
    baseUrl: 'https://gateway.ai.vercel.app/v1',
    defaultModel: 'openai/gpt-4o',
    label: 'Vercel AI Gateway',
  },
};

function opencodeDataDir(home: string, env: NodeJS.ProcessEnv): string {
  const xdgData = env['XDG_DATA_HOME'];
  if (typeof xdgData === 'string' && xdgData.length > 0) return join(xdgData, 'opencode');
  return join(home, '.local', 'share', 'opencode');
}

function opencodeConfigDir(home: string, env: NodeJS.ProcessEnv): string {
  const xdgConfig = env['XDG_CONFIG_HOME'];
  if (typeof xdgConfig === 'string' && xdgConfig.length > 0) return join(xdgConfig, 'opencode');
  return join(home, '.config', 'opencode');
}

export function opencodeAuthPath(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(opencodeDataDir(home, env), 'auth.json');
}

export function opencodeConfigCandidatePaths(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dir = opencodeConfigDir(home, env);
  return [join(dir, 'opencode.jsonc'), join(dir, 'opencode.json'), join(dir, 'config.json')];
}

export interface OpencodeImport {
  providers: ProviderEntry[];
  apiKeyMap: Record<string, string>;
  activeProvider: string | null;
  activeModel: string | null;
  warnings: string[];
}

interface AuthEntry {
  type?: unknown;
  key?: unknown;
}

function isKnownProvider(id: string): id is OpencodeProviderKey {
  return Object.hasOwn(PROVIDER_MAP, id);
}

async function readAuthJson(path: string): Promise<{
  raw: Record<string, unknown> | null;
  warning: string | null;
}> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { raw: null, warning: null };
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { raw: null, warning: `OpenCode auth.json has unexpected top-level shape at ${path}` };
    }
    return { raw: parsed as Record<string, unknown>, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { raw: null, warning: `OpenCode auth.json is not valid JSON: ${msg}` };
  }
}

/** Strip `//` and `/* ... *\/` comments so `opencode.jsonc` can be parsed as
 *  JSON. Good enough for the narrow case where we only read one string field;
 *  we intentionally don't pull in a jsonc dep. */
function stripJsonComments(input: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

async function readActiveModelFromConfig(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  for (const path of opencodeConfigCandidatePaths(home, env)) {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(path.endsWith('.jsonc') ? stripJsonComments(text) : text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const model = (parsed as Record<string, unknown>)['model'];
      if (typeof model === 'string' && model.length > 0) return model;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function readOpencodeConfig(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpencodeImport | null> {
  const authPath = opencodeAuthPath(home, env);
  const { raw, warning } = await readAuthJson(authPath);
  if (raw === null && warning === null) return null;

  const warnings: string[] = [];
  if (warning !== null) warnings.push(warning);

  const providers: ProviderEntry[] = [];
  const apiKeyMap: Record<string, string> = {};

  if (raw !== null) {
    for (const [providerId, entry] of Object.entries(raw)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        warnings.push(`OpenCode provider "${providerId}" has an invalid entry shape; skipping`);
        continue;
      }
      const auth = entry as AuthEntry;
      if (auth.type === 'oauth') {
        warnings.push(
          `OpenCode provider "${providerId}" uses OAuth and can't be imported. Log in with an API key in OpenCode, or paste one manually here.`,
        );
        continue;
      }
      if (auth.type === 'wellknown') {
        warnings.push(
          `OpenCode provider "${providerId}" uses a well-known two-token auth scheme that can't be reused outside the CLI; skipping.`,
        );
        continue;
      }
      if (auth.type !== 'api') {
        warnings.push(`OpenCode provider "${providerId}" has unknown auth type; skipping`);
        continue;
      }
      if (typeof auth.key !== 'string' || auth.key.trim().length === 0) {
        warnings.push(`OpenCode provider "${providerId}" has no API key; skipping`);
        continue;
      }
      if (!isKnownProvider(providerId)) {
        warnings.push(
          `OpenCode provider "${providerId}" isn't supported yet — add it as a custom provider.`,
        );
        continue;
      }
      const mapping = PROVIDER_MAP[providerId];
      const importedId = `opencode-${providerId}`;
      providers.push({
        id: importedId,
        name: `OpenCode · ${mapping.label}`,
        builtin: false,
        wire: mapping.wire,
        baseUrl: mapping.baseUrl,
        defaultModel: mapping.defaultModel,
      });
      apiKeyMap[importedId] = auth.key.trim();
    }
  }

  const rawActiveModel = await readActiveModelFromConfig(home, env);
  let activeProvider: string | null = null;
  let activeModel: string | null = null;
  if (rawActiveModel !== null) {
    const slash = rawActiveModel.indexOf('/');
    if (slash > 0 && slash < rawActiveModel.length - 1) {
      const providerPart = rawActiveModel.slice(0, slash);
      const modelPart = rawActiveModel.slice(slash + 1);
      const candidateId = `opencode-${providerPart}`;
      if (providers.some((p) => p.id === candidateId)) {
        activeProvider = candidateId;
        activeModel = modelPart;
        const entry = providers.find((p) => p.id === candidateId);
        if (entry !== undefined) entry.defaultModel = modelPart;
      }
    }
  }

  return {
    providers,
    apiKeyMap,
    activeProvider,
    activeModel,
    warnings,
  };
}
