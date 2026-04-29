import { open, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  AttachmentContext,
  ReferenceUrlContext,
  WorkspaceContext,
  WorkspaceContextFile,
} from '@open-codesign/core';
import {
  CodesignError,
  ERROR_CODES,
  type LocalInputFile,
  type StoredDesignSystem,
} from '@open-codesign/shared';
import { importDesignSystemFromFigma } from './design-system-import';

const TEXT_EXTS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mjs',
  '.scss',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const MAX_ATTACHMENT_CHARS = 1_200;
const MAX_TEXT_ATTACHMENT_BYTES = 256_000;
const MAX_BINARY_ATTACHMENT_BYTES = 10_000_000; // 10MB - images get full read for data URL, non-image binary only needs filename
const MAX_URL_EXCERPT_CHARS = 500;
const MAX_URL_RESPONSE_BYTES = 256_000;
const REFERENCE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const FIGMA_CONTEXT_MAX_CHARS = 1_600;
const MAX_WORKSPACE_SCAN_ENTRIES = 800;
const MAX_WORKSPACE_FILES = 6;
const MAX_WORKSPACE_FILE_BYTES = 128_000;
const MAX_WORKSPACE_FILE_CHARS = 500;
const MAX_WORKSPACE_TOTAL_CHARS = 2_400;

const WORKSPACE_TEXT_EXTS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mdx',
  '.mjs',
  '.scss',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const WORKSPACE_SKIP_DIRS = new Set([
  '.cache',
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.output',
  '.pnpm-store',
  '.storybook',
  '.turbo',
  '.vercel',
  '.vscode',
  '__mocks__',
  '__snapshots__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'out',
  'storybook-static',
  'temp',
  'tmp',
]);

const FIGMA_REPLICA_PROMPT_PREFIX = [
  'Figma frame context is attached for this request. Treat that frame as the source of truth.',
  'Required workflow:',
  '1. Use the extracted Figma layout, copy, assets, and design-system cues before writing code.',
  '2. Recreate the same hierarchy, spacing, typography, colors, and imagery in responsive HTML/CSS.',
  '3. Keep copy and component relationships faithful to the frame unless the user explicitly asks for a change.',
  '4. Make the result responsive after the frame match is correct; do not invent a different concept or random style direction.',
].join('\n');

type PromptImageContext = {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
};

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaFill {
  type?: string;
  color?: FigmaColor;
  imageRef?: string;
  gradientStops?: Array<{ color?: FigmaColor; position?: number }>;
}

interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
}

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  characters?: string;
  fills?: FigmaFill[];
  strokes?: FigmaFill[];
  backgroundColor?: FigmaColor;
  style?: FigmaTypeStyle;
  cornerRadius?: number;
  itemSpacing?: number;
  layoutMode?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  visible?: boolean;
  children?: FigmaNode[];
}

interface FigmaReferenceInspection {
  referenceUrl: ReferenceUrlContext;
  promptImages: PromptImageContext[];
  designSystem: StoredDesignSystem | null;
  referencePromptPrefix: string;
}

function isFigmaUrl(url: string): boolean {
  return /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\//i.test(url);
}

function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } | null {
  const match = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/i);
  if (!match?.[1]) return null;
  const nodeId = new URL(url).searchParams.get('node-id');
  return { fileKey: match[1], nodeId };
}

