import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CodesignError } from '@open-codesign/shared';
import { app, ipcMain, shell } from './electron-runtime';

export interface ShareOpenInBrowserRequest {
  schemaVersion: 1;
  html: string;
  designName?: string;
}

export interface ShareOpenInBrowserResponse {
  ok: true;
  filepath: string;
}

const TEMP_FILE_PREFIX = 'open-codesign-';
const TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function parseShareRequest(raw: unknown): ShareOpenInBrowserRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('share expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      `Unsupported share schemaVersion: ${String(r['schemaVersion'])}`,
      'IPC_BAD_INPUT',
    );
  }
  const html = r['html'];
  if (typeof html !== 'string' || html.length === 0) {
    throw new CodesignError('share requires non-empty html', 'IPC_BAD_INPUT');
  }
  const designName = r['designName'];
  const out: ShareOpenInBrowserRequest = { schemaVersion: 1, html };
  if (typeof designName === 'string' && designName.length > 0) {
    out.designName = designName;
  }
  return out;
}

export function safeDesignSlug(name: string | undefined): string {
  if (!name) return 'design';
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'design';
}

export function buildTempFilename(designName: string | undefined, timestamp: number): string {
  return `${TEMP_FILE_PREFIX}${safeDesignSlug(designName)}-${timestamp}.html`;
}

export interface CleanupDeps {
  readdir: (dir: string) => Promise<string[]>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
  unlink: (path: string) => Promise<void>;
  now: () => number;
}

export async function cleanupOldTempFiles(
  dir: string,
  deps: CleanupDeps,
  maxAgeMs: number = TEMP_FILE_MAX_AGE_MS,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await deps.readdir(dir);
  } catch {
    return [];
  }
  const cutoff = deps.now() - maxAgeMs;
  const removed: string[] = [];
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TEMP_FILE_PREFIX) && name.endsWith('.html'))
      .map(async (name) => {
        const full = join(dir, name);
        try {
          const info = await deps.stat(full);
          if (info.mtimeMs < cutoff) {
            await deps.unlink(full);
            removed.push(full);
          }
        } catch {
          // Ignore stat/unlink failures for cleanup; not fatal.
        }
      }),
  );
  return removed;
}

const liveCleanupDeps: CleanupDeps = {
  readdir: (dir) => readdir(dir),
  stat: async (path) => {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs };
  },
  unlink: (path) => unlink(path),
  now: () => Date.now(),
};

export function registerShareIpc(): void {
  ipcMain.handle(
    'share:v1:openInBrowser',
    async (_evt, raw: unknown): Promise<ShareOpenInBrowserResponse> => {
      const req = parseShareRequest(raw);
      const tempDir = app.getPath('temp');

      // Best-effort cleanup of stale share files; failures must not block sharing
      // but should surface in logs so silent disk-fill regressions stay visible.
      await cleanupOldTempFiles(tempDir, liveCleanupDeps).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[share] cleanup of stale temp files failed: ${message}`);
      });

      const filename = buildTempFilename(req.designName, Date.now());
      const filepath = join(tempDir, filename);

      try {
        await writeFile(filepath, req.html, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CodesignError(`Failed to write share file: ${message}`, 'SHARE_WRITE_FAILED');
      }

      // Use openExternal with a file:// URL so the OS dispatches via the default
      // browser handler. shell.openPath would honor the .html file association,
      // which on many machines points to editors (e.g. VS Code) instead of a browser.
      try {
        await shell.openExternal(pathToFileURL(filepath).toString());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CodesignError(
          `Failed to open share file in browser: ${message}`,
          'SHARE_OPEN_FAILED',
        );
      }

      return { ok: true, filepath };
    },
  );
}
