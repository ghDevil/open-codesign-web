/**
 * External design-system importers.
 *
 * Closes the gap with Claude Design's "set up your design system" flow.
 * The renderer can paste a GitHub URL, a Figma file URL, or upload a zip;
 * each is normalized into a StoredDesignSystem snapshot.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  type StoredDesignSystem,
} from '@open-codesign/shared';
import { scanDesignSystem } from './design-system.js';

interface FigmaColor { r: number; g: number; b: number; a?: number }
interface FigmaFill {
  type?: string;
  color?: FigmaColor;
  gradientStops?: Array<{ color?: FigmaColor; position?: number }>;
}

interface FigmaTextStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
}

interface FigmaStyleEntry {
  key?: string;
  name?: string;
  description?: string;
  styleType?: string;
}

interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  fills?: FigmaFill[];
  strokes?: FigmaFill[];
  styles?: Record<string, string>;
  style?: FigmaTextStyle;
  cornerRadius?: number;
  itemSpacing?: number;
  effects?: Array<{ type?: string; color?: FigmaColor; radius?: number; offset?: { x: number; y: number } }>;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  characters?: string;
  children?: FigmaNode[];
  componentPropertyDefinitions?: Record<string, unknown>;
}

interface FigmaFileResponse {
  name?: string;
  document?: FigmaNode;
  styles?: Record<string, FigmaStyleEntry>;
  components?: Record<string, { name?: string; description?: string }>;
}

function colorToHex(c: FigmaColor): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function colorToRgba(c: FigmaColor): string {
  const a = c.a ?? 1;
  if (a === 1) return colorToHex(c);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a.toFixed(2)})`;
}

function pushUnique(target: string[], value: string, max: number): void {
  if (!value || target.includes(value) || target.length >= max) return;
  target.push(value);
}

function walkFigmaNode(
  node: FigmaNode,
  out: { colors: string[]; fonts: string[]; spacing: string[]; radius: string[]; shadows: string[]; components: string[] },
): void {
  if (!node) return;

  for (const fill of node.fills ?? []) {
    if (fill.color) pushUnique(out.colors, colorToRgba(fill.color), 24);
    for (const stop of fill.gradientStops ?? []) {
      if (stop.color) pushUnique(out.colors, colorToRgba(stop.color), 24);
    }
  }

  if (node.style?.fontFamily) {
    pushUnique(out.fonts, node.style.fontFamily, 16);
  }

  if (typeof node.itemSpacing === 'number' && node.itemSpacing > 0) {
    pushUnique(out.spacing, `${node.itemSpacing}px`, 16);
  }

  for (const pad of [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]) {
    if (typeof pad === 'number' && pad > 0) pushUnique(out.spacing, `${pad}px`, 16);
  }

  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    pushUnique(out.radius, `${node.cornerRadius}px`, 16);
  }

  for (const effect of node.effects ?? []) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const offset = effect.offset ?? { x: 0, y: 0 };
      const blur = effect.radius ?? 0;
      const color = effect.color ? colorToRgba(effect.color) : 'rgba(0,0,0,0.2)';
      pushUnique(out.shadows, `${offset.x}px ${offset.y}px ${blur}px ${color}`, 16);
    }
  }

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    if (node.name) pushUnique(out.components, node.name, 32);
  }

  for (const child of node.children ?? []) {
    walkFigmaNode(child, out);
  }
}

/** Parse "https://www.figma.com/file/<key>/..." or "/design/<key>/..." into a file key. */
function extractFigmaFileKey(url: string): string | null {
  const m = url.match(/figma\.com\/(?:file|design|board|make)\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

/** Build a StoredDesignSystem by reading a Figma file via the REST API. */
export async function importDesignSystemFromFigma(figmaUrl: string): Promise<StoredDesignSystem> {
  const apiKey = process.env['MCP_FIGMA_API_KEY'];
  if (!apiKey) {
    throw new Error('MCP_FIGMA_API_KEY environment variable is not configured.');
  }
  const fileKey = extractFigmaFileKey(figmaUrl);
  if (!fileKey) {
    throw new Error(`Not a recognizable figma.com URL: ${figmaUrl}`);
  }

  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=4`, {
    headers: { 'X-Figma-Token': apiKey },
  });
  if (!response.ok) {
    throw new Error(`Figma API ${response.status}: ${await response.text()}`);
  }
  const file = (await response.json()) as FigmaFileResponse;

  const out = {
    colors: [] as string[],
    fonts: [] as string[],
    spacing: [] as string[],
    radius: [] as string[],
    shadows: [] as string[],
    components: [] as string[],
  };

  if (file.document) walkFigmaNode(file.document, out);

  for (const entry of Object.values(file.components ?? {})) {
    if (entry.name) pushUnique(out.components, entry.name, 32);
  }

  // Figma's style references (key → entry) — names give intent (e.g. "Brand/Primary").
  for (const style of Object.values(file.styles ?? {})) {
    if (!style.name) continue;
    if (style.styleType === 'TEXT') pushUnique(out.fonts, `Text style: ${style.name}`, 16);
    if (style.styleType === 'FILL') pushUnique(out.colors, `Color style: ${style.name}`, 24);
  }

  const fileName = file.name ?? fileKey;
  const summaryParts: string[] = [
    `Imported design system from Figma file "${fileName}".`,
  ];
  if (out.colors.length > 0) summaryParts.push(`Colors: ${out.colors.slice(0, 6).join(', ')}.`);
  if (out.fonts.length > 0) summaryParts.push(`Typography: ${out.fonts.slice(0, 4).join(', ')}.`);
  if (out.components.length > 0) summaryParts.push(`Components: ${out.components.slice(0, 8).join(', ')}.`);
  if (out.spacing.length > 0) summaryParts.push(`Spacing cues: ${out.spacing.slice(0, 4).join(', ')}.`);
  if (out.radius.length > 0) summaryParts.push(`Radius cues: ${out.radius.slice(0, 4).join(', ')}.`);

  return {
    schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
    rootPath: `figma:${fileKey}`,
    sourceFiles: [`figma:${fileKey}`, ...out.components.slice(0, 11).map((c) => `component:${c}`)],
    summary: summaryParts.join(' '),
    extractedAt: new Date().toISOString(),
    colors: out.colors,
    fonts: out.fonts,
    spacing: out.spacing,
    radius: out.radius,
    shadows: out.shadows,
  };
}

function runGitClone(gitUrl: string, dest: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['clone', '--depth', '1', '--no-tags', '--single-branch', gitUrl, dest], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`git clone failed (exit ${code}): ${stderr.slice(0, 600)}`));
    });
  });
}

/** Build a StoredDesignSystem by shallow-cloning a public GitHub repo and scanning it. */
export async function importDesignSystemFromGithub(repoUrl: string): Promise<StoredDesignSystem> {
  // Accept "owner/repo", "owner/repo@branch", "https://github.com/owner/repo[.git][/]", or "https://github.com/owner/repo/tree/branch"
  let cloneUrl = repoUrl.trim();
  if (/^[^/\s]+\/[^/\s@]+(@[\w./-]+)?$/.test(cloneUrl) && !cloneUrl.startsWith('http')) {
    cloneUrl = `https://github.com/${cloneUrl}`;
  }
  cloneUrl = cloneUrl.replace(/\/tree\/[^/]+\/?$/, '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(cloneUrl)) {
    throw new Error(`Not a valid repo URL: ${repoUrl}`);
  }
  if (!cloneUrl.endsWith('.git')) cloneUrl = `${cloneUrl}.git`;

  const tmpRoot = await mkdtemp(join(tmpdir(), 'ds-import-'));
  const cloneDest = join(tmpRoot, 'repo');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      await runGitClone(cloneUrl, cloneDest, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    const snapshot = await scanDesignSystem(cloneDest);

    // Replace the on-disk temp path with the original repo URL so the user-facing summary stays meaningful.
    const repoLabel = cloneUrl.replace(/\.git$/, '');
    return {
      ...snapshot,
      rootPath: repoLabel,
      summary: snapshot.summary.replace(/under [^.]+/, `under ${repoLabel.split('/').slice(-2).join('/')}`),
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/** Build a StoredDesignSystem from raw user-supplied tokens (for "manual" setup mode). */
export function importDesignSystemFromManual(input: {
  name?: string;
  summary?: string;
  colors?: string[];
  fonts?: string[];
  spacing?: string[];
  radius?: string[];
  shadows?: string[];
  components?: string[];
}): StoredDesignSystem {
  const colors = (input.colors ?? []).slice(0, 24);
  const fonts = (input.fonts ?? []).slice(0, 16);
  const spacing = (input.spacing ?? []).slice(0, 16);
  const radius = (input.radius ?? []).slice(0, 16);
  const shadows = (input.shadows ?? []).slice(0, 16);
  const summaryParts: string[] = [
    input.summary?.trim() ||
      `Manually configured design system${input.name ? ` "${input.name}"` : ''}.`,
  ];
  if (colors.length > 0) summaryParts.push(`Colors: ${colors.slice(0, 6).join(', ')}.`);
  if (fonts.length > 0) summaryParts.push(`Typography: ${fonts.slice(0, 4).join(', ')}.`);
  if (spacing.length > 0) summaryParts.push(`Spacing: ${spacing.slice(0, 4).join(', ')}.`);
  if (radius.length > 0) summaryParts.push(`Radius: ${radius.slice(0, 4).join(', ')}.`);

  return {
    schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
    rootPath: `manual:${(input.name ?? 'custom').toLowerCase().replace(/\s+/g, '-')}`,
    sourceFiles: ['manual:user-supplied', ...(input.components ?? []).slice(0, 11).map((c) => `component:${c}`)],
    summary: summaryParts.join(' '),
    extractedAt: new Date().toISOString(),
    colors,
    fonts,
    spacing,
    radius,
    shadows,
  };
}
