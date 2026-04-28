import { extname, join } from 'node:path';

const HOSTED_WORKSPACE_PREFIX = 'hosted://codebase/';
const DEFAULT_HOSTED_WORKSPACE_NAME = 'upload';
const TEXT_WORKSPACE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.csv',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mjs',
  '.mts',
  '.sass',
  '.scss',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

function sanitizeWorkspaceLabelSegment(value: string): string {
  const candidate = value
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.trim().length > 0)[0]
    ?.replace(/[\u0000-\u001f<>:"|?*]/g, '-')
    .trim();
  return candidate && candidate.length > 0
    ? candidate.slice(0, 80)
    : DEFAULT_HOSTED_WORKSPACE_NAME;
}

export function getHostedWorkspaceDiskPath(dataDir: string, designId: string): string {
  return join(dataDir, 'workspaces', designId);
}

export function normalizeUploadedWorkspacePath(filePath: string): string | null {
  const segments = filePath
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : null;
}

export function normalizeHostedWorkspaceLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return `${HOSTED_WORKSPACE_PREFIX}${DEFAULT_HOSTED_WORKSPACE_NAME}`;
  }
  const trimmed = value.trim();
  const rawName = trimmed.startsWith(HOSTED_WORKSPACE_PREFIX)
    ? trimmed.slice(HOSTED_WORKSPACE_PREFIX.length)
    : trimmed;
  return `${HOSTED_WORKSPACE_PREFIX}${sanitizeWorkspaceLabelSegment(rawName)}`;
}

export function isTextWorkspaceFile(filePath: string, mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  if (/(json|javascript|typescript|xml|svg|markdown)/i.test(mimeType)) return true;
  return TEXT_WORKSPACE_EXTENSIONS.has(extname(filePath).toLowerCase());
}