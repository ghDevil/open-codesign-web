/**
 * Web server that replaces the Electron ipcMain handlers.
 * All channels map to HTTP routes under /api/*.
 * Agent event streaming uses Server-Sent Events instead of IPC.
 */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  type CoreLogger,
  DESIGN_SKILLS,
  FRAME_TEMPLATES,
  applyComment,
  clarifyPrompt,
  generate,
  generateTitle,
  generateViaAgent,
} from '@open-codesign/core';
import { type ExporterFormat, exportArtifact } from '@open-codesign/exporters';
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
  GITHUB_COPILOT_PROVIDER_ID,
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
  COPILOT_CONFIG_DIR,
  COPILOT_VSCODE_HEADERS,
  clearStoredCopilotAuth,
  getCopilotSessionToken,
  getStoredCopilotAccessToken,
  readStoredCopilotAuth,
} from './copilot-token-store.js';
import {
  appendChatMessage,
  clearDesignWorkspace,
  createComment,
  createDesign,
  createSnapshot,
  deleteDesignFilesByPrefix,
  deleteComment,
  deleteSnapshot,
  duplicateDesign,
  getDesign,
  getSnapshot,
  listChatMessages,
  listComments,
  listDesignFiles,
  listDesigns,
  listPendingEdits,
  listSnapshots,
  markCommentsApplied,
  normalizeDesignFilePath,
  renameDesign,
  seedChatFromSnapshots,
  setDesignThumbnail,
  softDeleteDesign,
  updateChatToolCallStatus,
  updateComment,
  updateDesignProjectInstructions,
  updateDesignWorkspace,
  upsertDesignFile,
  viewDesignFile,
  createFolder,
  deleteFolder,
  listFolders,
  moveDesignToFolder,
  renameFolder,
} from './db-queries.js';
import { scanDesignSystem } from './design-system.js';
import {
  importDesignSystemFromFigma,
  importDesignSystemFromGithub,
  importDesignSystemFromManual,
} from './design-system-import.js';
import {
  activateDesignSystem,
  addDesignSystem,
  createDesignSystemRecord,
  ensureSeededLibrary,
  findDesignSystemById,
  getActiveDesignSystem,
  readDesignSystemsLibrary,
  removeDesignSystem,
  writeDesignSystemsLibrary,
  type DesignSystemsLibrary,
} from './design-systems-store.js';
import { parseOfficeDocument } from './document-parsers.js';
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
import {
  callMcpTool,
  loadMcpTools,
  type McpServerConfig,
  type McpToolCallResult,
} from './mcp-tools.js';
import { buildHostedWorkspaceContext } from './project-context.js';
import { createRuntimeTextEditorFs } from './runtime-fs.js';
import { initSnapshotsDb } from './snapshots-db.js';
import {
  getHostedWorkspaceDiskPath,
  isTextWorkspaceFile,
  normalizeHostedWorkspaceLabel,
  normalizeUploadedWorkspacePath,
} from './workspace-binding.js';

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

// MCP servers bridged into the agent tool surface.
// Keys are injected at runtime from env vars so no secrets live in source.
const MCP_SERVERS: McpServerConfig[] = (() => {
  if (process.env['MCP_DISABLED'] === '1') return [];
  const servers: McpServerConfig[] = [];

  // bcgpt — Basecamp MCP. Only loaded when user explicitly asks about Basecamp/projects.
  // Not added to MCP_SERVERS by default — loaded on-demand via BCGPT_SERVER constant.
  // (86 tools would exhaust the 128-tool OpenAI limit for all other generations)

  // Official figma-mcp (local supergateway sidecar on port 3001, streamableHttp)
  // Only enabled when MCP_FIGMA_LOCAL_ENABLED=1 (disabled by default due to supergateway stateless bug).
  const figmaLocalUrl = process.env['MCP_FIGMA_LOCAL_URL'] ?? 'http://localhost:3001/mcp';
  if (process.env['MCP_FIGMA_LOCAL_ENABLED'] === '1') {
    servers.push({ name: 'figma-official', endpoint: figmaLocalUrl });
  }

  // Figma FM MCP (fm.wickedlab.io — Authorization: Bearer header, fallback)
  const figmaToken = process.env['MCP_FIGMA_TOKEN'];
  const figmaUrl = process.env['MCP_FIGMA_URL'] ?? 'https://fm.wickedlab.io/api/mcp';
  if (figmaToken) {
    servers.push({
      name: 'figma-fm',
      endpoint: figmaUrl,
      headers: { Authorization: `Bearer ${figmaToken}` },
    });
  }

  // Playwright MCP sidecar (HTTP transport) for browser automation and screenshots.
  const playwrightUrl = process.env['MCP_PLAYWRIGHT_URL'] ?? 'http://playwright-mcp:8931/mcp';
  if (process.env['MCP_PLAYWRIGHT_ENABLED'] === '1') {
    servers.push({ name: 'playwright', endpoint: playwrightUrl });
  }

  return servers;
})();

// bcgpt loaded on-demand when prompt mentions Basecamp/projects
const BCGPT_SERVER: McpServerConfig | null = (() => {
  const key = process.env['MCP_BCGPT_KEY'];
  const url = process.env['MCP_BCGPT_URL'] ?? 'https://bcgpt.wickedlab.io/mcp';
  if (!key) return null;
  return { name: 'bcgpt-basecamp', endpoint: url, bodyAuthKey: { paramName: 'api_key', value: key } };
})();

// ── Config ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(DATA_DIR, 'config.toml');
const DB_PATH = join(DATA_DIR, 'designs.db');
const DESIGN_SYSTEMS_PATH = join(DATA_DIR, 'design-systems.json');
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

async function syncActiveDesignSystemToConfig(
  activeSnapshot: import('@open-codesign/shared').StoredDesignSystem | null,
): Promise<void> {
  const cfg = getCachedConfig();
  if (!cfg) return;
  const next = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(activeSnapshot ? { designSystem: activeSnapshot } : {}),
  });
  await saveConfig(next);
  setCachedConfig(next);
}

async function readDesignSystemsState(): Promise<DesignSystemsLibrary> {
  const library = await readDesignSystemsLibrary(DESIGN_SYSTEMS_PATH);
  const cfg = getCachedConfig();
  const seeded = ensureSeededLibrary(library, cfg?.designSystem ?? null);
  if (seeded.items.length !== library.items.length || seeded.activeId !== library.activeId) {
    await writeDesignSystemsLibrary(DESIGN_SYSTEMS_PATH, seeded);
    return seeded;
  }
  return library;
}

async function writeDesignSystemsState(library: DesignSystemsLibrary): Promise<void> {
  await writeDesignSystemsLibrary(DESIGN_SYSTEMS_PATH, library);
  await syncActiveDesignSystemToConfig(getActiveDesignSystem(library));
}

async function resolveDesignSystemForRequest(
  requestedId: string | null | undefined,
): Promise<import('@open-codesign/shared').StoredDesignSystem | null> {
  const library = await readDesignSystemsState();
  return findDesignSystemById(library, requestedId) ?? getActiveDesignSystem(library);
}

