/**
 * Web server that replaces the Electron ipcMain handlers.
 * All channels map to HTTP routes under /api/*.
 * Agent event streaming uses Server-Sent Events instead of IPC.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  type CoreLogger,
  DESIGN_SKILLS,
  FRAME_TEMPLATES,
  applyComment,
  generate,
  generateTitle,
  generateViaAgent,
} from '@open-codesign/core';
import type { AgentEvent } from '@open-codesign/core';
import { pingProvider } from '@open-codesign/providers';
import {
  CodexTokenStore,
  type StoredCodexAuth,
  buildAuthorizeUrl,
  decodeJwtClaims,
  exchangeCode,
  generatePkce,
} from '@open-codesign/providers/codex';
import {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  CodesignError,
  type Config,
  ConfigV3Schema,
  ERROR_CODES,
  type OnboardingState,
  type ProviderEntry,
  type WireApi,
  WireApiSchema,
  hydrateConfig,
  isSupportedOnboardingProvider,
  modelsEndpointUrl,
  parseConfigFlexible,
  toPersistedV3,
} from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { buildAuthHeadersForWire } from './auth-headers.js';
import {
  createDesign,
  createSnapshot,
  deleteSnapshot,
  duplicateDesign,
  getDesign,
  getSnapshot,
  listDesigns,
  listSnapshots,
  normalizeDesignFilePath,
  renameDesign,
  setDesignThumbnail,
  softDeleteDesign,
  upsertDesignFile,
} from './db-queries.js';
import { scanDesignSystem } from './design-system.js';
import {
  armGenerationTimeout,
  cancelGenerationRequest,
  extractGenerationTimeoutError,
} from './generation-ipc.js';
import { buildSecretRef, decryptSecret, migrateSecrets } from './keychain.js';
import { readPreferences, writePreferences } from './preferences.js';
import { resolveActiveModel } from './provider-settings.js';
// ── Re-use logic from desktop main process (no electron deps) ─────────────────
import { resolveActiveApiKey, resolveApiKeyWithKeylessFallback } from './resolve-api-key.js';
import { createRuntimeTextEditorFs } from './runtime-fs.js';
import { initSnapshotsDb } from './snapshots-db.js';

// Web-safe no-op runtime verifier (no headless browser in Node)
function makeRuntimeVerifier() {
  return async (_artifact: string) => [];
}

// SSE-friendly event type
interface AgentStreamEvent {
  type: string;
  designId?: string;
  generationId?: string;
  [key: string]: unknown;
}

const _require = createRequire(import.meta.url);

const PORT = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const USE_AGENT_RUNTIME = process.env['USE_AGENT_RUNTIME'] !== '0';
const DATA_DIR = process.env['DATA_DIR'] ?? join(homedir(), '.config', 'open-codesign');

// ── Config ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(DATA_DIR, 'config.toml');
const DB_PATH = join(DATA_DIR, 'designs.db');
const PREFS_PATH = join(DATA_DIR, 'preferences.json');

let cachedConfig: Config | null = null;
let configLoaded = false;

function getCachedConfig(): Config | null {
  if (!configLoaded) throw new CodesignError('Config not loaded', ERROR_CODES.CONFIG_NOT_LOADED);
  return cachedConfig;
}

function setCachedConfig(next: Config): void {
  cachedConfig = next;
  configLoaded = true;
}

async function loadConfig(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = parseToml(raw);
    const cfg = parseConfigFlexible(parsed);
    const migrated = migrateSecrets(cfg);
    cachedConfig = migrated.config;
    if (migrated.changed) await saveConfig(migrated.config);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      cachedConfig = null;
    } else {
      throw err;
    }
  }
  configLoaded = true;
}

async function saveConfig(cfg: Config): Promise<void> {
  const persisted = toPersistedV3(cfg);
  ConfigV3Schema.parse(persisted);
  await mkdir(DATA_DIR, { recursive: true });
  const body = stringifyToml(persisted as Record<string, unknown>);
  await writeFile(CONFIG_PATH, body, { encoding: 'utf8', mode: 0o600 });
}

function getApiKeyForProvider(provider: string): string {
  const cfg = getCachedConfig();
  if (cfg === null) throw new CodesignError('No configuration', ERROR_CODES.CONFIG_MISSING);
  const ref = cfg.secrets[provider as keyof typeof cfg.secrets];
  if (ref !== undefined) return decryptSecret(ref.ciphertext);
  const entry = cfg.providers[provider];
  if (entry?.envKey !== undefined) {
    const fromEnv = process.env[entry.envKey]?.trim();
    if (fromEnv) return fromEnv;
  }
  throw new CodesignError(
    `No API key for provider "${provider}"`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
}

function toState(cfg: Config | null): OnboardingState {
  if (cfg === null)
    return { hasKey: false, provider: null, modelPrimary: null, baseUrl: null, designSystem: null };
  const active = cfg.activeProvider;
  const ref = cfg.secrets[active];
  const entry = cfg.providers[active];
  const keyless = entry?.requiresApiKey === false;
  if (ref === undefined && !keyless) {
    return {
      hasKey: false,
      provider: active,
      modelPrimary: null,
      baseUrl: null,
      designSystem: cfg.designSystem ?? null,
    };
  }
  return {
    hasKey: true,
    provider: active,
    modelPrimary: cfg.activeModel,
    baseUrl: entry?.baseUrl ?? null,
    designSystem: cfg.designSystem ?? null,
  };
}

// ── Database ───────────────────────────────────────────────────────────────────

let db: BetterSqlite3.Database | null = null;

function getDb(): BetterSqlite3.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ── Codex OAuth token store ────────────────────────────────────────────────────

const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');
let codexTokenStore: CodexTokenStore | null = null;

function getCodexTokenStore(): CodexTokenStore {
  if (!codexTokenStore) {
    codexTokenStore = new CodexTokenStore({ filePath: CODEX_AUTH_PATH });
  }
  return codexTokenStore;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ── In-flight generation tracking ─────────────────────────────────────────────

const inFlight = new Map<string, AbortController>();

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function sendError(res: Response, status: number, message: string, code?: string): void {
  res
    .status(status)
    .json({ error: { message, code: code ?? 'bad_request', type: 'invalid_request_error' } });
}

function ipcErrorStatus(err: unknown): number {
  if (err instanceof CodesignError) {
    const c = err.code as string;
    if (c === ERROR_CODES.IPC_BAD_INPUT) return 400;
    if (c === ERROR_CODES.CONFIG_MISSING || c === ERROR_CODES.CONFIG_NOT_LOADED) return 503;
    if (c === ERROR_CODES.PROVIDER_AUTH_MISSING || c === ERROR_CODES.PROVIDER_KEY_MISSING)
      return 401;
    if (c === 'IPC_CONFLICT') return 409;
    if (c === 'IPC_DB_BUSY') return 503;
  }
  return 500;
}

function handleError(res: Response, err: unknown): void {
  const status = ipcErrorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof CodesignError ? (err.code as string) : undefined;
  sendError(res, status, message, code);
}

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// ── Onboarding / Config ────────────────────────────────────────────────────────

app.get('/api/onboarding/state', (_req, res) => {
  try {
    res.json(toState(getCachedConfig()));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/onboarding/validate-key', async (req, res) => {
  try {
    const { provider, apiKey, baseUrl } = req.body as {
      provider: string;
      apiKey: string;
      baseUrl?: string;
    };
    if (!isSupportedOnboardingProvider(provider)) {
      return sendError(
        res,
        400,
        `Provider "${provider}" not supported`,
        ERROR_CODES.PROVIDER_NOT_SUPPORTED,
      );
    }
    const result = await pingProvider(provider, apiKey, baseUrl);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/onboarding/save-key', async (req, res) => {
  try {
    const { provider, apiKey, modelPrimary, baseUrl } = req.body as Record<string, string>;
    const state = await runSetProviderAndModels({
      provider,
      apiKey,
      modelPrimary,
      baseUrl,
      setAsActive: true,
    });
    res.json(state);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/config/set-provider-and-models', async (req, res) => {
  try {
    const { provider, apiKey, modelPrimary, baseUrl, setAsActive } = req.body as Record<
      string,
      unknown
    >;
    const state = await runSetProviderAndModels({
      provider: String(provider),
      apiKey: String(apiKey ?? ''),
      modelPrimary: String(modelPrimary),
      baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
      setAsActive: Boolean(setAsActive),
    });
    res.json(state);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/config/add-provider', async (req, res) => {
  try {
    const {
      id,
      name,
      wire,
      baseUrl,
      apiKey,
      defaultModel,
      httpHeaders,
      queryParams,
      envKey,
      setAsActive,
    } = req.body as Record<string, unknown>;
    const parsedWire = WireApiSchema.safeParse(wire);
    if (!parsedWire.success)
      return sendError(res, 400, `Unsupported wire: ${wire}`, ERROR_CODES.IPC_BAD_INPUT);
    const entry: ProviderEntry = {
      id: String(id),
      name: String(name),
      builtin: false,
      wire: parsedWire.data,
      baseUrl: String(baseUrl),
      defaultModel: String(defaultModel),
      ...(httpHeaders && typeof httpHeaders === 'object'
        ? { httpHeaders: httpHeaders as Record<string, string> }
        : {}),
      ...(queryParams && typeof queryParams === 'object'
        ? { queryParams: queryParams as Record<string, string> }
        : {}),
      ...(typeof envKey === 'string' && envKey ? { envKey } : {}),
    };
    const secretRef = buildSecretRef(String(apiKey ?? ''));
    const shouldActivate = setAsActive === true || cachedConfig === null;
    const next = hydrateConfig({
      version: 3,
      activeProvider: shouldActivate ? entry.id : (cachedConfig?.activeProvider ?? entry.id),
      activeModel: shouldActivate
        ? entry.defaultModel
        : (cachedConfig?.activeModel ?? entry.defaultModel),
      secrets: { ...(cachedConfig?.secrets ?? {}), [entry.id]: secretRef },
      providers: { ...(cachedConfig?.providers ?? {}), [entry.id]: entry },
      ...(cachedConfig?.designSystem !== undefined
        ? { designSystem: cachedConfig.designSystem }
        : {}),
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/config/update-provider', async (req, res) => {
  try {
    const {
      id,
      name,
      baseUrl,
      defaultModel,
      wire,
      apiKey,
      httpHeaders,
      queryParams,
      reasoningLevel,
    } = req.body as Record<string, unknown>;
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const existing = cfg.providers[String(id)];
    if (!existing)
      return sendError(res, 400, `Provider "${id}" not found`, ERROR_CODES.IPC_BAD_INPUT);
    const updated: ProviderEntry = {
      ...existing,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof baseUrl === 'string' ? { baseUrl } : {}),
      ...(typeof defaultModel === 'string' ? { defaultModel } : {}),
      ...(typeof wire === 'string' && WireApiSchema.safeParse(wire).success
        ? { wire: wire as WireApi }
        : {}),
      ...(httpHeaders && typeof httpHeaders === 'object'
        ? { httpHeaders: httpHeaders as Record<string, string> }
        : {}),
      ...(queryParams && typeof queryParams === 'object'
        ? { queryParams: queryParams as Record<string, string> }
        : {}),
    };
    if (reasoningLevel === null) updated.reasoningLevel = undefined;
    else if (typeof reasoningLevel === 'string') updated.reasoningLevel = reasoningLevel as never;

    let nextSecrets = cfg.secrets;
    if (typeof apiKey === 'string') {
      if (apiKey.trim() === '') {
        const { [String(id)]: _r, ...rest } = cfg.secrets;
        nextSecrets = rest;
      } else {
        nextSecrets = { ...cfg.secrets, [String(id)]: buildSecretRef(apiKey.trim()) };
      }
    }
    const next = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      secrets: nextSecrets,
      providers: { ...cfg.providers, [String(id)]: updated },
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/config/provider/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cfg = getCachedConfig();
    if (!cfg) return res.json([]);
    const nextSecrets = { ...cfg.secrets };
    delete nextSecrets[id];
    const nextProviders = { ...cfg.providers };
    delete nextProviders[id];
    const remaining = Object.keys(nextProviders);
    const nextActive = remaining.find((p) => p !== id) ?? null;
    const nextActiveModel = nextActive ? (nextProviders[nextActive]?.defaultModel ?? '') : '';
    const next = hydrateConfig({
      version: 3,
      activeProvider: nextActive ?? '',
      activeModel: nextActiveModel,
      secrets: nextSecrets,
      providers: nextProviders,
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/config/set-active-provider', async (req, res) => {
  try {
    const { provider, modelPrimary } = req.body as { provider: string; modelPrimary: string };
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const next = hydrateConfig({
      version: 3,
      activeProvider: provider,
      activeModel: modelPrimary,
      secrets: cfg.secrets,
      providers: cfg.providers,
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/settings/providers', (req, res) => {
  try {
    const cfg = getCachedConfig();
    if (!cfg) return res.json([]);
    const rows = Object.values(cfg.providers).map((p) => ({
      ...p,
      hasKey: cfg.secrets[p.id] !== undefined,
      isActive: p.id === cfg.activeProvider,
    }));
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/config/list-endpoint-models', async (req, res) => {
  try {
    const { wire, baseUrl, apiKey } = req.body as { wire: string; baseUrl: string; apiKey: string };
    const parsedWire = WireApiSchema.safeParse(wire);
    if (!parsedWire.success) return res.json({ ok: false, error: `unsupported wire: ${wire}` });
    let url: string;
    try {
      url = modelsEndpointUrl(baseUrl, parsedWire.data);
    } catch (err) {
      return res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    const headers = buildAuthHeadersForWire(parsedWire.data, apiKey, undefined, baseUrl);
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return res.json({ ok: false, error: `HTTP ${response.status}` });
    const body = (await response.json()) as Record<string, unknown>;
    const data = body['data'] ?? body['models'];
    if (!Array.isArray(data)) return res.json({ ok: false, error: 'unexpected response shape' });
    const ids = data
      .filter(
        (it) =>
          typeof it === 'object' && it !== null && typeof (it as { id?: unknown }).id === 'string',
      )
      .map((it) => (it as { id: string }).id);
    res.json({ ok: true, models: ids });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

async function runSetProviderAndModels(input: {
  provider: string;
  apiKey: string;
  modelPrimary: string;
  baseUrl?: string;
  setAsActive: boolean;
}): Promise<OnboardingState> {
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const existing = nextProviders[input.provider];
  const builtin = BUILTIN_PROVIDERS[input.provider as keyof typeof BUILTIN_PROVIDERS];
  const seed: ProviderEntry = existing ??
    builtin ?? {
      id: input.provider,
      name: input.provider,
      builtin: false,
      wire: 'openai-chat',
      baseUrl: input.baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: input.modelPrimary,
    };
  nextProviders[input.provider] = {
    ...seed,
    baseUrl: input.baseUrl ?? seed.baseUrl,
    defaultModel: input.modelPrimary || seed.defaultModel,
  };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (input.apiKey.trim().length > 0) {
    nextSecrets[input.provider] = buildSecretRef(input.apiKey.trim());
  } else {
    delete nextSecrets[input.provider];
  }
  const activate = input.setAsActive || cachedConfig === null;
  const next = hydrateConfig({
    version: 3,
    activeProvider: activate ? input.provider : (cachedConfig?.activeProvider ?? input.provider),
    activeModel: activate ? input.modelPrimary : (cachedConfig?.activeModel ?? input.modelPrimary),
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await saveConfig(next);
  setCachedConfig(next);
  return toState(cachedConfig);
}

// ── Generate ──────────────────────────────────────────────────────────────────

app.post('/api/generate', async (req: Request, res: Response) => {
  const payload = req.body as {
    generationId?: string;
    prompt: string;
    history: unknown[];
    model: { provider: string; modelId: string };
    attachments: unknown[];
    referenceUrl?: string;
    designId?: string;
    previousHtml?: string;
    baseUrl?: string;
  };

  const id = payload.generationId ?? `gen-${Date.now()}`;

  const cfg = getCachedConfig();
  if (!cfg) {
    return sendError(
      res,
      503,
      'No configuration. Complete onboarding first.',
      ERROR_CODES.CONFIG_MISSING,
    );
  }

  const active = resolveActiveModel(cfg, payload.model);
  const allowKeyless = active.allowKeyless;
  let apiKey: string;
  try {
    apiKey = await resolveApiKeyWithKeylessFallback(active.model.provider, allowKeyless, {
      getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
      getApiKeyForProvider,
    });
  } catch (err) {
    return handleError(res, err);
  }

  const baseUrl = active.baseUrl ?? undefined;
  const isCodex = active.model.provider === CHATGPT_CODEX_PROVIDER_ID;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const controller = new AbortController();
  inFlight.set(id, controller);

  const sendEvent = (event: Record<string, unknown>): void => {
    sseWrite(res, event);
  };

  const coreLogger: CoreLogger = {
    info: (event, data) => console.log(`[${id}] ${event}`, data ?? ''),
    warn: (event, data) => console.warn(`[${id}] ${event}`, data ?? ''),
    error: (event, data) => console.error(`[${id}] ${event}`, data ?? ''),
  };

  const designId = payload.designId ?? null;
  const previousHtml = payload.previousHtml ?? null;

  const { fs, fsMap } = createRuntimeTextEditorFs({
    db,
    designId,
    generationId: id,
    previousHtml,
    sendEvent,
    logger: coreLogger,
  });

  const generateInput = {
    prompt: payload.prompt,
    history: payload.history as never,
    model: active.model,
    apiKey,
    ...(isCodex
      ? {
          getApiKey: () =>
            resolveApiKeyWithKeylessFallback(active.model.provider, allowKeyless, {
              getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
              getApiKeyForProvider,
            }),
        }
      : {}),
    attachments: payload.attachments as never,
    referenceUrl: payload.referenceUrl ? { url: payload.referenceUrl } : undefined,
    designSystem: cfg.designSystem ?? null,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    wire: active.wire,
    ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
    explicitCapabilities: active.explicitCapabilities,
    ...(allowKeyless ? { allowKeyless: true as const } : {}),
    signal: controller.signal,
    logger: coreLogger,
    capabilities: active.capabilities,
  };

  const prefs = await readPreferences(DATA_DIR);
  const clearTimeout = await armGenerationTimeout(
    id,
    controller,
    async () => prefs.generationTimeoutSec,
    console,
  );

  try {
    let result: Awaited<ReturnType<typeof generate>>;

    if (!USE_AGENT_RUNTIME) {
      result = await generate(generateInput);
    } else {
      const runtimeVerify = makeRuntimeVerifier();
      result = await generateViaAgent(generateInput, {
        fs,
        runtimeVerify,
        onEvent: (event: AgentEvent) => {
          if (designId === null) return;
          const baseCtx = { designId, generationId: id };
          if (event.type === 'turn_start') {
            sendEvent({ ...baseCtx, type: 'turn_start' });
          } else if (event.type === 'message_update') {
            const ame = event.assistantMessageEvent;
            if (
              ame.type === 'text_delta' &&
              typeof (ame as { delta?: unknown }).delta === 'string'
            ) {
              sendEvent({
                ...baseCtx,
                type: 'text_delta',
                delta: (ame as { delta: string }).delta,
              });
            }
          } else if (event.type === 'tool_execution_start') {
            sendEvent({
              ...baseCtx,
              type: 'tool_call_start',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              args: event.args as Record<string, unknown>,
            });
          } else if (event.type === 'tool_execution_end') {
            sendEvent({
              ...baseCtx,
              type: 'tool_call_result',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              result: event.result,
              durationMs: 0,
            });
          } else if (event.type === 'turn_end') {
            const msg = event.message as { content?: Array<{ type: string; text?: string }> };
            const rawText = (msg.content ?? [])
              .filter(
                (c): c is { type: 'text'; text: string } =>
                  c.type === 'text' && typeof c.text === 'string',
              )
              .map((c) => c.text)
              .join('');
            const finalText = rawText.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
            sendEvent({ ...baseCtx, type: 'turn_end', finalText });
          } else if (event.type === 'agent_end') {
            sendEvent({ ...baseCtx, type: 'agent_end' });
          }
        },
      }).then((r) => ({
        ...r,
        artifacts: r.artifacts.map((a) => ({
          ...a,
          content: resolveLocalAssetRefs(a.content, fsMap),
        })),
      }));
    }

    res.write(`data: ${JSON.stringify({ type: 'done', result })}\n\n`);
    res.end();
  } catch (err) {
    const timeoutErr = extractGenerationTimeoutError(controller.signal);
    const rethrow = timeoutErr ?? err;
    const message = rethrow instanceof Error ? rethrow.message : String(rethrow);
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  } finally {
    clearTimeout();
    inFlight.delete(id);
  }
});

app.post('/api/generate/cancel', (req, res) => {
  const { generationId } = req.body as { generationId: string };
  cancelGenerationRequest(generationId, inFlight, console);
  res.json({ ok: true });
});

app.post('/api/generate/title', async (req, res) => {
  try {
    const { prompt } = req.body as { prompt: string };
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const active = resolveActiveModel(cfg, {
      provider: cfg.activeProvider,
      modelId: cfg.activeModel,
    });
    const apiKey = await resolveApiKeyWithKeylessFallback(
      active.model.provider,
      active.allowKeyless,
      {
        getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
        getApiKeyForProvider,
      },
    );
    const title = await generateTitle({
      prompt,
      model: active.model,
      apiKey,
      ...(active.baseUrl ? { baseUrl: active.baseUrl } : {}),
      wire: active.wire,
      capabilities: active.capabilities,
    });
    res.json({ title });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/apply-comment', async (req, res) => {
  try {
    const payload = req.body as {
      html: string;
      comment: string;
      selection: unknown;
      attachments: unknown[];
      referenceUrl?: string;
      model?: { provider: string; modelId: string };
    };
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const hint = payload.model ?? { provider: cfg.provider, modelId: cfg.modelPrimary };
    const active = resolveActiveModel(cfg, hint as never);
    const apiKey = await resolveApiKeyWithKeylessFallback(
      active.model.provider,
      active.allowKeyless,
      {
        getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
        getApiKeyForProvider,
      },
    );
    const result = await applyComment({
      html: payload.html,
      comment: payload.comment,
      selection: payload.selection as never,
      model: active.model,
      apiKey,
      attachments: payload.attachments as never,
      referenceUrl: payload.referenceUrl ? { url: payload.referenceUrl } : undefined,
      designSystem: cfg.designSystem ?? null,
      ...(active.baseUrl ? { baseUrl: active.baseUrl } : {}),
      wire: active.wire,
      capabilities: active.capabilities,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Runtime verify ─────────────────────────────────────────────────────────────

const sharedVerifier = makeRuntimeVerifier();
app.post('/api/done-verify', async (req, res) => {
  try {
    const { artifact } = req.body as { artifact: string };
    const errors = await sharedVerifier(artifact);
    res.json({ errors });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Snapshots ──────────────────────────────────────────────────────────────────

app.get('/api/designs', (req, res) => {
  try {
    const designs = listDesigns(getDb());
    res.json(designs);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs', (req, res) => {
  try {
    const design = createDesign(getDb(), req.body);
    res.json(design);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/designs/:id', (req, res) => {
  try {
    const design = getDesign(getDb(), req.params.id);
    if (!design) return sendError(res, 404, 'Design not found', 'not_found');
    res.json(design);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/rename', (req, res) => {
  try {
    const { name } = req.body as { name: string };
    renameDesign(getDb(), req.params.id, name);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/thumbnail', (req, res) => {
  try {
    const { thumbnail } = req.body as { thumbnail: string };
    setDesignThumbnail(getDb(), req.params.id, thumbnail);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/designs/:id', (req, res) => {
  try {
    softDeleteDesign(getDb(), req.params.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/duplicate', (req, res) => {
  try {
    const design = duplicateDesign(getDb(), req.params.id);
    res.json(design);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/designs/:id/snapshots', (req, res) => {
  try {
    const snapshots = listSnapshots(getDb(), req.params.id);
    res.json(snapshots);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/snapshots', (req, res) => {
  try {
    const snapshot = createSnapshot(getDb(), { ...req.body, designId: req.params.id });
    res.json(snapshot);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/snapshots/:id', (req, res) => {
  try {
    const snapshot = getSnapshot(getDb(), req.params.id);
    if (!snapshot) return sendError(res, 404, 'Snapshot not found', 'not_found');
    res.json(snapshot);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/snapshots/:id', (req, res) => {
  try {
    deleteSnapshot(getDb(), req.params.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── File upload (replaces file dialogs) ───────────────────────────────────────

app.post('/api/upload-files', upload.array('files'), (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const result = files.map((f) => ({
      name: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
      dataUrl: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`,
    }));
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Preferences ────────────────────────────────────────────────────────────────

app.get('/api/preferences', async (_req, res) => {
  try {
    const prefs = await readPreferences(DATA_DIR);
    res.json(prefs);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/preferences', async (req, res) => {
  try {
    const prefs = await readPreferences(DATA_DIR);
    const updated = { ...prefs, ...req.body };
    await writePreferences(DATA_DIR, updated);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Codex OAuth ────────────────────────────────────────────────────────────────

app.get('/api/codex/status', async (_req, res) => {
  try {
    const store = getCodexTokenStore();
    const auth = await store.read();
    if (!auth) {
      res.json({ loggedIn: false, email: null, accountId: null, expiresAt: null });
    } else {
      const now = Date.now();
      res.json({
        loggedIn: auth.expiresAt > now,
        email: auth.email,
        accountId: auth.accountId,
        expiresAt: auth.expiresAt,
      });
    }
  } catch {
    res.json({ loggedIn: false, email: null, accountId: null, expiresAt: null });
  }
});

app.post('/api/codex/start-login', (_req, res) => {
  try {
    const pkce = generatePkce();
    const state = randomUUID();
    const redirectUri = `http://localhost:${PORT}/api/codex/callback`;
    const url = buildAuthorizeUrl({ challenge: pkce.challenge, state, redirectUri });
    pendingCodexPkce = { verifier: pkce.verifier, state, redirectUri };
    res.json({ url });
  } catch (err) {
    handleError(res, err);
  }
});

let pendingCodexPkce: { verifier: string; state: string; redirectUri: string } | null = null;

app.get('/api/codex/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !pendingCodexPkce || state !== pendingCodexPkce.state) {
      return res.status(400).send('Invalid OAuth callback');
    }
    const tokens = await exchangeCode(
      code,
      pendingCodexPkce.verifier,
      pendingCodexPkce.redirectUri,
    );
    const claims = decodeJwtClaims(tokens.idToken);
    const auth: StoredCodexAuth = {
      schemaVersion: 1,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresAt: tokens.expiresAt,
      accountId: tokens.accountId,
      email: typeof claims?.email === 'string' ? claims.email : null,
      updatedAt: Date.now(),
    };
    await getCodexTokenStore().write(auth);
    pendingCodexPkce = null;

    // Register Codex provider in config
    const cfg = getCachedConfig();
    if (cfg) {
      const codexEntry: ProviderEntry = {
        id: CHATGPT_CODEX_PROVIDER_ID,
        name: 'ChatGPT Subscription',
        builtin: false,
        wire: 'openai-codex-responses',
        baseUrl: 'https://chatgpt.com/backend-api',
        defaultModel: 'gpt-5.3-codex',
        requiresApiKey: false,
        capabilities: {
          supportsKeyless: true,
          supportsModelsEndpoint: false,
          supportsReasoning: true,
          requiresClaudeCodeIdentity: false,
          modelDiscoveryMode: 'static-hint',
        },
        modelsHint: [
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.3-codex-spark',
          'gpt-5.2-codex',
          'gpt-5.2',
          'gpt-5.1-codex-max',
          'gpt-5.1',
          'gpt-5.4-mini',
          'gpt-5.1-codex-mini',
        ],
      };
      const next = hydrateConfig({
        version: 3,
        activeProvider: cfg.activeProvider || CHATGPT_CODEX_PROVIDER_ID,
        activeModel: cfg.activeModel || 'gpt-5.3-codex',
        secrets: cfg.secrets,
        providers: { ...cfg.providers, [CHATGPT_CODEX_PROVIDER_ID]: codexEntry },
        ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
      });
      await saveConfig(next);
      setCachedConfig(next);
    }

    res.send(
      '<html><body><script>window.close();</script><p>Login successful! You may close this tab.</p></body></html>',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`OAuth error: ${msg}`);
  }
});

app.post('/api/codex/logout', async (_req, res) => {
  try {
    await getCodexTokenStore().clear();
    const cfg = getCachedConfig();
    if (cfg) {
      const { [CHATGPT_CODEX_PROVIDER_ID]: _removed, ...providers } = cfg.providers;
      const { [CHATGPT_CODEX_PROVIDER_ID]: _removedS, ...secrets } = cfg.secrets;
      const wasActive = cfg.activeProvider === CHATGPT_CODEX_PROVIDER_ID;
      const fallback = Object.keys(providers)[0];
      const next = hydrateConfig({
        version: 3,
        activeProvider: wasActive ? (fallback ?? '') : cfg.activeProvider,
        activeModel: wasActive ? (providers[fallback]?.defaultModel ?? '') : cfg.activeModel,
        secrets,
        providers,
        ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
      });
      await saveConfig(next);
      setCachedConfig(next);
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Design system ──────────────────────────────────────────────────────────────

app.post('/api/design-system/scan', async (req, res) => {
  try {
    const { rootPath } = req.body as { rootPath: string };
    const snapshot = await scanDesignSystem(rootPath);
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const next = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      secrets: cfg.secrets,
      providers: cfg.providers,
      designSystem: snapshot,
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/design-system', async (_req, res) => {
  try {
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const next = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      secrets: cfg.secrets,
      providers: cfg.providers,
    });
    await saveConfig(next);
    setCachedConfig(next);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

// ── Provider detection ─────────────────────────────────────────────────────────

app.post('/api/detect-provider', (req, res) => {
  try {
    const { key } = req.body as { key: string };
    // Heuristic detection from key format
    let provider = 'openai';
    if (key.startsWith('sk-ant-')) provider = 'anthropic';
    else if (key.startsWith('AIza') || key.startsWith('ya29.')) provider = 'google';
    else if (key.startsWith('sk-or-')) provider = 'openrouter';
    else if (key.startsWith('ghu_') || key.startsWith('ghp_')) provider = 'github-copilot';
    res.json({ provider });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Locale ─────────────────────────────────────────────────────────────────────

app.get('/api/locale', (_req, res) => {
  res.json({ locale: process.env['LANG'] ?? 'en-US' });
});

// ── Serve frontend static files ────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIST = join(__dirname, '..', '..', 'desktop', 'out', 'renderer');

app.use(express.static(RENDERER_DIST));
app.get('*', (_req, res) => {
  res.sendFile(join(RENDERER_DIST, 'index.html'));
});

// ── Asset ref resolver (same as main/index.ts) ────────────────────────────────

function resolveLocalAssetRefs(source: string, files: Map<string, string>): string {
  let resolved = source;
  for (const [path, content] of files.entries()) {
    if (!path.startsWith('assets/') || !content.startsWith('data:')) continue;
    resolved = resolved.replace(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      content,
    );
  }
  return resolved;
}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadConfig();
  console.log('[web-server] Config loaded, hasConfig:', cachedConfig !== null);

  try {
    await mkdir(dirname(DB_PATH), { recursive: true });
    db = initSnapshotsDb(DB_PATH);
    console.log('[web-server] Database ready');
  } catch (err) {
    console.error('[web-server] DB init failed (non-fatal):', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[web-server] Listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[web-server] Fatal startup error:', err);
  process.exit(1);
});
