import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigration } from './v01-to-v02';

function makeFakeDb(designs: { id: string; name: string }[]) {
  const designFiles: Array<{ design_id: string; path: string; content: string }> = [
    { design_id: 'd-a', path: 'index.html', content: '<h1>A</h1>' },
  ];
  const chatMessages: Array<{
    design_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }> = [
    { design_id: 'd-a', role: 'user', content: 'hi', created_at: 1 },
    { design_id: 'd-a', role: 'assistant', content: 'hello', created_at: 2 },
  ];
  return {
    prepare: (sql: string) => ({
      all: <T>(...params: unknown[]): T[] => {
        if (sql.startsWith('SELECT id, name, slug, created_at FROM designs')) {
          return designs.map((d) => ({ ...d, slug: null, created_at: 0 })) as unknown as T[];
        }
        if (sql.startsWith('SELECT design_id, path, content FROM design_files')) {
          return designFiles.filter((f) => f.design_id === params[0]) as unknown as T[];
        }
        if (sql.startsWith('SELECT design_id, role, content, created_at FROM chat_messages')) {
          return chatMessages.filter((m) => m.design_id === params[0]) as unknown as T[];
        }
        return [] as unknown as T[];
      },
    }),
    close: () => {},
  };
}

describe('runMigration', () => {
  it('returns zero counts when source DB does not exist', async () => {
    const r = await runMigration({
      sourceDbPath: '/no/such/file.db',
      workspaceRoot: tmpdir(),
      sessionDir: tmpdir(),
    });
    expect(r.attempted).toBe(0);
    expect(r.migrated).toBe(0);
  });

  it('migrates one design end-to-end (in-memory DB stand-in)', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, ''); // existence check only

    try {
      const r = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () => makeFakeDb([{ id: 'd-a', name: 'My Design' }]),
      });
      expect(r.attempted).toBe(1);
      expect(r.migrated).toBe(1);
      expect(r.failed).toEqual([]);
      expect(existsSync(path.join(wsroot, 'my-design', 'index.html'))).toBe(true);
      expect(r.backupPath?.endsWith('.v0.1.backup')).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