function serializeDesignSystemsState(library: DesignSystemsLibrary): {
  activeId: string | null;
  items: Array<{ id: string; name: string } & import('@open-codesign/shared').StoredDesignSystem>;
} {
  return {
    activeId: library.activeId,
    items: library.items.map((item) => ({
      id: item.id,
      name: item.name,
      ...item.snapshot,
    })),
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

const CHATGPT_CODEX_PROVIDER: ProviderEntry = {
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

function createGitHubCopilotProvider(baseUrl: string): ProviderEntry {
  return {
    id: GITHUB_COPILOT_PROVIDER_ID,
    name: 'GitHub Copilot',
    builtin: false,
    wire: 'openai-responses',
    baseUrl,
    defaultModel: 'gpt-5.4',
    requiresApiKey: false,
    httpHeaders: {
      ...COPILOT_VSCODE_HEADERS,
      'X-GitHub-Api-Version': '2026-01-09',
      'Openai-Intent': 'conversation-agent',
      'X-Initiator': 'user',
    },
    capabilities: {
      supportsKeyless: true,
      supportsModelsEndpoint: true,
      supportsResponsesApi: true,
      supportsReasoning: true,
      supportsToolCalling: true,
      requiresClaudeCodeIdentity: false,
      modelDiscoveryMode: 'models',
    },
  };
}

function getCodexTokenStore(): CodexTokenStore {
  if (!codexTokenStore) {
    codexTokenStore = new CodexTokenStore({ filePath: CODEX_AUTH_PATH });
  }
  return codexTokenStore;
}

function buildResolveActiveApiKeyDeps() {
  return {
    getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
    getCopilotAccessToken: () => getCopilotSessionToken(),
    getApiKeyForProvider,
  };
}

async function persistProviderMutation(
  mutate: (providers: Record<string, ProviderEntry>) => Record<string, ProviderEntry>,
): Promise<void> {
  const cfg = getCachedConfig();
  const prevProviders: Record<string, ProviderEntry> = cfg?.providers ?? {};
  const nextProviders = mutate({ ...prevProviders });
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg?.activeProvider ?? '',
    activeModel: cfg?.activeModel ?? '',
    secrets: cfg?.secrets ?? {},
    providers: nextProviders,
    ...(cfg?.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await saveConfig(next);
  setCachedConfig(next);
}

async function claimActiveCodexProviderIfUnset(): Promise<void> {
  const cfg = getCachedConfig();
  if (cfg === null) return;
  const current = cfg.activeProvider;
  const hasValidActive =
    current !== undefined &&
    current !== null &&
    current !== '' &&
    cfg.providers[current] !== undefined;
  if (hasValidActive) return;
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: CHATGPT_CODEX_PROVIDER_ID,
    activeModel: CHATGPT_CODEX_PROVIDER.defaultModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await saveConfig(next);
  setCachedConfig(next);
}

async function ensureCodexProviderFromStoredAuth(): Promise<StoredCodexAuth | null> {
  let stored: StoredCodexAuth | null;
  try {
    stored = await getCodexTokenStore().read();
  } catch {
    return null;
  }
  if (stored === null) return null;

  const cfg = getCachedConfig();
  const entry = cfg?.providers[CHATGPT_CODEX_PROVIDER_ID];
  const needsWrite =
    entry === undefined ||
    entry.wire !== CHATGPT_CODEX_PROVIDER.wire ||
    entry.baseUrl !== CHATGPT_CODEX_PROVIDER.baseUrl;

  if (needsWrite) {
    await persistProviderMutation((providers) => {
      providers[CHATGPT_CODEX_PROVIDER_ID] = { ...CHATGPT_CODEX_PROVIDER };
      return providers;
    });
  }
  await claimActiveCodexProviderIfUnset();
  return stored;
}

async function claimActiveProviderIfUnset(
  providerId: string,
  defaultModel: string,
): Promise<void> {
  const cfg = getCachedConfig();
  if (cfg === null) return;
  const current = cfg.activeProvider;
  const hasValidActive =
    current !== undefined &&
    current !== null &&
    current !== '' &&
    cfg.providers[current] !== undefined;
  if (hasValidActive) return;
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: providerId,
    activeModel: defaultModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await saveConfig(next);
  setCachedConfig(next);
}

async function ensureCopilotProviderFromStoredAuth() {
  const stored = await readStoredCopilotAuth();
  if (stored === null) return null;

  const provider = createGitHubCopilotProvider(stored.baseUrl);
  const cfg = getCachedConfig();
  const entry = cfg?.providers[GITHUB_COPILOT_PROVIDER_ID];
  // Only write the default provider config if there is no existing entry.
  // If the entry has been manually configured (e.g. pointing at a local proxy),
  // preserve it so restarts don't clobber the stored settings.
  const needsWrite = entry === undefined;

  if (needsWrite) {
    await persistProviderMutation((providers) => {
      providers[GITHUB_COPILOT_PROVIDER_ID] = provider;
      return providers;
    });
  }
  await claimActiveProviderIfUnset(provider.id, provider.defaultModel);
  return { ...stored, provider };
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

interface WebExportRequest {
  format: ExporterFormat;
  htmlContent: string;
  defaultFilename?: string;
}

const EXPORT_CONTENT_TYPES: Record<ExporterFormat, string> = {
  html: 'text/html; charset=utf-8',
  mp4: 'video/mp4',
  markdown: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

function parseWebExportRequest(raw: unknown): WebExportRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('export expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const record = raw as Record<string, unknown>;
  const format = record['format'];
  const htmlContent = record['htmlContent'];
  const defaultFilename = record['defaultFilename'];
  if (
    format !== 'html' &&
    format !== 'mp4' &&
    format !== 'pdf' &&
    format !== 'pptx' &&
    format !== 'zip' &&
    format !== 'markdown'
  ) {
    throw new CodesignError(
      `Unknown export format: ${String(format)}`,
      ERROR_CODES.EXPORTER_UNKNOWN,
    );
  }
  if (typeof htmlContent !== 'string' || htmlContent.trim().length === 0) {
    throw new CodesignError('export requires non-empty htmlContent', ERROR_CODES.IPC_BAD_INPUT);
  }

  const out: WebExportRequest = { format, htmlContent };
  if (typeof defaultFilename === 'string' && defaultFilename.trim().length > 0) {
    out.defaultFilename = defaultFilename.trim();
  }
  return out;
}

function sanitizeExportFilename(input: string | undefined, format: ExporterFormat): string {
  const defaultExt = format === 'markdown' ? 'md' : format;
  const fallback = `codesign-export.${defaultExt}`;
  if (!input) return fallback;
  const candidate = input
    .replace(/[/\\]/g, '-')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '-')
    .trim();
  return candidate.length > 0 ? candidate : fallback;
}

function encodeContentDispositionFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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

function resolveDiscoveryHintModels(entry: ProviderEntry): string[] {
  return [...(entry.modelsHint ?? []), ...(entry.defaultModel ? [entry.defaultModel] : [])].filter(
    (value, index, arr) => value && arr.indexOf(value) === index,
  );
}

function extractModelIds(body: unknown): string[] | null {
  if (body === null || typeof body !== 'object') return null;

  const candidates = (body as { data?: unknown }).data ?? (body as { models?: unknown }).models;
  if (!Array.isArray(candidates)) return null;

  const ids: string[] = [];
  for (const item of candidates) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as { id?: unknown; name?: unknown };
    if (typeof record.id === 'string') {
      ids.push(record.id);
      continue;
    }
    if (typeof record.name === 'string') {
      ids.push(record.name);
      continue;
    }
    return null;
  }

  return ids;
}

function trimTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function modelsUrlForStoredProvider(providerId: string, entry: ProviderEntry): string {
  if (providerId === GITHUB_COPILOT_PROVIDER_ID) {
    return `${trimTrailingSlashes(entry.baseUrl)}/models`;
  }
  return modelsEndpointUrl(entry.baseUrl, entry.wire);
}

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
    const rows = Object.values(cfg.providers).map((p) => {
      const secret = cfg.secrets[p.id];
      return {
        provider: p.id,
        maskedKey: secret?.mask ?? '',
        baseUrl: p.baseUrl ?? null,
        isActive: p.id === cfg.activeProvider,
        label: p.name,
        name: p.name,
        builtin: p.builtin,
        wire: p.wire,
        defaultModel: p.defaultModel,
        hasKey: secret !== undefined || p.requiresApiKey === false,
        ...(p.reasoningLevel ? { reasoningLevel: p.reasoningLevel } : {}),
      };
    });
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

async function testStoredProvider(
  providerId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string; hint: string }> {
  const cfg = getCachedConfig();
  if (!cfg) {
    return {
      ok: false,
      code: ERROR_CODES.CONFIG_MISSING,
      message: 'No configuration loaded',
      hint: 'Complete onboarding first.',
    };
  }
  const entry = cfg.providers[providerId];
  if (!entry) {
    return {
      ok: false,
      code: ERROR_CODES.IPC_NOT_FOUND,
      message: `Provider "${providerId}" not found`,
      hint: 'Refresh settings and try again.',
    };
  }
  if (!entry.baseUrl) {
    return {
      ok: false,
      code: ERROR_CODES.PROVIDER_BASE_URL_MISSING,
      message: `Provider "${providerId}" is missing a base URL`,
      hint: 'Open provider settings and add a base URL.',
    };
  }

  const apiKey = await resolveApiKeyWithKeylessFallback(
    providerId,
    entry.requiresApiKey === false,
    buildResolveActiveApiKeyDeps(),
  );

  let url: string;
  try {
    url = modelsUrlForStoredProvider(providerId, entry);
  } catch (err) {
    return {
      ok: false,
      code: 'URL',
      message: err instanceof Error ? err.message : String(err),
      hint: 'Check the provider base URL and wire.',
    };
  }

  try {
    const headers = buildAuthHeadersForWire(entry.wire, apiKey, entry.httpHeaders, entry.baseUrl);
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        code: String(response.status),
        message: `HTTP ${response.status}`,
        hint: 'Verify your key, billing, and endpoint configuration.',
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK',
      message: err instanceof Error ? err.message : String(err),
      hint: 'Check that the endpoint is reachable from the server.',
    };
  }
}

app.get('/api/models/provider/:id', async (req, res) => {
  try {
    if (req.params.id === GITHUB_COPILOT_PROVIDER_ID) {
      await ensureCopilotProviderFromStoredAuth();
    }
    const cfg = getCachedConfig();
    if (!cfg) return res.json({ ok: true, models: [] });
    const entry = cfg.providers[req.params.id];
    if (!entry) return res.json({ ok: true, models: [] });
    const hinted = resolveDiscoveryHintModels(entry);
    if (entry.modelsHint !== undefined && entry.modelsHint.length > 0) {
      return res.json({ ok: true, models: hinted });
    }

    const apiKey = await resolveApiKeyWithKeylessFallback(
      req.params.id,
      entry.requiresApiKey === false,
      buildResolveActiveApiKeyDeps(),
    );

    let url: string;
    try {
      url = modelsUrlForStoredProvider(req.params.id, entry);
    } catch (err) {
      return hinted.length > 0
        ? res.json({ ok: true, models: hinted })
        : res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    const headers = buildAuthHeadersForWire(entry.wire, apiKey, entry.httpHeaders, entry.baseUrl);
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return hinted.length > 0
        ? res.json({ ok: true, models: hinted })
        : res.json({ ok: false, error: `HTTP ${response.status}` });
    }

    const ids = extractModelIds(await response.json());
    if (ids === null) {
      return hinted.length > 0
        ? res.json({ ok: true, models: hinted })
        : res.json({ ok: false, error: 'unexpected response shape' });
    }

    return res.json({
      ok: true,
      models: [...ids, ...hinted].filter((value, index, arr) => arr.indexOf(value) === index),
    });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/connection/test-active', async (_req, res) => {
  try {
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    res.json(await testStoredProvider(cfg.activeProvider));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/connection/test-provider/:id', async (req, res) => {
  try {
    res.json(await testStoredProvider(req.params.id));
  } catch (err) {
    handleError(res, err);
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

const GITHUB_COPILOT_GENERATE_FALLBACK_MODELS = ['gpt-4o', 'gpt-4.1'] as const;

function shouldRetryHostedGenerationWithFallback(
  model: { provider: string; modelId: string },
  message: string,
): boolean {
  if (model.provider !== GITHUB_COPILOT_PROVIDER_ID) return false;
  return /no quota|not accessible via the \/chat\/completions endpoint|image media type not supported/i.test(
    message,
  );
}

function getHostedGenerationFallbackModelIds(model: { provider: string; modelId: string }): string[] {
  if (model.provider !== GITHUB_COPILOT_PROVIDER_ID) return [];
  return GITHUB_COPILOT_GENERATE_FALLBACK_MODELS.filter((candidate) => candidate !== model.modelId);
}

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

  const modelHint = payload.model ?? { provider: cfg.activeProvider, modelId: cfg.activeModel };
  const active = resolveActiveModel(cfg, modelHint);
  const allowKeyless = active.allowKeyless;
  let apiKey: string;
  try {
    apiKey = await resolveApiKeyWithKeylessFallback(active.model.provider, allowKeyless, {
      ...buildResolveActiveApiKeyDeps(),
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
  const figmaPrefetch = await buildPrefetchedFigmaPromptContext(payload.prompt, payload.referenceUrl);
  const hasFigmaContext = extractFigmaFileUrls(`${payload.prompt}\n${payload.referenceUrl ?? ''}`).length > 0;
  const browserPrefetch = await buildPrefetchedBrowserPromptContext(
    figmaPrefetch.prompt,
    // Skip browser prefetch for Figma URLs — they're handled above
    extractFigmaFileUrls(payload.referenceUrl ?? '').length > 0 ? undefined : payload.referenceUrl,
  );
  const steeredPrompt = applyPlaywrightPromptSteering(browserPrefetch.prompt, { hasFigmaContext });
  const baseMcpServers = browserPrefetch.toolServers ?? figmaPrefetch.toolServers ?? MCP_SERVERS;
  // Load bcgpt on-demand only when the prompt explicitly mentions Basecamp/projects
  const selectedMcpServers =
    BCGPT_INTENT_RE.test(steeredPrompt) && BCGPT_SERVER !== null
      ? [...baseMcpServers, BCGPT_SERVER]
      : baseMcpServers;

  const { fs, fsMap } = createRuntimeTextEditorFs({
    db,
    dataDir: DATA_DIR,
    designId,
    generationId: id,
    previousHtml,
    sendEvent,
    logger: coreLogger,
  });

  const resolvedDesignSystem =
    (await resolveDesignSystemForRequest((payload as { designSystemId?: string }).designSystemId)) ??
    figmaPrefetch.designSystem;
  const workspaceContext = buildHostedWorkspaceContext(db, designId);
  const projectInstructions =
    designId !== null ? getDesign(db, designId)?.projectInstructions ?? null : null;

  const generateInputBase = {
    prompt: steeredPrompt,
    history: payload.history as never,
    attachments: payload.attachments as never,
    referenceUrl: payload.referenceUrl ? { url: payload.referenceUrl } : undefined,
    designSystem: resolvedDesignSystem,
    ...(projectInstructions ? { projectInstructions: { instructions: projectInstructions } } : {}),
    workspaceContext,
    signal: controller.signal,
    logger: coreLogger,
  };
  const promptImages =
    figmaPrefetch.figmaImages.length > 0
      ? (figmaPrefetch.figmaImages as import('@mariozechner/pi-ai').ImageContent[])
      : undefined;

  const buildGenerateInput = (
    resolved: ReturnType<typeof resolveActiveModel>,
    currentApiKey: string,
  ) => {
    const currentAllowKeyless = resolved.allowKeyless;
    const currentIsCodex = resolved.model.provider === CHATGPT_CODEX_PROVIDER_ID;
    const currentBaseUrl = resolved.baseUrl ?? undefined;
    return {
      ...generateInputBase,
      model: resolved.model,
      apiKey: currentApiKey,
      ...(currentIsCodex
        ? {
            getApiKey: () =>
              resolveApiKeyWithKeylessFallback(resolved.model.provider, currentAllowKeyless, {
                ...buildResolveActiveApiKeyDeps(),
              }),
          }
        : {}),
      ...(currentBaseUrl !== undefined ? { baseUrl: currentBaseUrl } : {}),
      wire: resolved.wire,
      ...(resolved.httpHeaders !== undefined ? { httpHeaders: resolved.httpHeaders } : {}),
      explicitCapabilities: resolved.explicitCapabilities,
      ...(currentAllowKeyless ? { allowKeyless: true as const } : {}),
      capabilities: resolved.capabilities,
    };
  };

  const runHostedGeneration = async (
    resolved: ReturnType<typeof resolveActiveModel>,
    currentApiKey: string,
  ) => {
    const input = buildGenerateInput(resolved, currentApiKey);
    if (!USE_AGENT_RUNTIME) {
      return generate(input);
    }

    const runtimeVerify = makeRuntimeVerifier();
    const loadedMcpTools = await loadMcpTools(selectedMcpServers);
    const mcpTools = filterMcpToolsForPrompt(steeredPrompt, loadedMcpTools);
    return generateViaAgent(input, {
      fs,
      runtimeVerify,
      extraTools: mcpTools,
      ...(promptImages !== undefined ? { promptImages } : {}),
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

    try {
      result = await runHostedGeneration(active, apiKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!shouldRetryHostedGenerationWithFallback(active.model, message)) {
        throw err;
      }

      let recovered = false;
      let lastError: unknown = err;
      for (const fallbackModelId of getHostedGenerationFallbackModelIds(active.model)) {
        try {
          const fallbackActive = resolveActiveModel(cfg, {
            provider: active.model.provider,
            modelId: fallbackModelId,
          });
          const fallbackApiKey = await resolveApiKeyWithKeylessFallback(
            fallbackActive.model.provider,
            fallbackActive.allowKeyless,
            {
              ...buildResolveActiveApiKeyDeps(),
            },
          );
          coreLogger.warn('generate_retry_model_fallback', {
            fromModel: active.model.modelId,
            toModel: fallbackModelId,
            reason: message,
          });
          result = await runHostedGeneration(fallbackActive, fallbackApiKey);
          recovered = true;
          break;
        } catch (fallbackErr) {
          lastError = fallbackErr;
        }
      }

      if (!recovered) {
        throw lastError;
      }
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
      buildResolveActiveApiKeyDeps(),
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

app.post('/api/clarify-prompt', async (req, res) => {
  try {
    const payload = req.body as {
      prompt: string;
      attachments?: unknown[];
      referenceUrl?: string;
      designId?: string;
      designSystemId?: string;
    };
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const active = resolveActiveModel(cfg, {
      provider: cfg.activeProvider,
      modelId: cfg.activeModel,
    });
    const apiKey = await resolveApiKeyWithKeylessFallback(
      active.model.provider,
      active.allowKeyless,
      buildResolveActiveApiKeyDeps(),
    );
    const resolvedDesignSystem = await resolveDesignSystemForRequest(payload.designSystemId);
    const db = getDb();
    const workspaceContext = buildHostedWorkspaceContext(db, payload.designId);
    const projectInstructions = payload.designId
      ? getDesign(db, payload.designId)?.projectInstructions ?? null
      : null;
    const result = await clarifyPrompt({
      prompt: payload.prompt,
      model: active.model,
      apiKey,
      ...(active.baseUrl ? { baseUrl: active.baseUrl } : {}),
      wire: active.wire,
      ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
      capabilities: active.capabilities,
      explicitCapabilities: active.explicitCapabilities,
      ...(active.allowKeyless ? { allowKeyless: true as const } : {}),
      attachments: payload.attachments as never,
      referenceUrl: payload.referenceUrl ? { url: payload.referenceUrl } : undefined,
      designSystem: resolvedDesignSystem,
      ...(projectInstructions ? { projectInstructions: { instructions: projectInstructions } } : {}),
      workspaceContext,
    });
    res.json(result);
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
      designSystemId?: string;
      referenceUrl?: string;
      designId?: string;
      model?: { provider: string; modelId: string };
    };
    const cfg = getCachedConfig();
    if (!cfg) return sendError(res, 503, 'No config', ERROR_CODES.CONFIG_MISSING);
    const hint = payload.model ?? { provider: cfg.activeProvider, modelId: cfg.activeModel };
    const active = resolveActiveModel(cfg, hint as never);
    const apiKey = await resolveApiKeyWithKeylessFallback(
      active.model.provider,
      active.allowKeyless,
      buildResolveActiveApiKeyDeps(),
    );
    const resolvedDesignSystem = await resolveDesignSystemForRequest(payload.designSystemId);
    const db = getDb();
    const workspaceContext = buildHostedWorkspaceContext(db, payload.designId);
    const projectInstructions = payload.designId
      ? getDesign(db, payload.designId)?.projectInstructions ?? null
      : null;
    const result = await applyComment({
      html: payload.html,
      comment: payload.comment,
      selection: payload.selection as never,
      model: active.model,
      apiKey,
      attachments: payload.attachments as never,
      referenceUrl: payload.referenceUrl ? { url: payload.referenceUrl } : undefined,
      designSystem: resolvedDesignSystem,
      ...(projectInstructions ? { projectInstructions: { instructions: projectInstructions } } : {}),
      workspaceContext,
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

app.patch('/api/designs/:id/project-instructions', (req, res) => {
  try {
    const designId = req.params.id;
    const rawInstructions = (req.body as { projectInstructions?: unknown }).projectInstructions;
    const projectInstructions =
      typeof rawInstructions === 'string' ? rawInstructions.trim() : '';
    const updated = updateDesignProjectInstructions(
      getDb(),
      designId,
      projectInstructions.length > 0 ? projectInstructions : null,
    );
    if (!updated) return sendError(res, 404, 'Design not found', 'not_found');
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/rename', (req, res) => {
  try {
    const { name } = req.body as { name: string };
    renameDesign(getDb(), req.params.id, name);
    res.json(getDesign(getDb(), req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/thumbnail', (req, res) => {
  try {
    const { thumbnail } = req.body as { thumbnail: string };
    setDesignThumbnail(getDb(), req.params.id, thumbnail);
    res.json(getDesign(getDb(), req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/designs/:id', (req, res) => {
  try {
    softDeleteDesign(getDb(), req.params.id);
    res.json(getDesign(getDb(), req.params.id));
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

app.get('/api/designs/:id/files', (req, res) => {
  try {
    const designId = req.params.id;
    const design = getDesign(getDb(), designId);
    if (!design) return sendError(res, 404, 'Design not found', 'not_found');
    res.json(listDesignFiles(getDb(), designId));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/designs/:id/files/view', (req, res) => {
  try {
    const designId = req.params.id;
    const design = getDesign(getDb(), designId);
    if (!design) return sendError(res, 404, 'Design not found', 'not_found');
    const pathValue = Array.isArray(req.query['path']) ? req.query['path'][0] : req.query['path'];
    if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
      return sendError(res, 400, 'path is required', 'bad_request');
    }
    const file = viewDesignFile(getDb(), designId, normalizeDesignFilePath(pathValue.trim()));
    if (!file) return sendError(res, 404, 'File not found', 'not_found');
    res.json(file);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/workspace', upload.array('files'), async (req, res) => {
  try {
    const designIdParam = req.params.id;
    const designId = Array.isArray(designIdParam) ? designIdParam[0] : designIdParam;
    if (typeof designId !== 'string' || designId.trim().length === 0) {
      return sendError(res, 400, 'Design id is required', 'bad_request');
    }
    const design = getDesign(getDb(), designId);
    if (!design) return sendError(res, 404, 'Design not found', 'not_found');

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      return sendError(res, 400, 'No workspace files uploaded', 'workspace_missing_files');
    }

    const workspaceRoot = getHostedWorkspaceDiskPath(DATA_DIR, designId);
    const codebaseRoot = join(workspaceRoot, 'codebase');
    await rm(codebaseRoot, { recursive: true, force: true });
    deleteDesignFilesByPrefix(getDb(), designId, 'codebase/');

    let storedCount = 0;
    for (const file of files) {
      const normalizedRelativePath = normalizeUploadedWorkspacePath(file.originalname);
      if (!normalizedRelativePath) continue;

      const storedPath = `codebase/${normalizedRelativePath}`;
      const destinationPath = join(workspaceRoot, storedPath);
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, file.buffer);

      if (isTextWorkspaceFile(storedPath, file.mimetype)) {
        upsertDesignFile(getDb(), designId, storedPath, file.buffer.toString('utf8'));
      }
      storedCount += 1;
    }

    if (storedCount === 0) {
      return sendError(res, 400, 'Uploaded workspace contained no valid files', 'workspace_empty');
    }

    const workspaceLabelRaw = req.body['workspaceLabel'];
    const updated = updateDesignWorkspace(
      getDb(),
      designId,
      normalizeHostedWorkspaceLabel(
        Array.isArray(workspaceLabelRaw) ? workspaceLabelRaw[0] : workspaceLabelRaw,
      ),
    );
    if (!updated) return sendError(res, 404, 'Design not found', 'not_found');
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/designs/:id/workspace', async (req, res) => {
  try {
    const designId = req.params.id;
    const design = getDesign(getDb(), designId);
    if (!design) return sendError(res, 404, 'Design not found', 'not_found');

    await rm(join(getHostedWorkspaceDiskPath(DATA_DIR, designId), 'codebase'), {
      recursive: true,
      force: true,
    });
    deleteDesignFilesByPrefix(getDb(), designId, 'codebase/');
    const updated = clearDesignWorkspace(getDb(), designId);
    if (!updated) return sendError(res, 404, 'Design not found', 'not_found');
    res.json(updated);
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

// ── Chat ─────────────────────────────────────────────────────────────────────

app.get('/api/designs/:id/chat', (req, res) => {
  try {
    res.json(listChatMessages(getDb(), req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/chat/seed-from-snapshots', (req, res) => {
  try {
    const inserted = seedChatFromSnapshots(getDb(), req.params.id);
    res.json({ inserted });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/chat', (req, res) => {
  try {
    const row = appendChatMessage(getDb(), {
      designId: req.params.id,
      kind: req.body.kind,
      payload: req.body.payload,
      snapshotId: req.body.snapshotId ?? null,
    });
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/chat/:seq/tool-status', (req, res) => {
  try {
    updateChatToolCallStatus(
      getDb(),
      req.params.id,
      Number.parseInt(req.params.seq, 10),
      req.body.status,
      req.body.errorMessage,
    );
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Comments ─────────────────────────────────────────────────────────────────

app.get('/api/designs/:id/comments', (req, res) => {
  try {
    const snapshotId =
      typeof req.query['snapshotId'] === 'string' ? String(req.query['snapshotId']) : undefined;
    res.json(listComments(getDb(), req.params.id, snapshotId));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/designs/:id/comments/pending-edits', (req, res) => {
  try {
    res.json(listPendingEdits(getDb(), req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/designs/:id/comments', (req, res) => {
  try {
    const row = createComment(getDb(), {
      designId: req.params.id,
      snapshotId: req.body.snapshotId,
      kind: req.body.kind,
      selector: req.body.selector,
      tag: req.body.tag,
      outerHTML: req.body.outerHTML,
      rect: req.body.rect,
      text: req.body.text,
      ...(req.body.scope ? { scope: req.body.scope } : {}),
      ...(req.body.parentOuterHTML ? { parentOuterHTML: req.body.parentOuterHTML } : {}),
    });
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/comments/:id', (req, res) => {
  try {
    const updated = updateComment(getDb(), req.params.id, {
      ...(req.body.text !== undefined ? { text: req.body.text } : {}),
      ...(req.body.status !== undefined ? { status: req.body.status } : {}),
      ...(req.body.scope !== undefined ? { scope: req.body.scope } : {}),
    });
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/comments/:id', (req, res) => {
  try {
    res.json({ removed: deleteComment(getDb(), req.params.id) });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/comments/mark-applied', (req, res) => {
  try {
    res.json(markCommentsApplied(getDb(), req.body.ids ?? [], req.body.snapshotId));
  } catch (err) {
    handleError(res, err);
  }
});

// ── File upload (replaces file dialogs) ───────────────────────────────────────

app.post('/api/upload-files', upload.array('files'), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const result = await Promise.all(
      files.map(async (f) => {
        const parsed = await parseOfficeDocument(f.originalname, f.mimetype, f.buffer);
        return {
          name: f.originalname,
          size: f.size,
          mimeType: f.mimetype,
          dataUrl: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`,
          ...(parsed.parsed
            ? { extractedText: parsed.text, documentKind: parsed.kind }
            : {}),
        };
      }),
    );
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/export', async (req, res) => {
  let stagingDir: string | null = null;
  try {
    const request = parseWebExportRequest(req.body);
    const filename = sanitizeExportFilename(request.defaultFilename, request.format);
    stagingDir = await mkdtemp(join(tmpdir(), 'codesign-export-'));
    const destinationPath = join(stagingDir, filename);
    await exportArtifact(request.format, request.htmlContent, destinationPath);
    const bytes = await readFile(destinationPath);
    res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[request.format]);
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader('Content-Disposition', encodeContentDispositionFilename(filename));
    res.status(200).send(bytes);
  } catch (err) {
    handleError(res, err);
  } finally {
    if (stagingDir) {
      await rm(stagingDir, { recursive: true, force: true });
    }
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
    const auth = await ensureCodexProviderFromStoredAuth();
    if (!auth) {
      res.json({ loggedIn: false, email: null, accountId: null, expiresAt: null });
    } else {
      res.json({
        loggedIn: true,
        email: auth.email,
        accountId: auth.accountId,
        expiresAt: auth.expiresAt,
      });
    }
  } catch {
    res.json({ loggedIn: false, email: null, accountId: null, expiresAt: null });
  }
});

app.post('/api/codex/adopt-existing-auth', async (_req, res) => {
  try {
    const auth = await ensureCodexProviderFromStoredAuth();
    if (!auth) {
      return sendError(
        res,
        404,
        `No Codex auth found at ${CODEX_AUTH_PATH}. Log in with Codex CLI first.`,
        ERROR_CODES.CODEX_TOKEN_NOT_LOGGED_IN,
      );
    }
    res.json({
      loggedIn: true,
      email: auth.email,
      accountId: auth.accountId,
      expiresAt: auth.expiresAt,
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/codex/start-login', (req, res) => {
  try {
    const pkce = generatePkce();
    const state = randomUUID();
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const host = req.headers.host;
    const redirectUri = `${proto}://${host}/api/codex/callback`;
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
      const next = hydrateConfig({
        version: 3,
        activeProvider: cfg.activeProvider || CHATGPT_CODEX_PROVIDER_ID,
        activeModel: cfg.activeModel || 'gpt-5.3-codex',
        secrets: cfg.secrets,
        providers: { ...cfg.providers, [CHATGPT_CODEX_PROVIDER_ID]: CHATGPT_CODEX_PROVIDER },
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

app.get('/api/copilot/status', async (_req, res) => {
  try {
    const auth = await ensureCopilotProviderFromStoredAuth();
    if (!auth) {
      res.json({ loggedIn: false, login: null, host: null, expiresAt: null });
    } else {
      res.json({
        loggedIn: true,
        login: auth.login,
        host: auth.host,
        expiresAt: null,
      });
    }
  } catch {
    res.json({ loggedIn: false, login: null, host: null, expiresAt: null });
  }
});

app.post('/api/copilot/adopt-existing-auth', async (_req, res) => {
  try {
    const auth = await ensureCopilotProviderFromStoredAuth();
    if (!auth) {
      return sendError(
        res,
        404,
        `No GitHub Copilot auth found in ${COPILOT_CONFIG_DIR}. Run \`copilot login\` first.`,
        ERROR_CODES.PROVIDER_AUTH_MISSING,
      );
    }
    res.json({
      loggedIn: true,
      login: auth.login,
      host: auth.host,
      expiresAt: null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/copilot/logout', async (_req, res) => {
  try {
    await clearStoredCopilotAuth();
    const cfg = getCachedConfig();
    if (cfg) {
      const { [GITHUB_COPILOT_PROVIDER_ID]: _removed, ...providers } = cfg.providers;
      const { [GITHUB_COPILOT_PROVIDER_ID]: _removedS, ...secrets } = cfg.secrets;
      const wasActive = cfg.activeProvider === GITHUB_COPILOT_PROVIDER_ID;
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
    const library = await readDesignSystemsState();
    const nextLibrary = addDesignSystem(
      library,
      createDesignSystemRecord({ snapshot }),
      true,
    );
    await writeDesignSystemsState(nextLibrary);
    res.json(serializeDesignSystemsState(nextLibrary));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/design-system', async (_req, res) => {
  try {
    const library = await readDesignSystemsState();
    const nextLibrary = library.activeId ? removeDesignSystem(library, library.activeId) : library;
    await writeDesignSystemsState(nextLibrary);
    res.json(toState(cachedConfig));
  } catch (err) {
    handleError(res, err);
  }
});

async function persistDesignSystem(
  snapshot: import('@open-codesign/shared').StoredDesignSystem,
  name?: string,
) {
  const library = await readDesignSystemsState();
  const nextLibrary = addDesignSystem(
    library,
    createDesignSystemRecord({ snapshot, ...(name ? { name } : {}) }),
    true,
  );
  await writeDesignSystemsState(nextLibrary);
  return nextLibrary;
}

app.post('/api/design-system/scan-github', async (req, res) => {
  try {
    const { repoUrl, name } = req.body as { repoUrl?: string; name?: string };
    if (typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
      return sendError(res, 400, 'repoUrl is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const snapshot = await importDesignSystemFromGithub(repoUrl);
    res.json(serializeDesignSystemsState(await persistDesignSystem(snapshot, name)));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/design-system/scan-figma', async (req, res) => {
  try {
    const { figmaUrl, name } = req.body as { figmaUrl?: string; name?: string };
    if (typeof figmaUrl !== 'string' || figmaUrl.trim().length === 0) {
      return sendError(res, 400, 'figmaUrl is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const snapshot = await importDesignSystemFromFigma(figmaUrl);
    res.json(serializeDesignSystemsState(await persistDesignSystem(snapshot, name)));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/design-system/manual', async (req, res) => {
  try {
    const body = req.body as Parameters<typeof importDesignSystemFromManual>[0];
    const snapshot = importDesignSystemFromManual(body ?? {});
    res.json(serializeDesignSystemsState(await persistDesignSystem(snapshot, body?.name)));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/design-system', async (_req, res) => {
  try {
    const library = await readDesignSystemsState();
    res.json({ designSystem: getActiveDesignSystem(library) });
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/design-systems', async (_req, res) => {
  try {
    res.json(serializeDesignSystemsState(await readDesignSystemsState()));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/design-systems/activate', async (req, res) => {
  try {
    const { id } = req.body as { id?: string };
    if (typeof id !== 'string' || id.trim().length === 0) {
      return sendError(res, 400, 'id is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const library = await readDesignSystemsState();
    const nextLibrary = activateDesignSystem(library, id.trim());
    await writeDesignSystemsState(nextLibrary);
    res.json(serializeDesignSystemsState(nextLibrary));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/design-systems/:id', async (req, res) => {
  try {
    const id = req.params['id'];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return sendError(res, 400, 'id is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const library = await readDesignSystemsState();
    const nextLibrary = removeDesignSystem(library, id.trim());
    await writeDesignSystemsState(nextLibrary);
    res.json(serializeDesignSystemsState(nextLibrary));
  } catch (err) {
    handleError(res, err);
  }
});

// ── Folder management ─────────────────────────────────────────────────────────

app.get('/api/folders', (req, res) => {
  try {
    const folders = listFolders(getDb());
    res.json({ folders });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/folders', (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (typeof name !== 'string' || name.trim().length === 0) {
      return sendError(res, 400, 'name is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const folder = createFolder(getDb(), name.trim());
    res.json({ folder });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/folders/:id', (req, res) => {
  try {
    const id = req.params['id'];
    const { name } = req.body as { name?: string };
    if (typeof name !== 'string' || name.trim().length === 0) {
      return sendError(res, 400, 'name is required', ERROR_CODES.IPC_BAD_INPUT);
    }
    const ok = renameFolder(getDb(), id, name.trim());
    if (!ok) return sendError(res, 404, 'Folder not found', ERROR_CODES.IPC_BAD_INPUT);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/folders/:id', (req, res) => {
  try {
    const id = req.params['id'];
    deleteFolder(getDb(), id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/designs/:id/folder', (req, res) => {
  try {
    const designId = req.params['id'];
    const { folderId } = req.body as { folderId?: string | null };
    moveDesignToFolder(getDb(), designId, folderId ?? null);
    res.json({ ok: true });
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

const FIGMA_FILE_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\/[A-Za-z0-9]+[^\s)\]"']*/gi;
const FIGMA_PROMPT_PREFIX = [
  'Figma design context is preloaded below from the official Figma source.',
  'Use that structured Figma data and attached frame image as the source of truth for layout, copy, and styling.',
  'Do not open the Figma URL with browser tools or generic URL-reading tools.',
  'Recreate the same section order, headline hierarchy, CTA placement, logo treatment, trust band, and visual composition before making responsive adjustments.',
  'Do not replace concrete frame imagery or layout with a generic hero scene, abstract gradient, or a new marketing concept.',
].join(' ');
const FIGMA_PREFETCH_CHAR_LIMIT = 1_600;
const HTTP_URL_RE = /https?:\/\/[^\s)\]"']+/gi;
const PLAYWRIGHT_INTENT_RE = /\b(playwright|browser|snapshot|screenshot)\b/i;
const WEBPAGE_REVIEW_INTENT_RE =
  /\b(inspect|review|audit|compare|check|test|verify|validate|crawl|qa)\b/i;
const PLAYWRIGHT_PROMPT_PREFIX = [
  'When inspecting a web page, do not use generic URL-reading tools.',
  'Use the Playwright MCP browser_navigate tool first, then browser_snapshot or browser_take_screenshot.',
].join(' ');
const PLAYWRIGHT_SNAPSHOT_PREFIX = [
  'Live webpage inspection context is preloaded below from the Playwright MCP.',
  'Use that browser snapshot as the source of truth for webpage structure and visible content.',
  'Do not claim that Playwright tools are unavailable when this preloaded inspection context is present.',
  'Do not re-fetch the same webpage with generic URL-reading tools.',
].join(' ');
const PLAYWRIGHT_TOOL_NAMES = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_take_screenshot',
]);
const PLAYWRIGHT_PREFETCH_CHAR_LIMIT = 12_000;

function extractFigmaFileUrls(input: string): string[] {
  return [...new Set(input.match(FIGMA_FILE_URL_RE) ?? [])];
}

function stringifyMcpText(result: McpToolCallResult): string {
  const text = (result.content ?? [])
    .filter((item): item is { type: string; text: string } => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter((item) => item.length > 0)
    .join('\n\n');

  if (text.length > 0) return text;
  return JSON.stringify(result);
}

function truncateForPrompt(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[truncated ${input.length - maxChars} chars]`;
}

function extractHttpUrls(input: string): string[] {
  return [...new Set(input.match(HTTP_URL_RE) ?? [])];
}

function extractPlayableUrl(prompt: string, referenceUrl?: string): string | undefined {
  return (
    referenceUrl ??
    extractHttpUrls(prompt).find((candidate) => !/https?:\/\/(?:www\.)?figma\.com\//i.test(candidate))
  );
}

function shouldPrefetchBrowserContext(prompt: string, referenceUrl?: string): boolean {
  if (referenceUrl !== undefined && referenceUrl.trim().length > 0) return true;

  const playableUrl = extractPlayableUrl(prompt);
  if (playableUrl === undefined) return false;

  return PLAYWRIGHT_INTENT_RE.test(prompt) || WEBPAGE_REVIEW_INTENT_RE.test(prompt);
}

/** Extract file key and optional node-id from a figma.com/design URL */
function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } | null {
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const fileKey = m[1];
  const nodeParam = new URL(url).searchParams.get('node-id');
  // Figma URLs use "-" in node-id param; API /nodes endpoint also wants "-" (not ":")
  const nodeId = nodeParam ?? null;
  return { fileKey, nodeId };
}

// ── Figma types ──────────────────────────────────────────────────────────────

interface FigmaColor { r: number; g: number; b: number; a?: number }
interface FigmaFill {
  type: string;
  color?: FigmaColor;
  imageRef?: string;
  gradientStops?: Array<{ color: FigmaColor; position: number }>;
}
interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textCase?: string;
}
interface FigmaPadding {
  paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
}
interface FigmaLayoutGrid { pattern?: string; sectionSize?: number; count?: number; gutterSize?: number }
interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  fills?: FigmaFill[];
  strokes?: FigmaFill[];
  backgroundColor?: FigmaColor;
  style?: FigmaTypeStyle;
  cornerRadius?: number;
  itemSpacing?: number;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  layoutGrids?: FigmaLayoutGrid[];
  children?: FigmaNode[];
  effects?: Array<{ type: string; color?: FigmaColor; radius?: number; offset?: { x: number; y: number } }>;
  opacity?: number;
  visible?: boolean;
}

function figmaColorToHex(c: FigmaColor): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function figmaColorToRgba(c: FigmaColor): string {
  const a = c.a ?? 1;
  if (a === 1) return figmaColorToHex(c);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a.toFixed(2)})`;
}

interface FigmaContext {
  text: string;
  /** Base64-encoded screenshot of the target node/frame, if available */
  screenshot?: { data: string; mimeType: 'image/png' | 'image/jpeg' };
}

function pushUnique<T>(target: T[], value: T, max: number): void {
  if (target.includes(value) || target.length >= max) return;
  target.push(value);
}

/** Fetch structured design context from the Figma REST API using MCP_FIGMA_API_KEY */
async function fetchFigmaFileContext(
  fileKey: string,
  nodeId: string | null,
): Promise<FigmaContext | null> {
  const apiKey = process.env['MCP_FIGMA_API_KEY'];
  if (!apiKey) return null;

  try {
    // Step 1: fetch node tree
    const depth = nodeId ? 6 : 3;
    const fileUrl = nodeId
      ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=${depth}`
      : `https://api.figma.com/v1/files/${fileKey}?depth=${depth}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let fileData: Record<string, unknown>;
    try {
      const res = await fetch(fileUrl, { headers: { 'X-Figma-Token': apiKey }, signal: controller.signal });
      if (!res.ok) return null;
      fileData = (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }

    const fileName = (fileData.name as string | undefined) ?? 'Untitled';
    const nodeKey = nodeId ? nodeId.replace(/-/g, ':') : null;
    const nodesMap = fileData.nodes as Record<string, { document?: FigmaNode }> | undefined;
    const nodeEntry = nodeKey ? nodesMap?.[nodeKey] : undefined;
    const rootDoc = (nodeId ? nodeEntry?.document : (fileData.document as FigmaNode | undefined));

    // Step 2: walk the tree to collect everything
    const layerLines: string[] = [];
    const textNodes: Array<{ name: string; text: string; style?: FigmaTypeStyle }> = [];
    const colorSet = new Set<string>();
    const imageNodeIds: string[] = [];
    const typographySet = new Map<string, FigmaTypeStyle>();

    function collectImageFills(fills: FigmaFill[] | undefined) {
      if (!fills) return;
      for (const f of fills) {
        if (f.type === 'SOLID' && f.color) colorSet.add(figmaColorToHex(f.color));
        if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') {
          for (const stop of f.gradientStops ?? []) colorSet.add(figmaColorToHex(stop.color));
        }
      }
    }

    function walkFull(node: FigmaNode, depth: number): void {
      if (!node || node.visible === false) return;
      const indent = '  '.repeat(Math.min(depth, 6));
      const bbox = node.absoluteBoundingBox;
      const sizeStr = bbox ? ` (${Math.round(bbox.width)}×${Math.round(bbox.height)})` : '';
      const radius = node.cornerRadius ? ` radius=${node.cornerRadius}` : '';

      if (node.type === 'TEXT' && node.characters) {
        const st = node.style;
        const styleStr = st
          ? ` font="${st.fontFamily ?? ''}" size=${st.fontSize ?? '?'} weight=${st.fontWeight ?? '?'}`
          : '';
        layerLines.push(`${indent}TEXT: "${node.characters.slice(0, 72)}"${styleStr}${sizeStr}`);
        textNodes.push({ name: node.name ?? '', text: node.characters, style: node.style });
        if (st?.fontFamily) typographySet.set(`${st.fontFamily}-${st.fontWeight}`, st);
        collectImageFills(node.fills);
      } else if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'VECTOR') {
        const hasFills = (node.fills ?? []).length > 0;
        const hasImage = (node.fills ?? []).some((f) => f.type === 'IMAGE');
        if (hasImage && node.id) imageNodeIds.push(node.id);
        const fillDesc = hasImage ? ' [IMAGE]' : '';
        layerLines.push(`${indent}${node.type}: ${node.name ?? ''}${fillDesc}${sizeStr}${radius}`);
        collectImageFills(node.fills);
      } else if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'GROUP') {
        const layout = node.layoutMode ? ` layout=${node.layoutMode}` : '';
        const gap = node.itemSpacing ? ` gap=${node.itemSpacing}` : '';
        const pad = (node as FigmaPadding);
        const padStr = pad.paddingTop !== undefined
          ? ` pad=${pad.paddingTop}/${pad.paddingRight}/${pad.paddingBottom}/${pad.paddingLeft}`
          : '';
        if (node.id && (node.type === 'FRAME' || node.type === 'COMPONENT')) imageNodeIds.push(node.id);
        layerLines.push(`${indent}${node.type}: ${node.name ?? ''}${layout}${gap}${padStr}${sizeStr}${radius}`);
        collectImageFills(node.fills);
        if (node.backgroundColor) colorSet.add(figmaColorToHex(node.backgroundColor));
      } else if (node.type) {
        layerLines.push(`${indent}${node.type}: ${node.name ?? ''}${sizeStr}`);
        collectImageFills(node.fills);
      }

      if (node.children && depth < 7) {
        for (const child of node.children.slice(0, 40)) {
          walkFull(child, depth + 1);
        }
      }
    }

    if (rootDoc?.children) {
      for (const child of (rootDoc.children ?? []).slice(0, 30)) {
        walkFull(child, 0);
      }
    } else if (rootDoc) {
      walkFull(rootDoc, 0);
    }

    // Step 3: fetch rendered image URLs for key nodes (max 8 to stay within API limits and prompt budget)
    const renderIds = [...new Set(imageNodeIds)].slice(0, 20);
    const imageUrlMap = new Map<string, string>();

    if (renderIds.length > 0) {
      try {
        const imgController = new AbortController();
        const imgTimer = setTimeout(() => imgController.abort(), 20_000);
        try {
          const idsParam = renderIds.slice(0, 8).map((id) => id.replace(/:/g, ':')).join(',');
          const imgRes = await fetch(
            `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(idsParam)}&format=png&scale=2`,
            { headers: { 'X-Figma-Token': apiKey }, signal: imgController.signal },
          );
          if (imgRes.ok) {
            const imgData = (await imgRes.json()) as { images?: Record<string, string> };
            for (const [id, url] of Object.entries(imgData.images ?? {})) {
              if (url) imageUrlMap.set(id, url);
            }
          }
        } finally {
          clearTimeout(imgTimer);
        }
      } catch {
        // image fetch is best-effort
      }
    }

    // Step 4: assemble context block
    const summary: string[] = [
      `File: ${fileName}`,
      `Key: ${fileKey}`,
      ...(nodeId ? [`Node: ${nodeId}`] : []),
      '',
      'Interpretation order: screenshot -> layout structure -> visible copy -> colors/typography.',
    ];

    if (layerLines.length > 0) {
      summary.push('', '=== Layer Structure ===');
      summary.push(...layerLines.slice(0, 28));
      if (layerLines.length > 28) summary.push(`  ... (${layerLines.length - 28} more layers)`);
    }

    // Deduplicated text content
    const uniqueTexts = [...new Set(textNodes.map((t) => t.text.trim()).filter((t) => t.length > 0))].slice(0, 10);
    if (uniqueTexts.length > 0) {
      summary.push('', '=== Text Content ===');
      for (const t of uniqueTexts) summary.push(`  - "${t.slice(0, 120)}"`);
    }

    // Typography system
    if (typographySet.size > 0) {
      summary.push('', '=== Typography ===');
      for (const [, st] of [...typographySet.entries()].slice(0, 8)) {
        summary.push(
          `  ${st.fontFamily ?? '?'} ${st.fontWeight ?? '?'} — ${st.fontSize ?? '?'}px` +
          (st.lineHeightPx ? ` / line-height ${Math.round(st.lineHeightPx)}px` : '') +
          (st.letterSpacing ? ` tracking ${st.letterSpacing}` : ''),
        );
      }
    }

    // Color palette
    const colors = [...colorSet].slice(0, 8);
    if (colors.length > 0) {
      summary.push('', '=== Color Palette ===');
      summary.push(colors.map((c) => `  ${c}`).join('\n'));
    }

    // Rendered image URLs are useful hints, but keep only a small preview inline.
    if (imageUrlMap.size > 0) {
      summary.push('', '=== Rendered Node Images ===');
      for (const [imageNodeId, url] of [...imageUrlMap.entries()].slice(0, 4)) {
        summary.push(`  ${imageNodeId}: ${truncateForPrompt(url, 120)}`);
      }
    }

    // Design styles from file metadata
    const styles = fileData.styles as Record<string, { name?: string; styleType?: string }> | undefined;
    if (styles) {
      const styleLines = Object.values(styles).slice(0, 10)
        .map((s) => `  ${s.styleType ?? '?'}: ${s.name ?? '?'}`).join('\n');
      if (styleLines) {
        summary.push('', '=== Named Styles ===', styleLines);
      }
    }

    const textContext = truncateForPrompt(summary.join('\n'), FIGMA_PREFETCH_CHAR_LIMIT);

    // Step 5: fetch a rendered screenshot of the target node so the LLM can see the design.
    let screenshot: { data: string; mimeType: 'image/png' | 'image/jpeg' } | undefined;
    const screenshotNodeId = nodeId ?? (rootDoc?.id ?? null);
    if (screenshotNodeId) {
      try {
        const sController = new AbortController();
        const sTimer = setTimeout(() => sController.abort(), 25_000);
        try {
          const screenshotId = screenshotNodeId.replace(/-/g, ':');
          const sRes = await fetch(
            `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(screenshotId)}&format=jpg&scale=0.15`,
            { headers: { 'X-Figma-Token': apiKey }, signal: sController.signal },
          );
          if (sRes.ok) {
            const sData = (await sRes.json()) as { images?: Record<string, string> };
            const screenshotUrl = sData.images?.[screenshotId];
            if (screenshotUrl) {
              const imgRes = await fetch(screenshotUrl, { signal: sController.signal });
              if (imgRes.ok) {
                const buffer = await imgRes.arrayBuffer();
                if (buffer.byteLength < 500_000) {
                  const base64 = Buffer.from(buffer).toString('base64');
                  screenshot = { data: base64, mimeType: 'image/jpeg' };
                } else {
                  console.log(`[figma] screenshot too large (${buffer.byteLength} bytes), skipping vision`);
                }
              }
            }
          }
        } finally {
          clearTimeout(sTimer);
        }
      } catch {
        // screenshot is best-effort
      }
    }

    console.log(`[figma] context built for ${fileKey}: ${layerLines.length} layers, ${uniqueTexts.length} texts, ${colors.length} colors, ${imageUrlMap.size} images, screenshot=${!!screenshot}`);
    return { text: textContext, screenshot };
  } catch (err) {
    console.warn('[figma] fetchFigmaFileContext failed:', err);
    return null;
  }
}

async function buildPrefetchedFigmaPromptContext(prompt: string, referenceUrl?: string): Promise<{
  prompt: string;
  toolServers: McpServerConfig[] | null;
  figmaImages: Array<{ data: string; mimeType: string }>;
  designSystem: import('@open-codesign/shared').StoredDesignSystem | null;
}> {
  const allText = referenceUrl ? `${prompt}\n${referenceUrl}` : prompt;
  const figmaUrls = extractFigmaFileUrls(allText);
  if (figmaUrls.length === 0) {
    return { prompt, toolServers: null, figmaImages: [], designSystem: null };
  }

  const blocks: string[] = [];
  const figmaImages: Array<{ data: string; mimeType: string }> = [];
  let designSystem: import('@open-codesign/shared').StoredDesignSystem | null = null;

  for (const url of figmaUrls) {
    const parsed = parseFigmaUrl(url);
    if (!parsed) continue;

    if (designSystem === null) {
      try {
        designSystem = await importDesignSystemFromFigma(url);
      } catch {
        designSystem = null;
      }
    }

    const context = await fetchFigmaFileContext(parsed.fileKey, parsed.nodeId);
    if (context) {
      blocks.push(`Figma URL: ${url}\n${context.text}`);
      if (context.screenshot) figmaImages.push(context.screenshot);
    } else {
      blocks.push(`Figma URL: ${url}\n(Live context unavailable — refer to the URL above.)`);
    }
  }

  if (blocks.length === 0) {
    return { prompt, toolServers: null, figmaImages: [], designSystem };
  }

  const screenshotNote = figmaImages.length > 0
    ? `\nIMPORTANT: A screenshot of the Figma design is attached as an image. Use it as the primary visual reference — match the layout, spacing, colors, typography, and visual style exactly as you see it.`
    : '';

  const nextPrompt = [
    FIGMA_PROMPT_PREFIX + screenshotNote,
    prompt,
    '--- PRELOADED FIGMA CONTEXT ---',
    ...blocks,
    '--- END PRELOADED FIGMA CONTEXT ---',
  ].join('\n\n');

  const toolServers = MCP_SERVERS.filter((server) => server.name === 'bcgpt-basecamp');

  return { prompt: nextPrompt, toolServers, figmaImages, designSystem };
}

function applyPlaywrightPromptSteering(
  prompt: string,
  options?: { hasFigmaContext?: boolean },
): string {
  if (options?.hasFigmaContext) return prompt;
  if (!PLAYWRIGHT_INTENT_RE.test(prompt)) return prompt;
  return `${PLAYWRIGHT_PROMPT_PREFIX}\n\n${prompt}`;
}

async function buildPrefetchedBrowserPromptContext(
  prompt: string,
  referenceUrl?: string,
): Promise<{
  prompt: string;
  toolServers: McpServerConfig[] | null;
}> {
  if (!shouldPrefetchBrowserContext(prompt, referenceUrl)) {
    return { prompt, toolServers: null };
  }

  const playableUrl = extractPlayableUrl(prompt, referenceUrl);
  if (playableUrl === undefined) {
    return { prompt, toolServers: null };
  }

  const playwrightServer = MCP_SERVERS.find((server) => server.name === 'playwright');
  if (playwrightServer === undefined) {
    return { prompt, toolServers: null };
  }

  try {
    await callMcpTool(playwrightServer, 'browser_navigate', { url: playableUrl });
    const snapshot = await callMcpTool(playwrightServer, 'browser_snapshot', {});
    const snapshotText = truncateForPrompt(
      stringifyMcpText(snapshot),
      PLAYWRIGHT_PREFETCH_CHAR_LIMIT,
    );
    const nextPrompt = [
      PLAYWRIGHT_SNAPSHOT_PREFIX,
      prompt,
      '--- PRELOADED PLAYWRIGHT SNAPSHOT ---',
      `Inspected URL: ${playableUrl}`,
      snapshotText,
      '--- END PRELOADED PLAYWRIGHT SNAPSHOT ---',
    ].join('\n\n');

    return {
      prompt: nextPrompt,
      toolServers: MCP_SERVERS.filter((server) => server.name !== 'playwright'),
    };
  } catch {
    return { prompt, toolServers: null };
  }
}

// Basecamp-related keywords that justify loading bcgpt tools
const BCGPT_INTENT_RE = /basecamp|project|todo|message|campfire|schedule|checkin/i;

function filterMcpToolsForPrompt<T extends { name: string }>(prompt: string, tools: T[]): T[] {
  const shouldKeepBrowserTools =
    PLAYWRIGHT_INTENT_RE.test(prompt) || extractPlayableUrl(prompt) !== undefined;

  if (!shouldKeepBrowserTools) {
    return tools.filter((tool) => !tool.name.startsWith('browser_')).slice(0, 128);
  }

  const browserTools = tools.filter((tool) => PLAYWRIGHT_TOOL_NAMES.has(tool.name));
  const nonBrowserTools = tools.filter((tool) => !tool.name.startsWith('browser_'));
  return [...nonBrowserTools, ...browserTools].slice(0, 128);
}

// ── Figma MCP sidecar ─────────────────────────────────────────────────────────

/**
 * Starts the official figma-mcp via supergateway (stdio→streamableHttp) on port 3001.
 * Requires /tmp/node_modules/.bin/supergateway and /tmp/node_modules/.bin/figma-mcp
 * to be pre-installed (run: cd /tmp && npm install figma-mcp supergateway).
 * Skipped if binaries are absent or MCP_FIGMA_LOCAL_DISABLED=1.
 */
function spawnFigmaMcpSidecar(): void {
  if (process.env['MCP_FIGMA_LOCAL_DISABLED'] === '1') return;
  const figmaApiKey = process.env['MCP_FIGMA_API_KEY'];
  if (!figmaApiKey) return;
  const supergateway = '/tmp/node_modules/.bin/supergateway';
  const figmaMcp = '/tmp/node_modules/.bin/figma-mcp';
  stat(supergateway).then(() => stat(figmaMcp)).then(() => {
    const child = spawn(
      supergateway,
      ['--port', '3001', '--outputTransport', 'streamableHttp', '--stdio', figmaMcp],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, FIGMA_API_KEY: figmaApiKey },
      },
    );
    child.unref();
    console.log('[web-server] figma-mcp sidecar started on port 3001');
  }).catch(() => {
    console.log('[web-server] figma-mcp sidecar skipped (binaries not found in /tmp/node_modules)');
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  spawnFigmaMcpSidecar();
  await loadConfig();
  console.log('[web-server] Config loaded, hasConfig:', cachedConfig !== null);
  try {
    const adopted = await ensureCodexProviderFromStoredAuth();
    if (adopted) {
      console.log('[web-server] Adopted existing Codex auth', {
        email: adopted.email,
        accountId: adopted.accountId,
      });
    }
  } catch (err) {
    console.warn('[web-server] Codex auth adoption skipped:', err);
  }

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