function figmaColorToHex(color: FigmaColor): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function figmaColorToRgba(color: FigmaColor): string {
  const alpha = color.a ?? 1;
  if (alpha === 1) return figmaColorToHex(color);
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha.toFixed(2)})`;
}

function pushUnique(target: string[], value: string, max: number): void {
  if (!value || target.includes(value) || target.length >= max) return;
  target.push(value);
}

function truncateForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

async function fetchFigmaReferenceInspection(url: string): Promise<FigmaReferenceInspection> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    return {
      referenceUrl: {
        url,
        title: 'Figma reference',
        description: 'A Figma frame was provided. Match it closely instead of inventing a new direction.',
      },
      promptImages: [],
      designSystem: null,
      referencePromptPrefix: FIGMA_REPLICA_PROMPT_PREFIX,
    };
  }

  const apiKey = process.env['MCP_FIGMA_API_KEY'];
  if (!apiKey) {
    return {
      referenceUrl: {
        url,
        title: 'Figma reference',
        description:
          'A Figma frame was provided, but live Figma extraction is unavailable because MCP_FIGMA_API_KEY is not configured.',
        excerpt:
          'Do not invent a new visual direction. Treat the linked Figma frame as the source of truth and stay as close as possible to its structure and styling.',
      },
      promptImages: [],
      designSystem: null,
      referencePromptPrefix: FIGMA_REPLICA_PROMPT_PREFIX,
    };
  }

  let designSystem: StoredDesignSystem | null = null;
  try {
    designSystem = await importDesignSystemFromFigma(url);
  } catch {
    designSystem = null;
  }

  try {
    const depth = parsed.nodeId ? 6 : 4;
    const fileUrl = parsed.nodeId
      ? `https://api.figma.com/v1/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}&depth=${depth}`
      : `https://api.figma.com/v1/files/${parsed.fileKey}?depth=${depth}`;

    const response = await fetch(fileUrl, {
      headers: { 'X-Figma-Token': apiKey },
    });
    if (!response.ok) throw new Error(`Figma API ${response.status}`);

    const fileData = (await response.json()) as Record<string, unknown>;
    const fileName = (fileData['name'] as string | undefined) ?? parsed.fileKey;
    const nodeKey = parsed.nodeId ? parsed.nodeId.replace(/-/g, ':') : null;
    const nodesMap = fileData['nodes'] as Record<string, { document?: FigmaNode }> | undefined;
    const rootDoc = nodeKey
      ? nodesMap?.[nodeKey]?.document
      : (fileData['document'] as FigmaNode | undefined);

    const layerLines: string[] = [];
    const texts: string[] = [];
    const colors: string[] = [];
    const typography: string[] = [];

    function collectFills(fills: FigmaFill[] | undefined): void {
      if (!fills) return;
      for (const fill of fills) {
        if (fill.color) pushUnique(colors, figmaColorToRgba(fill.color), 24);
        for (const stop of fill.gradientStops ?? []) {
          if (stop.color) pushUnique(colors, figmaColorToRgba(stop.color), 24);
        }
      }
    }

    function walk(node: FigmaNode, depthLevel: number): void {
      if (!node || node.visible === false) return;
      const indent = '  '.repeat(Math.min(depthLevel, 5));
      const bounds = node.absoluteBoundingBox;
      const size = bounds ? ` (${Math.round(bounds.width)}x${Math.round(bounds.height)})` : '';
      const radius = typeof node.cornerRadius === 'number' ? ` radius=${node.cornerRadius}` : '';
      const spacing = typeof node.itemSpacing === 'number' ? ` gap=${node.itemSpacing}` : '';
      const padding =
        node.paddingTop !== undefined
          ? ` pad=${node.paddingTop}/${node.paddingRight ?? 0}/${node.paddingBottom ?? 0}/${node.paddingLeft ?? 0}`
          : '';

      if (node.type === 'TEXT' && node.characters) {
        layerLines.push(`${indent}TEXT: "${node.characters.slice(0, 72)}"${size}`);
        pushUnique(texts, node.characters.trim(), 12);
        if (node.style?.fontFamily) {
          const styleLine = `${node.style.fontFamily} ${node.style.fontWeight ?? '?'} - ${node.style.fontSize ?? '?'}px`;
          pushUnique(typography, styleLine, 8);
        }
      } else if (node.type) {
        const layout = node.layoutMode ? ` layout=${node.layoutMode}` : '';
        layerLines.push(`${indent}${node.type}: ${node.name ?? ''}${layout}${spacing}${padding}${size}${radius}`.trim());
      }

      collectFills(node.fills);
      if (node.backgroundColor) pushUnique(colors, figmaColorToRgba(node.backgroundColor), 24);

      for (const child of node.children ?? []) {
        walk(child, depthLevel + 1);
      }
    }

    if (rootDoc) walk(rootDoc, 0);

    let screenshot: PromptImageContext[] = [];
    const screenshotNodeId = parsed.nodeId ?? rootDoc?.id ?? null;
    if (screenshotNodeId) {
      const screenshotId = screenshotNodeId.replace(/-/g, ':');
      const imageRes = await fetch(
        `https://api.figma.com/v1/images/${parsed.fileKey}?ids=${encodeURIComponent(screenshotId)}&format=jpg&scale=0.5`,
        { headers: { 'X-Figma-Token': apiKey } },
      );
      if (imageRes.ok) {
        const imageData = (await imageRes.json()) as { images?: Record<string, string> };
        const screenshotUrl = imageData.images?.[screenshotId];
        if (typeof screenshotUrl === 'string' && screenshotUrl.length > 0) {
          const binaryRes = await fetch(screenshotUrl);
          if (binaryRes.ok) {
            const buffer = await binaryRes.arrayBuffer();
            if (buffer.byteLength < 600_000) {
              screenshot = [{
                data: Buffer.from(buffer).toString('base64'),
                mimeType: 'image/jpeg',
              }];
            }
          }
        }
      }
    }

    const excerptLines = [
      `File: ${fileName}`,
      ...(parsed.nodeId ? [`Frame node: ${parsed.nodeId}`] : []),
      '',
      'Required interpretation order: screenshot -> layout structure -> copy -> design system cues.',
      '',
      '=== Layout Structure ===',
      ...layerLines.slice(0, 28),
    ];

    if (texts.length > 0) {
      excerptLines.push('', '=== Copy ===', ...texts.slice(0, 8).map((text) => `- ${text.slice(0, 120)}`));
    }
    if (typography.length > 0) {
      excerptLines.push('', '=== Typography ===', ...typography.map((item) => `- ${item}`));
    }
    if (colors.length > 0) {
      excerptLines.push('', '=== Colors ===', ...colors.slice(0, 8).map((item) => `- ${item}`));
    }
    if (designSystem) {
      excerptLines.push('', '=== Auto-extracted Design System ===', designSystem.summary);
    }

    return {
      referenceUrl: {
        url,
        title: fileName,
        description:
          'Figma frame reference. Match the linked frame faithfully before making responsive adaptations.',
        excerpt: truncateForPrompt(excerptLines.join('\n'), FIGMA_CONTEXT_MAX_CHARS),
      },
      promptImages: screenshot,
      designSystem,
      referencePromptPrefix: FIGMA_REPLICA_PROMPT_PREFIX,
    };
  } catch {
    return {
      referenceUrl: {
        url,
        title: 'Figma reference',
        description:
          'A Figma frame was provided. Use it as the source of truth even though live extraction failed for this run.',
        excerpt:
          'Stay as close as possible to the linked frame. Preserve structure, copy hierarchy, spacing rhythm, and visual language instead of inventing a fresh design direction.',
      },
      promptImages: [],
      designSystem,
      referencePromptPrefix: FIGMA_REPLICA_PROMPT_PREFIX,
    };
  }
}

