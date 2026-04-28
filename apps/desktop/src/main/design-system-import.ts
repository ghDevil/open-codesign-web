import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  type StoredDesignSystem,
} from '@open-codesign/shared';
import { scanDesignSystem } from './design-system';

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaFill {
  type?: string;
  color?: FigmaColor;
  gradientStops?: Array<{ color?: FigmaColor; position?: number }>;
}

interface FigmaTextStyle {
  fontFamily?: string;
  fontWeight?: number;
}

interface FigmaStyleEntry {
  name?: string;
  styleType?: string;
}

interface FigmaNode {
  name?: string;
  type?: string;
  fills?: FigmaFill[];
  style?: FigmaTextStyle;
  cornerRadius?: number;
  itemSpacing?: number;
  effects?: Array<{
    type?: string;
    color?: FigmaColor;
    radius?: number;
    offset?: { x: number; y: number };
  }>;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  children?: FigmaNode[];
}

interface FigmaFileResponse {
  name?: string;
  document?: FigmaNode;
  styles?: Record<string, FigmaStyleEntry>;
  components?: Record<string, { name?: string }>;
}

interface GitHubRepoTarget {
  cloneUrl: string;
  repoLabel: string;
  branch?: string;
  subdir?: string;
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

function buildRepoLabel(repoBaseUrl: string, branch?: string, subdir?: string): string {
  if (!branch) return repoBaseUrl;
  const suffix = subdir ? `${branch}/${subdir}` : branch;
  return `${repoBaseUrl}/tree/${suffix}`;
}

function walkFigmaNode(
  node: FigmaNode,
  out: {
    colors: string[];
    fonts: string[];
    spacing: string[];
    radius: string[];
    shadows: string[];
    components: string[];
  },
): void {
  for (const fill of node.fills ?? []) {
    if (fill.color) pushUnique(out.colors, colorToRgba(fill.color), 24);
    for (const stop of fill.gradientStops ?? []) {
      if (stop.color) pushUnique(out.colors, colorToRgba(stop.color), 24);
    }
  }
  if (node.style?.fontFamily) pushUnique(out.fonts, node.style.fontFamily, 16);
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
  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.name) {
    pushUnique(out.components, node.name, 32);
  }
  for (const child of node.children ?? []) {
    walkFigmaNode(child, out);
  }
}

function extractFigmaFileKey(url: string): string | null {
  const match = url.match(/figma\.com\/(?:file|design|board|make)\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

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
  for (const style of Object.values(file.styles ?? {})) {
    if (!style.name) continue;
    if (style.styleType === 'TEXT') pushUnique(out.fonts, `Text style: ${style.name}`, 16);
    if (style.styleType === 'FILL') pushUnique(out.colors, `Color style: ${style.name}`, 24);
  }
  const fileName = file.name ?? fileKey;
  const summaryParts: string[] = [`Imported design system from Figma file "${fileName}".`];
  if (out.colors.length > 0) summaryParts.push(`Colors: ${out.colors.slice(0, 6).join(', ')}.`);
  if (out.fonts.length > 0) summaryParts.push(`Typography: ${out.fonts.slice(0, 4).join(', ')}.`);
  if (out.components.length > 0) {
    summaryParts.push(`Components: ${out.components.slice(0, 8).join(', ')}.`);
  }
  if (out.spacing.length > 0) summaryParts.push(`Spacing cues: ${out.spacing.slice(0, 4).join(', ')}.`);
  if (out.radius.length > 0) summaryParts.push(`Radius cues: ${out.radius.slice(0, 4).join(', ')}.`);
  return {
    schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
    rootPath: `figma:${fileKey}`,
    sourceFiles: [`figma:${fileKey}`, ...out.components.slice(0, 11).map((component) => `component:${component}`)],
    summary: summaryParts.join(' '),
    extractedAt: new Date().toISOString(),
    colors: out.colors,
    fonts: out.fonts,
    spacing: out.spacing,
    radius: out.radius,
    shadows: out.shadows,
    components: out.components,
  };
}

function runGit(
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', rejectPromise);
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(new Error(`git ${args[0]} failed (exit ${code}): ${stderr.slice(0, 600)}`));
    });
  });
}

