import type {
  CodesignApi,
  CodexOAuthStatus,
  ImageGenerationSettingsView,
} from '../../../preload/index';

const LOCALE_KEY = 'open-codesign.locale';
const IMAGE_SETTINGS_KEY = 'open-codesign.image-generation';

type JsonInit = Omit<RequestInit, 'body'> & { body?: unknown };

type AgentEventListener = (event: Record<string, unknown>) => void;

const agentListeners = new Set<AgentEventListener>();

let codexLoginPopup: Window | null = null;
let codexLoginCancelled = false;

function dispatchAgentEvent(event: Record<string, unknown>): void {
  for (const listener of agentListeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[web-codesign] agent listener failed', err);
    }
  }
}

function buildInit(init?: JsonInit): RequestInit {
  const headers = new Headers(init?.headers);
  let body = init?.body;
  if (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    typeof body !== 'string'
  ) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const requestInit: RequestInit = {
    method: init?.method ?? 'GET',
    headers,
  };
  if (body !== undefined) {
    requestInit.body = body as BodyInit | null;
  }
  return requestInit;
}

async function readError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return json.error?.message ?? json.message ?? `HTTP ${response.status}`;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

async function apiJson<T>(path: string, init?: JsonInit): Promise<T> {
  const response = await fetch(path, buildInit(init));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

function localStorageGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localStorageSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in private mode / quota edge cases.
  }
}

function defaultImageSettings(): ImageGenerationSettingsView {
  return {
    enabled: false,
    provider: 'openai',
    credentialMode: 'inherit',
    model: 'gpt-image-2',
    baseUrl: 'https://api.openai.com/v1',
    quality: 'high',
    size: '1536x1024',
    outputFormat: 'png',
    hasCustomKey: false,
    maskedKey: null,
    inheritedKeyAvailable: false,
  };
}

async function uploadPickedFiles(files: FileList): Promise<Array<Record<string, unknown>>> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append('files', file, file.name);
  }
  const uploaded = await apiJson<
    Array<{ name: string; size: number; mimeType: string; dataUrl: string }>
  >('/api/upload-files', {
    method: 'POST',
    body: form,
  });
  return uploaded.map((file, index) => ({
    path: `upload:${Date.now().toString(36)}:${index}:${file.name}`,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    dataUrl: file.dataUrl,
  }));
}

function pickFilesViaInput(): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener(
      'change',
      () => {
        const files = input.files;
        input.remove();
        if (!files || files.length === 0) {
          resolve([]);
          return;
        }
        void uploadPickedFiles(files).then(resolve, reject);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function parseSseResponse(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error('Missing response stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) break;
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        const event = JSON.parse(raw) as Record<string, unknown>;
        if (event['type'] === 'done') {
          return event['result'];
        }
        if (event['type'] === 'error') {
          onEvent(event);
          throw new Error(String(event['message'] ?? 'Unknown generation error'));
        }
        onEvent(event);
      }
    }
  }

  throw new Error('Generation stream ended before completion');
}

async function getCurrentLocale(): Promise<string> {
  const stored = localStorageGet<string | null>(LOCALE_KEY, null);
  if (stored) return stored;
  const result = await apiJson<{ locale?: string }>('/api/locale');
  return result.locale ?? 'en';
}

function unsupportedDesktopFeature(name: string): Error {
  return new Error(`${name} is only available in the desktop app right now.`);
}

async function liveTestEndpoint(input: {
  wire: string;
  baseUrl: string;
  apiKey: string;
}): Promise<
  { ok: true; modelCount: number; models: string[] } | { ok: false; error: string; message: string }
> {
  const result = await apiJson<{ ok: true; models: string[] } | { ok: false; error: string }>(
    '/api/config/list-endpoint-models',
    {
      method: 'POST',
      body: input,
    },
  );
  if (result.ok) {
    return {
      ok: true,
      modelCount: result.models.length,
      models: result.models,
    };
  }
  return { ok: false, error: result.error, message: result.error };
}

