import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const writeFileMock = vi.fn(async (_path: unknown, _data: unknown, _enc?: unknown) => undefined);
const openExternalMock = vi.fn(async (_url: string) => undefined);

vi.mock('node:fs/promises', () => ({
  writeFile: (path: unknown, data: unknown, enc?: unknown) => writeFileMock(path, data, enc),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ mtimeMs: Date.now() })),
  unlink: vi.fn(async () => undefined),
}));

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  shell: { openExternal: (url: string) => openExternalMock(url) },
  app: { getPath: vi.fn(() => '/tmp/test') },
}));

import {
  buildTempFilename,
  cleanupOldTempFiles,
  parseShareRequest,
  registerShareIpc,
  safeDesignSlug,
} from './share-ipc';

describe('parseShareRequest', () => {
  it('rejects null payload with IPC_BAD_INPUT', () => {
    expect(() => parseShareRequest(null)).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects unsupported schemaVersion', () => {
    expect(() => parseShareRequest({ schemaVersion: 2, html: '<p/>' })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects empty html', () => {
    expect(() => parseShareRequest({ schemaVersion: 1, html: '' })).toThrow(CodesignError);
  });

  it('accepts valid request with optional designName', () => {
    const r = parseShareRequest({ schemaVersion: 1, html: '<x/>', designName: 'My Idea' });
    expect(r.html).toBe('<x/>');
    expect(r.designName).toBe('My Idea');
  });
});

describe('safeDesignSlug', () => {
  it('falls back to "design" when name missing or unsafe', () => {
    expect(safeDesignSlug(undefined)).toBe('design');
    expect(safeDesignSlug('')).toBe('design');
    expect(safeDesignSlug('!!!')).toBe('design');
  });

  it('strips path traversal and special chars', () => {
    expect(safeDesignSlug('../etc/passwd')).toBe('etc-passwd');
    expect(safeDesignSlug('Hello World/Slide 2')).toBe('Hello-World-Slide-2');
  });
});

describe('buildTempFilename', () => {
  it('produces a stable, namespaced filename', () => {
    expect(buildTempFilename('My Design', 1700000000000)).toBe(
      'open-codesign-My-Design-1700000000000.html',
    );
    expect(buildTempFilename(undefined, 42)).toBe('open-codesign-design-42.html');
  });
});

describe('cleanupOldTempFiles', () => {
  it('deletes share files older than the cutoff and keeps recent ones', async () => {
    const now = 1_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const unlinkSpy = vi.fn(async () => undefined);

    const removed = await cleanupOldTempFiles(
      '/tmp/test',
      {
        readdir: async () => [
          'open-codesign-old-1.html',
          'open-codesign-fresh-2.html',
          'unrelated-file.html',
          'open-codesign-old-3.html',
          'open-codesign-not-html.txt',
        ],
        stat: async (p: string) => {
          if (p.includes('fresh')) return { mtimeMs: now - 1000 };
          return { mtimeMs: now - dayMs - 1000 };
        },
        unlink: unlinkSpy,
        now: () => now,
      },
      dayMs,
    );

    expect(removed).toContain('/tmp/test/open-codesign-old-1.html');
    expect(removed).toContain('/tmp/test/open-codesign-old-3.html');
    expect(removed).not.toContain('/tmp/test/open-codesign-fresh-2.html');
    expect(removed).not.toContain('/tmp/test/unrelated-file.html');
    expect(unlinkSpy).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when readdir fails', async () => {
    const removed = await cleanupOldTempFiles('/missing', {
      readdir: async () => {
        throw new Error('ENOENT');
      },
      stat: async () => ({ mtimeMs: 0 }),
      unlink: async () => undefined,
      now: () => 0,
    });
    expect(removed).toEqual([]);
  });
});

describe('share:v1:openInBrowser handler', () => {
  function getHandler(): (...args: unknown[]) => unknown {
    registerShareIpc();
    const fn = handlers.get('share:v1:openInBrowser');
    if (!fn) throw new Error('handler not registered');
    return fn;
  }

  it('writes html to temp file and opens it via shell.openExternal with file:// URL', async () => {
    const fn = getHandler();
    expect(fn).toBeDefined();

    writeFileMock.mockClear();
    openExternalMock.mockClear();
    openExternalMock.mockResolvedValueOnce(undefined);

    const result = (await fn(
      {},
      {
        schemaVersion: 1,
        html: '<p>hi</p>',
        designName: 'demo',
      },
    )) as { ok: true; filepath: string };

    expect(result.ok).toBe(true);
    expect(result.filepath).toMatch(/^\/tmp\/test\/open-codesign-demo-\d+\.html$/);
    expect(writeFileMock).toHaveBeenCalledOnce();
    const firstCall = writeFileMock.mock.calls[0];
    expect(firstCall?.[0]).toBe(result.filepath);
    expect(firstCall?.[1]).toBe('<p>hi</p>');
    expect(openExternalMock).toHaveBeenCalledTimes(1);
    const openedUrl = openExternalMock.mock.calls[0]?.[0];
    expect(openedUrl).toBe(`file://${result.filepath}`);
    expect(openedUrl).toMatch(/^file:\/\//);
  });

  it('throws SHARE_OPEN_FAILED when shell.openExternal rejects', async () => {
    const fn = getHandler();
    openExternalMock.mockRejectedValueOnce(new Error('Bad path'));
    await expect(fn({}, { schemaVersion: 1, html: '<p/>' })).rejects.toThrowError(
      expect.objectContaining({ code: 'SHARE_OPEN_FAILED' }),
    );
  });

  it('rejects invalid payloads with IPC_BAD_INPUT', async () => {
    const fn = getHandler();
    await expect(fn({}, { html: '<p/>' })).rejects.toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });
});
