import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listScaffoldKinds, loadScaffoldManifest, makeScaffoldTool, runScaffold } from './scaffold';

describe('scaffold tool', () => {
  it('manifest loads and contains at least one entry', async () => {
    const m = await loadScaffoldManifest();
    expect(m.schemaVersion).toBe(1);
    expect(Object.keys(m.scaffolds).length).toBeGreaterThan(0);
  });

  it('listScaffoldKinds returns sorted unique keys', async () => {
    const kinds = await listScaffoldKinds();
    const sorted = [...kinds].sort();
    expect(kinds).toEqual(sorted);
  });

  it('runScaffold copies a known kind into the workspace', async () => {
    const kinds = await listScaffoldKinds();
    expect(kinds.length).toBeGreaterThan(0);
    const wsroot = mkdtempSync(path.join(tmpdir(), 'codesign-ws-'));
    try {
      const result = await runScaffold({
        kind: kinds[0]!,
        destPath: 'frames/test.jsx',
        workspaceRoot: wsroot,
      });
      expect(result.ok).toBe(true);
      expect(result.written?.startsWith(wsroot)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('refuses unknown kinds', async () => {
    const r = await runScaffold({
      kind: 'definitely-not-a-real-scaffold',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
    });
    expect(r.ok).toBe(false);
  });

  it('makeScaffoldTool returns error details when no workspace is attached', async () => {
    const tool = makeScaffoldTool(() => null);
    const kinds = await listScaffoldKinds();
    const result = await tool.execute('call-1', { kind: kinds[0]!, destPath: 'out.jsx' });
    expect(result.details).toMatchObject({ ok: false });
    expect((result.details as { reason: string }).reason).toMatch(/no workspace/i);
    const text = result.content.find((c) => c.type === 'text');
    expect(text && 'text' in text ? text.text : '').toMatch(/no workspace/i);
  });

  it('makeScaffoldTool writes a scaffold into the provided workspace', async () => {
    const kinds = await listScaffoldKinds();
    expect(kinds.length).toBeGreaterThan(0);
    const wsroot = mkdtempSync(path.join(tmpdir(), 'codesign-scaffold-tool-'));
    try {
      const tool = makeScaffoldTool(() => wsroot);
      const result = await tool.execute('call-2', { kind: kinds[0]!, destPath: 'out.jsx' });
      const details = result.details as {
        ok: boolean;
        written?: string;
        bytes?: number;
        kind?: string;
      };
      expect(details.ok).toBe(true);
      expect(details.written?.startsWith(wsroot)).toBe(true);
      expect(details.bytes).toBeGreaterThan(0);
      expect(details.kind).toBe(kinds[0]);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });
});