async function beginCodexLogin(): Promise<CodexOAuthStatus> {
  codexLoginCancelled = false;
  const start = await apiJson<{ url: string }>('/api/codex/start-login', { method: 'POST' });
  codexLoginPopup = window.open(
    start.url,
    'open-codesign-codex-login',
    'popup=yes,width=560,height=760',
  );
  if (!codexLoginPopup) {
    throw new Error('Failed to open login popup. Check your popup blocker.');
  }

  return new Promise<CodexOAuthStatus>((resolve, reject) => {
    const poll = window.setInterval(() => {
      if (codexLoginCancelled) {
        window.clearInterval(poll);
        codexLoginPopup?.close();
        codexLoginPopup = null;
        reject(new Error('Codex login cancelled'));
        return;
      }

      if (codexLoginPopup?.closed) {
        void apiJson<CodexOAuthStatus>('/api/codex/status')
          .then((status) => {
            window.clearInterval(poll);
            codexLoginPopup = null;
            if (status.loggedIn) resolve(status);
            else reject(new Error('Codex OAuth callback aborted'));
          })
          .catch((err) => {
            window.clearInterval(poll);
            codexLoginPopup = null;
            reject(err);
          });
        return;
      }

      void apiJson<CodexOAuthStatus>('/api/codex/status')
        .then((status) => {
          if (!status.loggedIn) return;
          window.clearInterval(poll);
          codexLoginPopup?.close();
          codexLoginPopup = null;
          resolve(status);
        })
        .catch(() => {
          // Ignore transient poll failures while the popup is active.
        });
    }, 1000);
  });
}

