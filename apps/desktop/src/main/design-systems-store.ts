import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StoredDesignSystem } from '@open-codesign/shared';

export interface DesignSystemRecord {
  id: string;
  name: string;
  snapshot: StoredDesignSystem;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemsLibrary {
  schemaVersion: 1;
  activeId: string | null;
  items: DesignSystemRecord[];
}

const EMPTY_LIBRARY: DesignSystemsLibrary = {
  schemaVersion: 1,
  activeId: null,
  items: [],
};

function cloneLibrary(library: DesignSystemsLibrary): DesignSystemsLibrary {
  return {
    schemaVersion: 1,
    activeId: library.activeId,
    items: library.items.map((item) => ({ ...item, snapshot: item.snapshot })),
  };
}

function normalizeName(input: string | undefined, snapshot: StoredDesignSystem): string {
  const trimmed = input?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  const root = snapshot.rootPath.trim();
  if (root.startsWith('https://github.com/')) {
    return root.replace('https://github.com/', '');
  }
  if (root.startsWith('figma:')) return `Figma ${root.slice('figma:'.length)}`;
  if (root.startsWith('manual:')) return root.slice('manual:'.length).replace(/-/g, ' ');
  return root;
}

function sanitizeLibrary(raw: unknown): DesignSystemsLibrary {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return cloneLibrary(EMPTY_LIBRARY);
  const record = raw as {
    activeId?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(record.items)
    ? record.items
        .map((item): DesignSystemRecord | null => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
          const row = item as Partial<DesignSystemRecord>;
          if (
            typeof row.id !== 'string' ||
            typeof row.name !== 'string' ||
            typeof row.createdAt !== 'string' ||
            typeof row.updatedAt !== 'string' ||
            typeof row.snapshot !== 'object' ||
            row.snapshot === null
          ) {
            return null;
          }
          return {
            id: row.id,
            name: row.name,
            snapshot: row.snapshot as StoredDesignSystem,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        })
        .filter((item): item is DesignSystemRecord => item !== null)
    : [];
  const activeId =
    typeof record.activeId === 'string' && items.some((item) => item.id === record.activeId)
      ? record.activeId
      : null;
  return {
    schemaVersion: 1,
    activeId,
    items,
  };
}

export async function readDesignSystemsLibrary(path: string): Promise<DesignSystemsLibrary> {
  try {
    const raw = await readFile(path, 'utf8');
    return sanitizeLibrary(JSON.parse(raw) as unknown);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return cloneLibrary(EMPTY_LIBRARY);
    throw err;
  }
}

export async function writeDesignSystemsLibrary(
  path: string,
  library: DesignSystemsLibrary,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(library, null, 2), 'utf8');
}

export function ensureSeededLibrary(
  library: DesignSystemsLibrary,
  activeSnapshot: StoredDesignSystem | null | undefined,
): DesignSystemsLibrary {
  if (library.items.length > 0 || !activeSnapshot) return cloneLibrary(library);
  const now = new Date().toISOString();
  const record: DesignSystemRecord = {
    id: randomUUID(),
    name: normalizeName(undefined, activeSnapshot),
    snapshot: activeSnapshot,
    createdAt: now,
    updatedAt: now,
  };
  return {
    schemaVersion: 1,
    activeId: record.id,
    items: [record],
  };
}

export function createDesignSystemRecord(input: {
  snapshot: StoredDesignSystem;
  name?: string;
}): DesignSystemRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: normalizeName(input.name, input.snapshot),
    snapshot: input.snapshot,
    createdAt: now,
    updatedAt: now,
  };
}

export function addDesignSystem(
  library: DesignSystemsLibrary,
  record: DesignSystemRecord,
  activate = true,
): DesignSystemsLibrary {
  return {
    schemaVersion: 1,
    activeId: activate ? record.id : library.activeId,
    items: [...library.items, record],
  };
}

export function activateDesignSystem(
  library: DesignSystemsLibrary,
  id: string,
): DesignSystemsLibrary {
  if (!library.items.some((item) => item.id === id)) {
    return cloneLibrary(library);
  }
  return {
    schemaVersion: 1,
    activeId: id,
    items: [...library.items],
  };
}

export function removeDesignSystem(
  library: DesignSystemsLibrary,
  id: string,
): DesignSystemsLibrary {
  const items = library.items.filter((item) => item.id !== id);
  const activeId =
    library.activeId === id
      ? (items[0]?.id ?? null)
      : items.some((item) => item.id === library.activeId)
        ? library.activeId
        : null;
  return {
    schemaVersion: 1,
    activeId,
    items,
  };
}

export function getActiveDesignSystem(
  library: DesignSystemsLibrary,
): StoredDesignSystem | null {
  const match = library.items.find((item) => item.id === library.activeId);
  return match?.snapshot ?? null;
}

export function findDesignSystemById(
  library: DesignSystemsLibrary,
  id: string | null | undefined,
): StoredDesignSystem | null {
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  return library.items.find((item) => item.id === id)?.snapshot ?? null;
}
