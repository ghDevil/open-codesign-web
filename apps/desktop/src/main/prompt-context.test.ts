import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePromptContext } from './prompt-context';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preparePromptContext', () => {
  it('throws a CodesignError when an attachment cannot be read', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'Z:/missing/brief.md', name: 'brief.md', size: 12 }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_READ_FAILED',
    });
  });

  it('throws a CodesignError when a text attachment is too large', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/huge.txt', name: 'huge.txt', size: 300_000 }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  });

  it('allows binary attachments (png) up to 10MB - 500KB png passes', async () => {
    // Binary attachments (images) can be up to 10MB - allowed larger than text
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/image.png', name: 'image.png', size: 543_034 }],
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_READ_FAILED',
    });
    // It fails because the file doesn't exist, but importantly - NOT ATTACHMENT_TOO_LARGE
  });

  it('encodes supported image attachments as data URLs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-image-attachment-'));
    const filePath = path.join(dir, 'shot.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await fs.writeFile(filePath, pngBytes);

    const result = await preparePromptContext({
      attachments: [{ path: filePath, name: 'shot.png', size: pngBytes.length }],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      name: 'shot.png',
      mediaType: 'image/png',
    });
    expect(result.attachments[0]?.imageDataUrl).toBe(
      `data:image/png;base64,${pngBytes.toString('base64')}`,
    );
    expect(result.attachments[0]?.excerpt).toBeUndefined();
  });

  it('throws ATTACHMENT_TOO_LARGE for unknown extension text > 256KB', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-attachment-'));
    const filePath = path.join(dir, 'data.bin');
    const text = 'a'.repeat(300_000);
    await fs.writeFile(filePath, text);

    await expect(
      preparePromptContext({
        attachments: [{ path: filePath, name: 'data.bin', size: Buffer.byteLength(text) }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  });

  it('throws a CodesignError for oversized reference responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>too big</body></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-length': '300000',
          },
        }),
      ),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/reference',
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_TOO_LARGE',
    });
  });

  it('samples relevant workspace files and skips tests and node_modules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-workspace-context-'));
    await fs.mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(dir, '__tests__'), { recursive: true });
    await fs.mkdir(path.join(dir, 'node_modules', 'leftpad'), { recursive: true });

    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'claude-design-clone', dependencies: { react: '^19.0.0' } }, null, 2),
    );
    await fs.writeFile(
      path.join(dir, 'src', 'App.tsx'),
      [
        "export function App() {",
        "  return <main className='app-shell'>Revenue dashboard</main>;",
        '}',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(dir, 'src', 'components', 'Hero.test.tsx'),
      "it('should not be scanned', () => {});",
    );
    await fs.writeFile(
      path.join(dir, 'node_modules', 'leftpad', 'index.js'),
      'module.exports = () => 0;',
    );

    const result = await preparePromptContext({
      workspacePath: dir,
    });

    expect(result.workspaceContext).not.toBeNull();
    expect(result.workspaceContext?.rootPath).toBe(dir);
    const files = result.workspaceContext?.files.map((file) => file.path) ?? [];
    expect(files).toContain('package.json');
    expect(files).toContain('src/App.tsx');
    expect(files.some((file) => file.includes('__tests__'))).toBe(false);
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
    expect(result.workspaceContext?.summary).toContain('workspace files');
  });

  it('returns null workspaceContext when the workspace has no relevant text files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-empty-workspace-'));
    await fs.writeFile(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await preparePromptContext({
      workspacePath: dir,
    });

    expect(result.workspaceContext).toBeNull();
  });

  it('enriches Figma URLs with structured context, screenshot, and design-system cues', async () => {
    vi.stubEnv('MCP_FIGMA_API_KEY', 'figma-test-key');

    const figmaFileResponse = {
      name: 'Marketing Landing',
      document: {
        id: '1:2',
        type: 'FRAME',
        name: 'Hero Frame',
        layoutMode: 'VERTICAL',
        fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.16, b: 0.24, a: 1 } }],
        children: [
          {
            id: '1:3',
            type: 'TEXT',
            name: 'Headline',
            characters: 'Design systems for modern teams',
            style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 48 },
          },
        ],
      },
    };
    const figmaNodesResponse = {
      name: 'Marketing Landing',
      nodes: {
        '1:2': {
          document: figmaFileResponse.document,
        },
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(figmaNodesResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(figmaFileResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ images: { '1:2': 'https://cdn.example.com/figma-frame.jpg' } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const result = await preparePromptContext({
      referenceUrl: 'https://www.figma.com/design/AbCdEf123456/Hero?node-id=1-2',
    });

    expect(result.referenceUrl).toMatchObject({
      url: 'https://www.figma.com/design/AbCdEf123456/Hero?node-id=1-2',
      title: 'Marketing Landing',
    });
    expect(result.referenceUrl?.excerpt).toContain('Layout Structure');
    expect(result.referenceUrl?.excerpt).toContain('Auto-extracted Design System');
    expect(result.referenceUrl?.excerpt).toContain('Required interpretation order');
    expect(result.designSystem?.rootPath).toBe('figma:AbCdEf123456');
    expect(result.referencePromptPrefix).toContain('Treat that frame as the source of truth');
    expect(result.promptImages).toHaveLength(1);
    expect(result.promptImages[0]?.mimeType).toBe('image/jpeg');
  });
});