function installWebCodesign(): void {
  if (typeof window === 'undefined' || window.codesign) return;

  const api: Partial<CodesignApi> = {
    detectProvider: async (key: string) => {
      const result = await apiJson<{ provider: string | null }>('/api/detect-provider', {
        method: 'POST',
        body: { key },
      });
      return result.provider;
    },
    doneVerify: (artifact: string) =>
      apiJson('/api/done-verify', { method: 'POST', body: { artifact } }),
    generate: async (payload) => {
      const response = await fetch('/api/generate', buildInit({ method: 'POST', body: payload }));
      return (await parseSseResponse(response, (event) => {
        dispatchAgentEvent(event);
      })) as Awaited<ReturnType<NonNullable<CodesignApi['generate']>>>;
    },
    cancelGeneration: (generationId: string) =>
      apiJson('/api/generate/cancel', { method: 'POST', body: { generationId } }).then(() => {}),
    generateTitle: async (prompt: string) => {
      const result = await apiJson<{ title: string }>('/api/generate/title', {
        method: 'POST',
        body: { prompt },
      });
      return result.title;
    },
    applyComment: (payload) =>
      apiJson('/api/apply-comment', { method: 'POST', body: payload }) as ReturnType<
        NonNullable<CodesignApi['applyComment']>
      >,
    pickInputFiles: () =>
      pickFilesViaInput() as ReturnType<NonNullable<CodesignApi['pickInputFiles']>>,
    pickDesignSystemDirectory: async () => {
      throw unsupportedDesktopFeature('Design system folder picking');
    },
    clearDesignSystem: () =>
      apiJson('/api/design-system', { method: 'DELETE' }) as ReturnType<
        NonNullable<CodesignApi['clearDesignSystem']>
      >,
    export: async ({ format, htmlContent, defaultFilename }) => {
      const filename = defaultFilename ?? `open-codesign.${format === 'markdown' ? 'md' : format}`;
      if (format === 'html') {
        downloadText(filename, htmlContent, 'text/html;charset=utf-8');
        return { status: 'saved', path: filename };
      }
      if (format === 'markdown') {
        downloadText(filename, htmlContent, 'text/markdown;charset=utf-8');
        return { status: 'saved', path: filename };
      }
      throw unsupportedDesktopFeature(`${format.toUpperCase()} export`);
    },
    locale: {
      getSystem: async () => {
        const result = await apiJson<{ locale?: string }>('/api/locale');
        return result.locale ?? 'en';
      },
      getCurrent: getCurrentLocale,
      set: async (locale: string) => {
        localStorageSet(LOCALE_KEY, locale);
        return locale;
      },
    },
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    installUpdate: async () => undefined,
    onUpdateAvailable: (() => () => {}) as unknown as CodesignApi['onUpdateAvailable'],
    onboarding: {
      getState: () => apiJson('/api/onboarding/state'),
      validateKey: (input) =>
        apiJson('/api/onboarding/validate-key', { method: 'POST', body: input }),
      saveKey: (input) => apiJson('/api/onboarding/save-key', { method: 'POST', body: input }),
      skip: () => apiJson('/api/onboarding/state'),
    },
    settings: {
      listProviders: () => apiJson('/api/settings/providers'),
      addProvider: async (input) => {
        await apiJson('/api/onboarding/save-key', { method: 'POST', body: input });
        return apiJson('/api/settings/providers');
      },
      deleteProvider: async (provider: string) => {
        await apiJson(`/api/config/provider/${encodeURIComponent(provider)}`, {
          method: 'DELETE',
        });
        return apiJson('/api/settings/providers');
      },
      setActiveProvider: (input) =>
        apiJson('/api/config/set-active-provider', { method: 'POST', body: input }),
      getPaths: async () => ({
        config: '/data/config.toml',
        configFolder: '/data',
        logs: '/data/logs',
        logsFolder: '/data/logs',
        data: '/data',
      }),
      chooseStorageFolder: undefined as unknown as CodesignApi['settings']['chooseStorageFolder'],
      openFolder: async () => {
        throw unsupportedDesktopFeature('Opening local folders');
      },
      resetOnboarding: async () => undefined,
      toggleDevtools: undefined as unknown as CodesignApi['settings']['toggleDevtools'],
      validateKey: (input) =>
        apiJson('/api/onboarding/validate-key', { method: 'POST', body: input }),
    } as CodesignApi['settings'],
    config: {
      setProviderAndModels: (input) =>
        apiJson('/api/config/set-provider-and-models', { method: 'POST', body: input }),
      addProvider: (input) => apiJson('/api/config/add-provider', { method: 'POST', body: input }),
      updateProvider: (input) =>
        apiJson('/api/config/update-provider', { method: 'POST', body: input }),
      removeProvider: (id: string) =>
        apiJson(`/api/config/provider/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      setActiveProviderAndModel: (input) =>
        apiJson('/api/config/set-active-provider', { method: 'POST', body: input }),
      testEndpoint: (input) => liveTestEndpoint(input),
      listEndpointModels: (input) =>
        apiJson('/api/config/list-endpoint-models', { method: 'POST', body: input }),
      detectExternalConfigs: async () => ({}),
      importCodexConfig: async () => {
        throw unsupportedDesktopFeature('Config import');
      },
      importClaudeCodeConfig: async () => {
        throw unsupportedDesktopFeature('Config import');
      },
      importGeminiConfig: async () => {
        throw unsupportedDesktopFeature('Config import');
      },
      importOpencodeConfig: async () => {
        throw unsupportedDesktopFeature('Config import');
      },
    },
    preferences: {
      get: () => apiJson('/api/preferences'),
      update: (patch) => apiJson('/api/preferences', { method: 'PATCH', body: patch }),
    },
    imageGeneration: {
      get: async () => localStorageGet(IMAGE_SETTINGS_KEY, defaultImageSettings()),
      update: async (patch) => {
        const current = localStorageGet(IMAGE_SETTINGS_KEY, defaultImageSettings());
        const next = {
          ...current,
          ...patch,
          hasCustomKey:
            typeof patch.apiKey === 'string'
              ? patch.apiKey.trim().length > 0
              : current.hasCustomKey,
          maskedKey:
            typeof patch.apiKey === 'string'
              ? patch.apiKey.trim().length > 0
                ? '***'
                : null
              : current.maskedKey,
        };
        localStorageSet(IMAGE_SETTINGS_KEY, next);
        return next;
      },
    },
    codexOAuth: {
      status: () => apiJson('/api/codex/status'),
      login: beginCodexLogin,
      cancelLogin: async () => {
        if (!codexLoginPopup) return false;
        codexLoginCancelled = true;
        codexLoginPopup.close();
        codexLoginPopup = null;
        return true;
      },
      logout: async () => {
        await apiJson('/api/codex/logout', { method: 'POST' });
        return apiJson('/api/codex/status');
      },
    },
    connection: {
      test: async (input) => {
        const tested = await liveTestEndpoint({
          wire: input.provider === 'anthropic' ? 'anthropic' : 'openai-chat',
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        });
        if (tested.ok) return { ok: true };
        return {
          ok: false,
          code: 'NETWORK',
          message: tested.message,
          hint: tested.message,
        };
      },
      testActive: () => apiJson('/api/connection/test-active', { method: 'POST' }),
      testProvider: (providerId: string) =>
        apiJson(`/api/connection/test-provider/${encodeURIComponent(providerId)}`, {
          method: 'POST',
        }),
    },
    models: {
      list: async (input) => {
        const result = await apiJson<{ ok: true; models: string[] } | { ok: false; error: string }>(
          '/api/config/list-endpoint-models',
          {
            method: 'POST',
            body: {
              wire: input.provider === 'anthropic' ? 'anthropic' : 'openai-chat',
              baseUrl: input.baseUrl,
              apiKey: input.apiKey,
            },
          },
        );
        return result.ok
          ? { ok: true, models: result.models }
          : { ok: false, code: 'NETWORK', message: result.error, hint: result.error };
      },
      listForProvider: (providerId: string) =>
        apiJson(`/api/models/provider/${encodeURIComponent(providerId)}`),
    },
    ollama: {
      probe: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'Ollama probe unavailable' }),
    },
    snapshots: {
      listDesigns: () => apiJson('/api/designs'),
      createDesign: (name: string) => apiJson('/api/designs', { method: 'POST', body: { name } }),
      getDesign: (id: string) => apiJson(`/api/designs/${encodeURIComponent(id)}`),
      renameDesign: (id: string, name: string) =>
        apiJson(`/api/designs/${encodeURIComponent(id)}/rename`, {
          method: 'PATCH',
          body: { name },
        }),
      setThumbnail: (id: string, thumbnailText: string | null) =>
        apiJson(`/api/designs/${encodeURIComponent(id)}/thumbnail`, {
          method: 'PATCH',
          body: { thumbnail: thumbnailText },
        }),
      softDeleteDesign: (id: string) =>
        apiJson(`/api/designs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      duplicateDesign: (id: string) =>
        apiJson(`/api/designs/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
      list: (designId: string) => apiJson(`/api/designs/${encodeURIComponent(designId)}/snapshots`),
      get: (id: string) => apiJson(`/api/snapshots/${encodeURIComponent(id)}`),
      create: (input) =>
        apiJson(`/api/designs/${encodeURIComponent(input.designId)}/snapshots`, {
          method: 'POST',
          body: input,
        }),
      delete: (id: string) =>
        apiJson(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => {}),
      pickWorkspaceFolder: async () => null,
      updateWorkspace: async (
        designId: string,
        _workspacePath: string | null,
        _migrateFiles: boolean,
      ) => {
        const design = await apiJson<Awaited<ReturnType<CodesignApi['snapshots']['getDesign']>>>(
          `/api/designs/${encodeURIComponent(designId)}`,
        );
        if (!design) {
          throw new Error(`Design "${designId}" not found`);
        }
        return design;
      },
      openWorkspaceFolder: async () => {
        throw unsupportedDesktopFeature('Opening workspace folders');
      },
      checkWorkspaceFolder: async () => ({ exists: false }),
    },
    chat: {
      list: (designId: string) => apiJson(`/api/designs/${encodeURIComponent(designId)}/chat`),
      append: (input) =>
        apiJson(`/api/designs/${encodeURIComponent(input.designId)}/chat`, {
          method: 'POST',
          body: input,
        }),
      seedFromSnapshots: (designId: string) =>
        apiJson(`/api/designs/${encodeURIComponent(designId)}/chat/seed-from-snapshots`, {
          method: 'POST',
        }),
      updateToolStatus: (input) =>
        apiJson(
          `/api/designs/${encodeURIComponent(input.designId)}/chat/${input.seq}/tool-status`,
          {
            method: 'PATCH',
            body: input,
          },
        ),
      onAgentEvent: ((cb) => {
        const listener = cb as unknown as AgentEventListener;
        agentListeners.add(listener);
        return () => {
          agentListeners.delete(listener);
        };
      }) as CodesignApi['chat']['onAgentEvent'],
    },
    comments: {
      add: (input) =>
        apiJson(`/api/designs/${encodeURIComponent(input.designId)}/comments`, {
          method: 'POST',
          body: input,
        }),
      list: (designId: string, snapshotId?: string) =>
        apiJson(
          snapshotId
            ? `/api/designs/${encodeURIComponent(designId)}/comments?snapshotId=${encodeURIComponent(snapshotId)}`
            : `/api/designs/${encodeURIComponent(designId)}/comments`,
        ),
      listPendingEdits: (designId: string) =>
        apiJson(`/api/designs/${encodeURIComponent(designId)}/comments/pending-edits`),
      update: (id: string, patch) =>
        apiJson(`/api/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      remove: (id: string) =>
        apiJson(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      markApplied: (ids: string[], snapshotId: string) =>
        apiJson('/api/comments/mark-applied', {
          method: 'POST',
          body: { ids, snapshotId },
        }),
    },
    diagnostics: {
      log: async () => undefined,
      recordRendererError: async () => ({ schemaVersion: 1, eventId: null }),
      openLogFolder: async () => {
        throw unsupportedDesktopFeature('Opening log folders');
      },
      exportDiagnostics: async () => {
        throw unsupportedDesktopFeature('Diagnostics export');
      },
      showItemInFolder: async () => undefined,
      listEvents: async () => ({ schemaVersion: 1, events: [], dbAvailable: false }),
      reportEvent: async (input) => {
        const summaryMarkdown = [
          `# ${input.error.code}`,
          '',
          input.error.message,
          '',
          `Scope: ${input.error.scope}`,
        ].join('\n');
        return {
          schemaVersion: 1,
          issueUrl: window.location.origin,
          bundlePath: '',
          summaryMarkdown,
        };
      },
      isFingerprintRecentlyReported: async () => ({
        schemaVersion: 1,
        reported: false,
      }),
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };

  window.codesign = api as CodesignApi;
}

installWebCodesign();
