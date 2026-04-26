import { describe, expect, it, vi } from 'vitest';
import {
  readWorkspacePreviewSource,
  resolveReferencedWorkspacePreviewPath,
  resolveWorkspacePreviewSource,
  type WorkspacePreviewRead,
} from './workspace-source';

describe('workspace preview source resolution', () => {
  it('resolves HTML source references to sibling JSX files', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
        'index.html',
      ),
    ).toBe('index.jsx');
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!-- artifact source lives in App.tsx -->',
        'screens/index.html',
      ),
    ).toBe('screens/App.tsx');
  });

  it('ignores source-reference-looking strings outside HTML preview files', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        'const marker = "<!-- artifact source lives in other.jsx -->";',
        'App.jsx',
      ),
    ).toBeNull();
  });

  it('reads the referenced source so hub cards, snapshots, and file tabs share one chain', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content:
        path === 'index.html'
          ? '<!doctype html><body><!-- artifact source lives in index.jsx --></body>'
          : 'function App(){ return <main id="real-source">Hi</main>; }',
    }));

    await expect(
      readWorkspacePreviewSource({ designId: 'd1', path: 'index.html', read }),
    ).resolves.toEqual({
      path: 'index.jsx',
      content: 'function App(){ return <main id="real-source">Hi</main>; }',
    });
    expect(read).toHaveBeenCalledWith('d1', 'index.html');
    expect(read).toHaveBeenCalledWith('d1', 'index.jsx');
  });

  it('falls back to the original source when no read API is available', async () => {
    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
      }),
    ).resolves.toEqual({
      path: 'index.html',
      content: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
    });
  });
});