function runGitClone(
  gitUrl: string,
  dest: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<void> {
  const args = ['clone', '--depth', '1', '--no-tags', '--single-branch'];
  if (options?.branch) args.push('--branch', options.branch);
  args.push(gitUrl, dest);
  return runGit(args, options?.signal).then(() => {});
}

async function resolveTreeUrlSpecifier(
  cloneUrl: string,
  treeSegments: string[],
): Promise<{ branch: string; subdir?: string }> {
  for (let i = treeSegments.length; i >= 1; i -= 1) {
    const branch = treeSegments.slice(0, i).join('/');
    const probe = await runGit(['ls-remote', '--heads', cloneUrl, `refs/heads/${branch}`]);
    if (probe.stdout.trim().length > 0) {
      const subdir = treeSegments.slice(i).join('/');
      return subdir ? { branch, subdir } : { branch };
    }
  }
  const [branch, ...rest] = treeSegments;
  if (!branch) throw new Error('GitHub tree URL is missing a branch name.');
  return rest.length > 0 ? { branch, subdir: rest.join('/') } : { branch };
}

async function parseGitHubRepoTarget(input: string): Promise<GitHubRepoTarget> {
  const trimmed = input.trim();
  const shorthand = trimmed.match(
    /^(?<owner>[^/\s]+)\/(?<repo>[^/\s@:]+)(?:@(?<branch>[^:]+))?(?::(?<subdir>.+))?$/,
  );
  const groups = shorthand?.groups;
  const shorthandOwner = groups?.['owner'];
  const shorthandRepo = groups?.['repo'];
  if (shorthandOwner && shorthandRepo) {
    const repoBaseUrl = `https://github.com/${shorthandOwner}/${shorthandRepo}`;
    const branch = groups?.['branch']?.trim();
    const subdir = groups?.['subdir']?.trim().replace(/^\/+|\/+$/g, '');
    return {
      cloneUrl: `${repoBaseUrl}.git`,
      repoLabel: buildRepoLabel(repoBaseUrl, branch, subdir),
      ...(branch ? { branch } : {}),
      ...(subdir ? { subdir } : {}),
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not a valid repo URL: ${input}`);
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error(`Not a GitHub repo URL: ${input}`);
  }
  const segments = url.pathname
    .replace(/\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length < 2) throw new Error(`Not a valid repo URL: ${input}`);
  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/i, '');
  const repoBaseUrl = `https://github.com/${owner}/${repo}`;
  const cloneUrl = `${repoBaseUrl}.git`;
  if (segments.length === 2) {
    return { cloneUrl, repoLabel: repoBaseUrl };
  }
  if (segments[2] !== 'tree') {
    throw new Error(`Unsupported GitHub URL format: ${input}`);
  }
  const treeSegments = segments.slice(3);
  if (treeSegments.length === 0) {
    throw new Error(`GitHub tree URL is missing a branch name: ${input}`);
  }
  const { branch, subdir } = await resolveTreeUrlSpecifier(cloneUrl, treeSegments);
  return {
    cloneUrl,
    repoLabel: buildRepoLabel(repoBaseUrl, branch, subdir),
    branch,
    ...(subdir ? { subdir } : {}),
  };
}

async function resolveScanRoot(cloneRoot: string, subdir?: string): Promise<string> {
  if (!subdir) return cloneRoot;
  const scanRoot = resolve(cloneRoot, subdir);
  const rel = relative(cloneRoot, scanRoot);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Subdirectory escapes the cloned repository: ${subdir}`);
  }
  try {
    await access(scanRoot);
  } catch {
    throw new Error(`Subdirectory not found in repository: ${subdir}`);
  }
  return scanRoot;
}

export async function importDesignSystemFromGithub(repoUrl: string): Promise<StoredDesignSystem> {
  const target = await parseGitHubRepoTarget(repoUrl);
  const tmpRoot = await mkdtemp(join(tmpdir(), 'ds-import-'));
  const cloneDest = join(tmpRoot, 'repo');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      await runGitClone(target.cloneUrl, cloneDest, {
        ...(target.branch ? { branch: target.branch } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const scanRoot = await resolveScanRoot(cloneDest, target.subdir);
    const snapshot = await scanDesignSystem(scanRoot);
    return {
      ...snapshot,
      rootPath: target.repoLabel,
      summary: snapshot.summary.replace(
        /under [^.]+/,
        `under ${target.repoLabel.replace(/^https:\/\/github\.com\//, '')}`,
      ),
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

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
  const components = (input.components ?? []).slice(0, 32);
  const summaryParts: string[] = [
    input.summary?.trim() || `Manually configured design system${input.name ? ` "${input.name}"` : ''}.`,
  ];
  if (colors.length > 0) summaryParts.push(`Colors: ${colors.slice(0, 6).join(', ')}.`);
  if (fonts.length > 0) summaryParts.push(`Typography: ${fonts.slice(0, 4).join(', ')}.`);
  if (spacing.length > 0) summaryParts.push(`Spacing: ${spacing.slice(0, 4).join(', ')}.`);
  if (radius.length > 0) summaryParts.push(`Radius: ${radius.slice(0, 4).join(', ')}.`);
  if (components.length > 0) summaryParts.push(`Components: ${components.slice(0, 8).join(', ')}.`);
  return {
    schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
    rootPath: `manual:${(input.name ?? 'custom').toLowerCase().replace(/\s+/g, '-')}`,
    sourceFiles: ['manual:user-supplied', ...components.slice(0, 11).map((component) => `component:${component}`)],
    summary: summaryParts.join(' '),
    extractedAt: new Date().toISOString(),
    colors,
    fonts,
    spacing,
    radius,
    shadows,
    components,
  };
}
