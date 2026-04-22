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

import { registerDiagnosticsIpc } from './diagnostics-ipc';
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
    expect(result.issueUrl).toContain('labels=bug%2Cdiagnostic-auto');
    expect(result.issueUrl).toContain(encodeURIComponent('[bug] SOMETHING_BROKE'));
    expect(result.issueUrl).toContain(encodeURIComponent('fp: fp-deadbeef'));
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

  it('truncates body when summary exceeds 7 KB', async () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'HUGE',
      scope: 'renderer:app',
      fingerprint: 'fp-huge',
      message: 'A'.repeat(15000),
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    const eventId = rows[0]?.id ?? 0;

    registerDiagnosticsIpc(db);
    const result = (await invoke(
      'diagnostics:v1:reportEvent',
      baseReportInput(eventId, { includePromptText: true }),
    )) as { issueUrl: string };

    const decodedBody = decodeURIComponent(new URL(result.issueUrl).searchParams.get('body') ?? '');
    expect(decodedBody).toMatch(/truncated/);
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