interface WorkspaceCandidate {
  absolutePath: string;
  relativePath: string;
  size: number;
  score: number;
}

function cleanText(raw: string, maxChars: number): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProbablyText(buffer: Buffer, extension: string): boolean {
  if (TEXT_EXTS.has(extension)) return true;
  const probe = buffer.subarray(0, 512);
  return !probe.includes(0);
}

function normalizeWorkspaceRelativePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function shouldSkipWorkspaceDir(name: string): boolean {
  return WORKSPACE_SKIP_DIRS.has(name.toLowerCase());
}

function shouldIncludeWorkspaceFile(relativePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  const extension = extname(lower);
  if (!WORKSPACE_TEXT_EXTS.has(extension)) return false;
  if (/(^|\/)(?:__tests__|__mocks__|fixtures)\//.test(lower)) return false;
  if (/\.(?:test|spec|stories)\.[^/.]+$/.test(lower)) return false;
  if (/(?:^|\/)[^.][^/]*\.min\.[^/.]+$/.test(lower)) return false;
  if (lower.endsWith('.map')) return false;
  return true;
}

function scoreWorkspaceFile(relativePath: string): number {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  const segments = normalized.split('/');
  let score = 0;

  if (lower === 'package.json') score += 120;
  if (lower.endsWith('/package.json')) score += 90;
  if (/(^|\/)readme(?:\.[a-z0-9]+)?$/.test(lower)) score += 110;
  if (/(tailwind|theme|token|design-system|brand|palette|typography|spacing|radius|shadow)/.test(lower)) {
    score += 95;
  }
  if (/(^|\/)(?:src\/)?(?:app|pages|components|styles|tokens)\//.test(lower)) score += 75;
  if (/(^|\/)(?:app|layout|index|main|home)\.(?:tsx?|jsx?|html|mdx?)$/.test(lower)) score += 80;
  if (/\.(?:tsx?|jsx|css|scss|html|md|mdx)$/.test(lower)) score += 45;
  if (/\.(?:json|ya?ml|txt|svg)$/.test(lower)) score += 20;
  if (/lock|pnpm-lock|package-lock|yarn\.lock/.test(lower)) score -= 80;
  if (/(^|\/)assets\//.test(lower)) score -= 20;
  score -= segments.length * 3;

  return score;
}

async function collectWorkspaceCandidates(rootPath: string): Promise<{
  candidates: WorkspaceCandidate[];
  candidateCount: number;
  truncated: boolean;
}> {
  const candidates: WorkspaceCandidate[] = [];
  let visited = 0;
  let truncated = false;

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    if (visited >= MAX_WORKSPACE_SCAN_ENTRIES) {
      truncated = true;
      return;
    }

    try {
      const entries = await readdir(absoluteDir, { encoding: 'utf8', withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (visited >= MAX_WORKSPACE_SCAN_ENTRIES) {
          truncated = true;
          return;
        }
        visited += 1;

        const absolutePath = join(absoluteDir, entry.name);
        const relativePath = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (shouldSkipWorkspaceDir(entry.name)) continue;
          await walk(absolutePath, relativePath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!shouldIncludeWorkspaceFile(relativePath)) continue;

        let size = 0;
        try {
          size = (await stat(absolutePath)).size;
        } catch {
          continue;
        }

        candidates.push({
          absolutePath,
          relativePath: normalizeWorkspaceRelativePath(relativePath),
          size,
          score: scoreWorkspaceFile(relativePath),
        });
      }
    } catch {
      return;
    }
  }

  await walk(rootPath, '');
  return {
    candidates,
    candidateCount: candidates.length,
    truncated,
  };
}

async function readWorkspaceFileExcerpt(
  candidate: WorkspaceCandidate,
  maxChars: number,
): Promise<WorkspaceContextFile | null> {
  const extension = extname(candidate.relativePath).toLowerCase();
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(candidate.absolutePath, 'r');
    const probeBuffer = Buffer.alloc(512);
    const { bytesRead: probeRead } = await handle.read(probeBuffer, 0, 512, 0);
    const probe = probeBuffer.subarray(0, probeRead);
    if (!isProbablyText(probe, extension)) return null;

    const bytesToRead = Math.max(1, Math.min(candidate.size || MAX_WORKSPACE_FILE_BYTES, MAX_WORKSPACE_FILE_BYTES));
    const fullBuffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(fullBuffer, 0, fullBuffer.length, 0);
    const excerpt = cleanText(fullBuffer.subarray(0, bytesRead).toString('utf8'), maxChars);
    if (excerpt.length === 0) return null;

    const noteParts: string[] = [];
    if (candidate.size > bytesToRead) noteParts.push('Large file; excerpt sampled from the start.');
    if (excerpt.length >= maxChars) noteParts.push('Excerpt trimmed for prompt budget.');

    return {
      path: candidate.relativePath,
      excerpt,
      ...(noteParts.length > 0 ? { note: noteParts.join(' ') } : {}),
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

function summarizeWorkspaceContext(input: {
  files: WorkspaceContextFile[];
  candidateCount: number;
  truncated: boolean;
}): string {
  const topDirs = new Set(
    input.files
      .map((file) => file.path.split('/').slice(0, -1).join('/'))
      .filter((dir) => dir.length > 0)
      .slice(0, 4),
  );
  const dirSummary = topDirs.size > 0 ? ` Focused on ${[...topDirs].join(', ')}.` : '';
  const scanNote = input.truncated ? ' Directory scan hit a safety cap.' : '';
  return `Sampled ${input.files.length} workspace files from ${input.candidateCount} relevant text files.${dirSummary}${scanNote}`.trim();
}

async function readWorkspaceContext(
  workspacePath: string | null | undefined,
): Promise<WorkspaceContext | null> {
  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) return null;

  const rootPath = workspacePath.trim();
  const { candidates, candidateCount, truncated } = await collectWorkspaceCandidates(rootPath);
  if (candidateCount === 0) return null;

  const ranked = [...candidates].sort(
    (a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath),
  );

  const files: WorkspaceContextFile[] = [];
  let remainingChars = MAX_WORKSPACE_TOTAL_CHARS;
  for (const candidate of ranked) {
    if (files.length >= MAX_WORKSPACE_FILES || remainingChars < 300) break;
    const excerptChars = Math.min(MAX_WORKSPACE_FILE_CHARS, remainingChars);
    const file = await readWorkspaceFileExcerpt(candidate, excerptChars);
    if (!file) continue;
    files.push(file);
    remainingChars -= file.excerpt.length;
  }

  if (files.length === 0) return null;

  return {
    rootPath,
    summary: summarizeWorkspaceContext({ files, candidateCount, truncated }),
    files,
  };
}

async function readAttachment(file: LocalInputFile): Promise<AttachmentContext> {
  const extension = extname(file.name).toLowerCase();
  const imageMimeType = IMAGE_MIME_TYPES[extension];

  // Binary attachments (images, etc) - images need full content for data URL
  // So allow larger size limit than text
  const isKnownTextExtension = TEXT_EXTS.has(extension);
  const maxFileBytes = isKnownTextExtension
    ? MAX_TEXT_ATTACHMENT_BYTES
    : MAX_BINARY_ATTACHMENT_BYTES;
  if (file.size > maxFileBytes) {
    throw new CodesignError(
      isKnownTextExtension
        ? `Text attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_TEXT_ATTACHMENT_BYTES} bytes.`
        : `Binary attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_BINARY_ATTACHMENT_BYTES / 1_000_000}MB.`,
      ERROR_CODES.ATTACHMENT_TOO_LARGE,
    );
  }

  let buffer: Buffer;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file.path, 'r');

    // Always read a small probe first to detect if it's actually text
    const probeBytes = 512;
    const probeBuffer = Buffer.alloc(probeBytes);
    const { bytesRead: probeRead } = await handle.read(probeBuffer, 0, probeBytes, 0);
    const probe = probeBuffer.subarray(0, probeRead);

    const looksText = isProbablyText(probe, extension);
    if (looksText && file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      // Any file that looks like text must obey the text size limit regardless of extension
      throw new CodesignError(
        `Text attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_TEXT_ATTACHMENT_BYTES} bytes.`,
        ERROR_CODES.ATTACHMENT_TOO_LARGE,
      );
    }

    if (!looksText) {
      if (imageMimeType) {
        const length = Math.max(
          1,
          Math.min(file.size || MAX_BINARY_ATTACHMENT_BYTES, maxFileBytes),
        );
        const fullBuffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(fullBuffer, 0, fullBuffer.length, 0);
        buffer = fullBuffer.subarray(0, bytesRead);
      } else {
        // Non-image binary files stay filename-only for now.
        buffer = probe;
      }
    } else {
      // It looks like text and fits within limit - read the whole thing
      const length = Math.max(
        1,
        Math.min(file.size || MAX_TEXT_ATTACHMENT_BYTES, MAX_TEXT_ATTACHMENT_BYTES),
      );
      const fullBuffer = Buffer.alloc(length);
      // Read from start (we already have the probe, but just re-read for simplicity)
      const { bytesRead } = await handle.read(fullBuffer, 0, fullBuffer.length, 0);
      buffer = fullBuffer.subarray(0, bytesRead);
    }
  } catch (error) {
    if (error instanceof CodesignError) {
      // Already a properly coded error - rethrow directly
      throw error;
    }
    throw new CodesignError(
      `Failed to read attachment "${file.path}"`,
      ERROR_CODES.ATTACHMENT_READ_FAILED,
      {
        cause: error,
      },
    );
  } finally {
    await handle?.close();
  }

  if (!isProbablyText(buffer, extension)) {
    if (imageMimeType) {
      return {
        name: file.name,
        path: file.path,
        note: 'Attached as an image input. Use the visual content directly, not just the filename.',
        mediaType: imageMimeType,
        imageDataUrl: `data:${imageMimeType};base64,${buffer.toString('base64')}`,
      };
    }
    return {
      name: file.name,
      path: file.path,
      note: `Binary or unsupported format (${extension || 'unknown'}). Use the filename as a hint, not quoted content.`,
    };
  }

  const fullText = buffer.toString('utf8');
  return {
    name: file.name,
    path: file.path,
    excerpt: cleanText(fullText, MAX_ATTACHMENT_CHARS),
    note:
      Buffer.byteLength(fullText, 'utf8') > MAX_ATTACHMENT_CHARS
        ? 'Excerpt truncated to the most relevant leading content.'
        : undefined,
  };
}

async function readResponseText(response: Response, url: string): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_URL_RESPONSE_BYTES) {
    throw new CodesignError(
      `Reference URL response is too large (${contentLength} bytes) for ${url}`,
      ERROR_CODES.REFERENCE_URL_TOO_LARGE,
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_URL_RESPONSE_BYTES) {
      throw new CodesignError(
        `Reference URL response is too large for ${url}`,
        ERROR_CODES.REFERENCE_URL_TOO_LARGE,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_URL_RESPONSE_BYTES) {
        throw new CodesignError(
          `Reference URL response is too large for ${url}`,
          ERROR_CODES.REFERENCE_URL_TOO_LARGE,
        );
      }

      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function inspectReferenceUrl(url: string): Promise<ReferenceUrlContext> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'open-codesign/0.0.0 (+local desktop app)' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodesignError(
        `Reference URL fetch failed (${response.status}) for ${url}`,
        ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      );
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!REFERENCE_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      throw new CodesignError(
        `Unsupported reference URL content type "${contentType || 'unknown'}" for ${url}`,
        ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
      );
    }

    const html = await readResponseText(response, url);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];

    return {
      url,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      excerpt: cleanText(stripHtml(html), MAX_URL_EXCERPT_CHARS),
    };
  } catch (error) {
    if (error instanceof CodesignError) throw error;
    const code =
      error instanceof Error && error.name === 'AbortError'
        ? 'REFERENCE_URL_FETCH_TIMEOUT'
        : 'REFERENCE_URL_FETCH_FAILED';
    const message =
      code === 'REFERENCE_URL_FETCH_TIMEOUT'
        ? `Reference URL request timed out for ${url}`
        : `Failed to fetch reference URL ${url}`;
    throw new CodesignError(message, code, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export interface PreparedPromptContext {
  designSystem: StoredDesignSystem | null;
  workspaceContext: WorkspaceContext | null;
  attachments: AttachmentContext[];
  referenceUrl: ReferenceUrlContext | null;
  referencePromptPrefix?: string | undefined;
  promptImages: PromptImageContext[];
}

export async function preparePromptContext(input: {
  attachments?: LocalInputFile[] | undefined;
  referenceUrl?: string | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  workspacePath?: string | null | undefined;
}): Promise<PreparedPromptContext> {
  const attachments = await Promise.all(
    (input.attachments ?? []).map((file) => readAttachment(file)),
  );
  let referenceUrl: ReferenceUrlContext | null = null;
  let promptImages: PromptImageContext[] = [];
  let referencePromptPrefix: string | undefined;
  let designSystem = input.designSystem ?? null;

  if (typeof input.referenceUrl === 'string' && input.referenceUrl.trim().length > 0) {
    const trimmedReferenceUrl = input.referenceUrl.trim();
    if (isFigmaUrl(trimmedReferenceUrl)) {
      const figmaInspection = await fetchFigmaReferenceInspection(trimmedReferenceUrl);
      referenceUrl = figmaInspection.referenceUrl;
      promptImages = figmaInspection.promptImages;
      referencePromptPrefix = figmaInspection.referencePromptPrefix;
      if (!designSystem) designSystem = figmaInspection.designSystem;
    } else {
      referenceUrl = await inspectReferenceUrl(trimmedReferenceUrl);
    }
  }
  const workspaceContext = await readWorkspaceContext(input.workspacePath);

  return {
    designSystem,
    workspaceContext,
    attachments,
    referenceUrl,
    ...(referencePromptPrefix ? { referencePromptPrefix } : {}),
    promptImages,
  };
}
