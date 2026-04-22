/**
 * Wiring test for diagnostics:v1:log → recordDiagnosticEvent.
 *
 * Proves that renderer `error`-level entries are persisted into the
 * diagnostic_events table, while `info` and `warn` are log-only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const capturedFiles = new Map<string, string>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '0.0.0-test') },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getLogPath: vi.fn(() => '/tmp/__codesign-test-main.log'),
  logsDir: vi.fn(() => '/tmp/logs'),
}));

vi.mock('./config', () => ({
  configPath: vi.fn(() => '/tmp/__codesign-test-config.toml'),
  configDir: vi.fn(() => '/tmp'),
}));

vi.mock('zip-lib', async () => {
  const { readFileSync } = await import('node:fs');
  return {
    Zip: class {
      addFile(src: string, name: string): void {
        try {
          capturedFiles.set(name, readFileSync(src, 'utf8'));
        } catch {
          // ignore
        }
      }
      async archive(): Promise<void> {}
    },
  };
});

import {
  buildIssueUrlWithTemplate,
  redactSensitiveTomlFields,
  registerDiagnosticsIpc,
} from './diagnostics-ipc';
import { initInMemoryDb, listDiagnosticEvents, recordDiagnosticEvent } from './snapshots-db';

function invoke(channel: string, payload: unknown): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn({}, payload);
}

beforeEach(() => {
  handlers.clear();
  capturedFiles.clear();
});

afterEach(() => {
  handlers.clear();
  capturedFiles.clear();
  vi.restoreAllMocks();
});

describe('diagnostics:v1:recordRendererError', () => {
  it('returns the new row id', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const result = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'IMPORT_OPENCODE_FAILED',
      scope: 'onboarding',
      message: 'config:v1:import-opencode-config failed',
      stack: 'Error: boom\n    at foo',
    }) as { schemaVersion: 1; eventId: number | null };

    expect(result.schemaVersion).toBe(1);
    expect(typeof result.eventId).toBe('number');
    expect(result.eventId).toBeGreaterThan(0);

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(result.eventId);
    expect(rows[0]?.code).toBe('IMPORT_OPENCODE_FAILED');
    expect(rows[0]?.scope).toBe('onboarding');
  });

  it('returns null when db is null', () => {
    registerDiagnosticsIpc(null);
    const result = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'X',
      scope: 'y',
      message: 'z',
    }) as { schemaVersion: 1; eventId: number | null };
    expect(result).toEqual({ schemaVersion: 1, eventId: null });
  });

  it('dedups fingerprint within 200ms and returns the existing id', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const first = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'SAME_CODE',
      scope: 'toast',
      message: 'first',
      stack: 'same-stack',
    }) as { eventId: number | null };

    const second = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'SAME_CODE',
      scope: 'toast',
      message: 'second',
      stack: 'same-stack',
    }) as { eventId: number | null };

    expect(first.eventId).not.toBeNull();
    expect(second.eventId).toBe(first.eventId);
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
  });

  it('rejects bad input (missing code)', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    expect(() =>
      invoke('diagnostics:v1:recordRendererError', {
        schemaVersion: 1,
        scope: 'y',
        message: 'z',
      }),
    ).toThrow(/code/);
  });
});

describe('diagnostics:v1:log persistence', () => {
  it('persists error-level entries into diagnostic_events', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'error',
      scope: 'renderer:app',
      message: 'something exploded',
      data: { code: 'SOME_CODE', runId: 'run-abc' },
      stack: 'Error: boom\n    at foo',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe('error');
    expect(rows[0]?.code).toBe('SOME_CODE');
    expect(rows[0]?.scope).toBe('renderer:app');
    expect(rows[0]?.runId).toBe('run-abc');
    expect(rows[0]?.message).toBe('something exploded');
  });

  it('falls back to RENDERER_ERROR when data.code is absent', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'error',
      scope: 'renderer:app',
      message: 'boom',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('RENDERER_ERROR');
  });

  it('does NOT persist info or warn level entries', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'info',
      scope: 'renderer:app',
      message: 'hello',
    });
    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'warn',
      scope: 'renderer:app',
      message: 'careful',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(0);
  });

  it('is a no-op when db is null', () => {
    registerDiagnosticsIpc(null);
    expect(() =>
      invoke('diagnostics:v1:log', {
        schemaVersion: 1,
        level: 'error',
        scope: 'renderer:app',
        message: 'boom',
      }),
    ).not.toThrow();
  });
});

describe('diagnostics:v1:listEvents', () => {
  it('returns events from the DB wrapped in schemaVersion:1', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'X_CODE',
      scope: 'renderer:app',
      fingerprint: 'fp-a',
      message: 'one',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'Y_CODE',
      scope: 'renderer:app',
      fingerprint: 'fp-b',
      message: 'two',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    registerDiagnosticsIpc(db);

    const result = invoke('diagnostics:v1:listEvents', {
      schemaVersion: 1,
      limit: 10,
      includeTransient: true,
    }) as { schemaVersion: 1; events: Array<{ code: string }>; dbAvailable: boolean };

    expect(result.schemaVersion).toBe(1);
    expect(result.dbAvailable).toBe(true);
    expect(result.events).toHaveLength(2);
    const codes = result.events.map((e) => e.code).sort();
    expect(codes).toEqual(['X_CODE', 'Y_CODE']);
  });

  it('rejects bad input (missing schemaVersion)', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    expect(() => invoke('diagnostics:v1:listEvents', { limit: 10 })).toThrowError(/schemaVersion/);
  });

  it('returns empty list with dbAvailable=false when db is null', () => {
    registerDiagnosticsIpc(null);
    const result = invoke('diagnostics:v1:listEvents', { schemaVersion: 1 }) as {
      schemaVersion: 1;
      events: unknown[];
      dbAvailable: boolean;
    };
    expect(result).toEqual({ schemaVersion: 1, events: [], dbAvailable: false });
  });
});

describe('diagnostics:v1:reportEvent', () => {
  function baseReportInput(eventId: number, overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1 as const,
      eventId,
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
      includeTimeline: true,
      notes: 'looks bad',
      timeline: [],
      ...overrides,
    };
  }

  it('returns issueUrl + bundlePath + summaryMarkdown', async () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'SOMETHING_BROKE',
      scope: 'renderer:app',
      fingerprint: 'fp-deadbeef',
      message: 'it broke',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    const eventId = rows[0]?.id ?? 0;

    registerDiagnosticsIpc(db);

    const result = (await invoke('diagnostics:v1:reportEvent', baseReportInput(eventId))) as {
      schemaVersion: 1;
      issueUrl: string;
      bundlePath: string;
      summaryMarkdown: string;
    };

    expect(result.schemaVersion).toBe(1);
    expect(result.bundlePath).toMatch(/open-codesign-diagnostics-.*\.zip$/);
    expect(result.summaryMarkdown).toMatch(/SOMETHING_BROKE/);
    expect(result.issueUrl).toContain('github.com/OpenCoworkAI/open-codesign/issues/new');

    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('labels')).toBe('bug,triage,diagnostic-auto');
    expect(url.searchParams.get('title')).toBe('[Bug]: SOMETHING_BROKE (fp: fp-deadbeef)');
    expect(url.searchParams.get('error_code')).toBe('SOMETHING_BROKE');
    expect(url.searchParams.get('version')).toBe('0.0.0-test');
    // process.platform is darwin|linux|win32 in CI — one of the three mapped labels.
    expect(['macOS', 'Windows', 'Linux']).toContain(url.searchParams.get('platform'));
    const diagnostics = url.searchParams.get('diagnostics') ?? '';
    expect(diagnostics).toContain('Bundle saved locally at');
    expect(diagnostics).toContain(result.bundlePath);
  });

  it('throws IPC_NOT_FOUND when event id missing', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(invoke('diagnostics:v1:reportEvent', baseReportInput(9999))).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws IPC_BAD_INPUT on bad payload shape', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke('diagnostics:v1:reportEvent', { schemaVersion: 1, eventId: 'nope' }),
    ).rejects.toThrow();
  });

  it('rejects notes > 4000 chars (defense in depth — renderer cap is UX only)', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke('diagnostics:v1:reportEvent', baseReportInput(1, { notes: 'x'.repeat(4001) })),
    ).rejects.toThrow(/4000 characters/);
  });

  it('rejects timeline with > 100 entries', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    const timeline = Array.from({ length: 101 }, (_, i) => ({
      ts: i,
      type: 'prompt.submit' as const,
    }));
    await expect(
      invoke('diagnostics:v1:reportEvent', baseReportInput(1, { timeline })),
    ).rejects.toThrow(/100 entries/);
  });

  it('trims logs when total URL would exceed 7KB', () => {
    // Drive the helper directly so we can force an oversized tail without
    // fighting the 50-line cap in readLogTail.
    const event = {
      id: 1,
      schemaVersion: 1 as const,
      ts: 0,
      level: 'error' as const,
      code: 'HUGE',
      scope: 'renderer:app',
      runId: undefined,
      fingerprint: 'fp-huge',
      message: 'A'.repeat(2000),
      stack: undefined,
      transient: false,
      count: 1,
      context: undefined,
    };
    // Lines contain `\n`-heavy payload so URL encoding of %0A inflates the
    // encoded logs field past the 7KB URL cap and forces the trim path.
    const logTail = Array.from(
      { length: 300 },
      (_, i) => `line ${i}:\n\n\n${'X'.repeat(20)}\n\n\n`,
    );
    const url = buildIssueUrlWithTemplate({
      event,
      bundlePath: '/tmp/open-codesign-diagnostics-test.zip',
      appVersion: '9.9.9-test',
      platform: 'darwin',
      platformVersion: '24.0.0',
      logTail,
    });
    expect(url.length).toBeLessThanOrEqual(7100);
    const logs = new URL(url).searchParams.get('logs') ?? '';
    expect(logs).toMatch(/truncated; see attached bundle/);
  });

  it('issueUrl uses bug_report.yml template with pre-filled error_code + version + platform', async () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'PROVIDER_HTTP_4XX',
      scope: 'provider',
      fingerprint: 'fp-prov',
      message: 'upstream 400',
      runId: undefined,
      stack: undefined,
      transient: false,
      context: { upstream_provider: 'anthropic', upstream_status: 400 },
    });
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    const eventId = rows[0]?.id ?? 0;
    registerDiagnosticsIpc(db);

    const result = (await invoke('diagnostics:v1:reportEvent', baseReportInput(eventId))) as {
      issueUrl: string;
    };
    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('error_code')).toBe('PROVIDER_HTTP_4XX');
    expect(url.searchParams.get('version')).toBe('0.0.0-test');
    expect(url.searchParams.get('provider')).toBe('Anthropic');
    const actual = url.searchParams.get('actual') ?? '';
    expect(actual).toContain('upstream_status=400');
  });

  it('issueUrl encodes special characters correctly', async () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'WEIRD_CODE',
      scope: 'renderer:app',
      fingerprint: 'fp-weird',
      message: 'boom & spaces + "quotes" / slashes',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    const eventId = rows[0]?.id ?? 0;
    registerDiagnosticsIpc(db);

    const result = (await invoke('diagnostics:v1:reportEvent', baseReportInput(eventId))) as {
      issueUrl: string;
    };
    // URL parsing must succeed and round-trip the message.
    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('actual')).toContain('boom & spaces + "quotes" / slashes');
  });
});

describe('diagnostics bundle main.log scrubbing', () => {
  async function writeTestLog(content: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('/tmp/__codesign-test-main.log', content, 'utf8');
  }

  async function recordAndReport(overrides: Record<string, unknown>): Promise<{ mainLog: string }> {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'BUNDLE_TEST',
      scope: 'renderer:app',
      fingerprint: 'fp-bundle',
      message: 'bundle check',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    const eventId = rows[0]?.id ?? 0;

    registerDiagnosticsIpc(db);
    await invoke('diagnostics:v1:reportEvent', {
      schemaVersion: 1,
      eventId,
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
      includeTimeline: true,
      notes: '',
      timeline: [],
      ...overrides,
    });
    const mainLog = capturedFiles.get('main.log');
    if (mainLog === undefined) throw new Error('main.log not captured');
    return { mainLog };
  }

  it('bundle main.log is scrubbed for paths when includePaths=false', async () => {
    await writeTestLog(
      [
        '[00:00] open /Users/alice/secret/file.ts',
        '[00:01] tmp path /var/folders/xy/abc/T/cache',
        '[00:02] hit https://example.com/api',
      ].join('\n'),
    );
    const { mainLog } = await recordAndReport({ includePaths: false, includeUrls: false });
    expect(mainLog).not.toContain('/Users/alice');
    expect(mainLog).not.toContain('/var/folders');
    expect(mainLog).not.toContain('https://example.com');
    expect(mainLog).toContain('<path omitted>');
    expect(mainLog).toContain('<url omitted>');
  });

  it('bundle main.log preserves prompt JSON when includePromptText=true', async () => {
    await writeTestLog('[00:00] generate.request data={"prompt":"build me a rocket"}');
    const { mainLog } = await recordAndReport({
      includePromptText: true,
      includePaths: true,
      includeUrls: true,
    });
    expect(mainLog).toContain('"prompt":"build me a rocket"');
    expect(mainLog).not.toContain('<prompt omitted>');
  });

  it('bundle main.log scrubs prompt JSON when includePromptText=false', async () => {
    await writeTestLog('[00:00] generate.request data={"prompt":"build me a rocket"}');
    const { mainLog } = await recordAndReport({
      includePromptText: false,
      includePaths: true,
      includeUrls: true,
    });
    expect(mainLog).not.toContain('build me a rocket');
    expect(mainLog).toContain('<prompt omitted>');
  });
});

describe('redactSensitiveTomlFields', () => {
  it('masks google api_key=AIzaSy...', () => {
    const input = 'api_key = "AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNOPQRSTUVWX"';
    expect(redactSensitiveTomlFields(input)).toBe('api_key = "***REDACTED***"');
  });

  it('masks api_key with unusual format', () => {
    const input = 'apiKey = "custom-prefix_weird.format/ABC==xyz"';
    expect(redactSensitiveTomlFields(input)).toBe('apiKey = "***REDACTED***"');
  });

  it('masks token / bearer / secret / access_token / refresh_token / password', () => {
    const input = [
      'token = "t1"',
      'bearer = "b1"',
      'secret = "s1"',
      'access_token = "a1"',
      'refresh_token = "r1"',
      'password = "p1"',
    ].join('\n');
    const out = redactSensitiveTomlFields(input);
    for (const raw of ['"t1"', '"b1"', '"s1"', '"a1"', '"r1"', '"p1"']) {
      expect(out).not.toContain(raw);
    }
    expect(out.match(/"\*\*\*REDACTED\*\*\*"/g)?.length).toBe(6);
  });

  it('keeps non-sensitive string fields intact', () => {
    const input = 'base_url = "https://api.example.com"\nname = "alice"';
    expect(redactSensitiveTomlFields(input)).toBe(input);
  });

  it('is case-insensitive for keys', () => {
    const input = 'API_KEY = "upper"';
    expect(redactSensitiveTomlFields(input)).toBe('API_KEY = "***REDACTED***"');
  });

  it('masks the ciphertext field used by this codebase to persist secrets', () => {
    // Reproduces the real bundle leak a user reported on 2026-04-22: the
    // `[secrets.*] ciphertext = "..."` field was slipping through because
    // it wasn't on the field allowlist. "plain:<value>" is the dev-mode
    // pass-through encoding (see keychain.ts), so the raw token is right
    // there in the exported zip.
    const input = [
      '[secrets.claude-code-imported]',
      'ciphertext = "plain:another-your-anthropic-auth-token"',
      'mask = "anot***oken"',
    ].join('\n');
    const out = redactSensitiveTomlFields(input);
    expect(out).toContain('ciphertext = "***REDACTED***"');
    expect(out).not.toContain('another-your-anthropic-auth-token');
    // mask is already the user-visible obscured form — stays intact.
    expect(out).toContain('mask = "anot***oken"');
  });

  it('masks auth_token and credential field aliases', () => {
    expect(redactSensitiveTomlFields('auth_token = "x"')).toBe('auth_token = "***REDACTED***"');
    expect(redactSensitiveTomlFields('credential = "y"')).toBe('credential = "***REDACTED***"');
  });
});
