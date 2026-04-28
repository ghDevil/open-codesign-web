const HOSTED_WORKSPACE_PREFIX = 'hosted://codebase/';
const DEFAULT_HOSTED_WORKSPACE_NAME = 'upload';

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

export function normalizeHostedWorkspaceUploadPath(filePath: string): string | null {
  const segments = filePath
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : null;
}

export function buildHostedWorkspaceDisplayPath(paths: string[]): string {
  for (const path of paths) {
    const normalized = normalizeHostedWorkspaceUploadPath(path);
    if (!normalized) continue;
    return `${HOSTED_WORKSPACE_PREFIX}${sanitizeWorkspaceLabelSegment(normalized)}`;
  }
  return `${HOSTED_WORKSPACE_PREFIX}${DEFAULT_HOSTED_WORKSPACE_NAME}`;
}