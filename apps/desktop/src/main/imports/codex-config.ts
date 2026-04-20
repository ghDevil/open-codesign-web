import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ProviderEntry, type WireApi, detectWireFromBaseUrl } from '@open-codesign/shared';

/**
 * Path resolution for `~/.codex/config.toml`. Exported for testing.
 */
export function codexConfigPath(home: string = homedir()): string {
  return join(home, '.codex', 'config.toml');
}

export interface CodexImport {
  providers: ProviderEntry[];
  activeProvider: string | null;
  activeModel: string | null;
  /** Env-key lookups the caller should run to resolve keys. */
  envKeyMap: Record<string, string>; // providerId → envVarName
  warnings: string[];
}

type CodexProviderBlock = {
  name?: string;
  base_url?: string;
  env_key?: string;
  model?: string;
  wire_api?: string;
  http_headers?: Record<string, string>;
  query_params?: Record<string, string>;
};

const FALLBACK_IMPORTED_MODEL = 'gpt-4o';

/**
 * Parse a Codex `config.toml` string and translate each `[model_providers.X]`
 * block into a v3 `ProviderEntry`. Unknown keys are silently ignored (parse
 * leniently — §8 risk mitigation).
 */
export async function parseCodexConfig(toml: string): Promise<CodexImport> {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    const { parse } = await import('smol-toml');
    parsed = parse(toml);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      providers: [],
      activeProvider: null,
      activeModel: null,
      envKeyMap: {},
      warnings: [`Codex config.toml is not valid TOML: ${msg}`],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      providers: [],
      activeProvider: null,
      activeModel: null,
      envKeyMap: {},
      warnings: ['Codex config.toml has unexpected top-level shape'],
    };
  }

  const root = parsed as Record<string, unknown>;
  const modelProviders = root['model_providers'];
  const activeProviderRaw = root['model_provider'];
  const activeModelRaw = root['model'];
  const activeProviderId =
    typeof activeProviderRaw === 'string' && activeProviderRaw.length > 0
      ? `codex-${activeProviderRaw}`
      : null;
  const activeModel =
    typeof activeModelRaw === 'string' && activeModelRaw.length > 0 ? activeModelRaw : null;
  const providers: ProviderEntry[] = [];
  const envKeyMap: Record<string, string> = {};

  if (modelProviders !== undefined) {
    if (typeof modelProviders !== 'object' || modelProviders === null) {
      warnings.push('Codex [model_providers] is not an object; skipping');
    } else {
      for (const [id, rawBlock] of Object.entries(modelProviders)) {
        if (typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) continue;
        const block = rawBlock as CodexProviderBlock;
        if (typeof block.base_url !== 'string' || block.base_url.trim().length === 0) {
          warnings.push(`Codex provider "${id}" missing base_url; skipping`);
          continue;
        }
        const wire: WireApi =
          block.wire_api === 'responses'
            ? 'openai-responses'
            : block.wire_api === 'chat'
              ? 'openai-chat'
              : detectWireFromBaseUrl(block.base_url);
        const blockModel = typeof block.model === 'string' ? block.model.trim() : '';
        const activeModelForProvider =
          activeProviderId === `codex-${id}` && activeModel !== null ? activeModel : null;
        const defaultModel = (activeModelForProvider ?? blockModel) || FALLBACK_IMPORTED_MODEL;
        const entry: ProviderEntry = {
          id: `codex-${id}`,
          name: 'Codex (imported)',
          builtin: false,
          wire,
          baseUrl: block.base_url,
          defaultModel,
        };
        if (typeof block.env_key === 'string' && block.env_key.length > 0) {
          entry.envKey = block.env_key;
          envKeyMap[entry.id] = block.env_key;
        }
        if (block.http_headers !== undefined && typeof block.http_headers === 'object') {
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(block.http_headers)) {
            if (typeof v === 'string') map[k] = v;
          }
          if (Object.keys(map).length > 0) entry.httpHeaders = map;
        }
        if (block.query_params !== undefined && typeof block.query_params === 'object') {
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(block.query_params)) {
            if (typeof v === 'string') map[k] = v;
          }
          if (Object.keys(map).length > 0) entry.queryParams = map;
        }
        providers.push(entry);
      }
    }
  }

  // Backfill defaultModel for the active provider so the UI has something to
  // offer by default even if the provider block did not declare a model.
  if (activeProviderId !== null && activeModel !== null) {
    const entry = providers.find((p) => p.id === activeProviderId);
    if (entry !== undefined) entry.defaultModel = activeModel;
  }

  return { providers, activeProvider: activeProviderId, activeModel, envKeyMap, warnings };
}

export async function readCodexConfig(home: string = homedir()): Promise<CodexImport | null> {
  const path = codexConfigPath(home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseCodexConfig(raw);
}
