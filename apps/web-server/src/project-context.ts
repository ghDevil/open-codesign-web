import type { WorkspaceContext, WorkspaceContextFile } from '@open-codesign/core';
import type BetterSqlite3 from 'better-sqlite3';

interface DesignFileRow {
  path: string;
  content: string;
}

const MAX_WORKSPACE_FILES = 6;
const MAX_WORKSPACE_TOTAL_CHARS = 12_000;
const MAX_WORKSPACE_FILE_CHARS = 3_000;

const OMITTED_SEGMENTS = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules']);
const OMITTED_FILE_PATTERN =
  /\.(avif|gif|ico|jpe?g|mp4|otf|pdf|png|ttf|webm|webp|woff2?)$/i;

function isRelevantDesignFilePath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  if (OMITTED_FILE_PATTERN.test(normalized)) return false;
  if (normalized.includes('.spec.') || normalized.includes('.test.')) return false;
  return normalized.split('/').every((segment) => !OMITTED_SEGMENTS.has(segment));
}

function rankDesignFile(row: DesignFileRow): number {
  const normalized = row.path.replaceAll('\\', '/').toLowerCase();
  let score = 0;
  if (normalized === 'index.html') score += 100;
  if (normalized.endsWith('/index.html')) score += 90;
  if (normalized.endsWith('design.md')) score += 80;
  if (normalized.endsWith('readme.md')) score += 70;
  if (!normalized.includes('/')) score += 30;
  if (normalized.startsWith('src/')) score += 20;
  if (normalized.startsWith('styles/')) score += 15;
  if (normalized.includes('/components/')) score += 15;
  if (/\.(html|css|md)$/.test(normalized)) score += 20;
  if (/\.(ts|tsx|js|jsx|json)$/.test(normalized)) score += 15;
  return score;
}

function excerptDesignFile(
  row: DesignFileRow,
  maxChars: number,
): WorkspaceContextFile | null {
  const excerptSource = row.content.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (excerptSource.length === 0) return null;

  const noteParts: string[] = [];
  let excerpt = excerptSource;
  if (excerpt.length > maxChars) {
    excerpt = excerpt.slice(0, maxChars).trimEnd();
    noteParts.push('Excerpt trimmed for prompt budget.');
  }

  return {
    path: row.path,
    excerpt,
    ...(noteParts.length > 0 ? { note: noteParts.join(' ') } : {}),
  };
}

function summarizeWorkspaceContext(input: {
  files: WorkspaceContextFile[];
  totalCount: number;
}): string {
  const topDirs = new Set(
    input.files
      .map((file) => file.path.split('/').slice(0, -1).join('/'))
      .filter((dir) => dir.length > 0)
      .slice(0, 4),
  );
  const dirSummary = topDirs.size > 0 ? ` Focused on ${[...topDirs].join(', ')}.` : '';
  return `Sampled ${input.files.length} tracked design files from ${input.totalCount} persisted files.${dirSummary}`;
}

export function buildHostedWorkspaceContext(
  db: BetterSqlite3.Database | null,
  designId: string | null | undefined,
): WorkspaceContext | null {
  if (db === null || typeof designId !== 'string' || designId.trim().length === 0) return null;

  const rows = db
    .prepare('SELECT path, content FROM design_files WHERE design_id = ? ORDER BY path ASC')
    .all(designId) as DesignFileRow[];
  const candidates = rows.filter(
    (row) => isRelevantDesignFilePath(row.path) && row.content.trim().length > 0,
  );
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort(
    (left, right) => rankDesignFile(right) - rankDesignFile(left) || left.path.localeCompare(right.path),
  );

  const files: WorkspaceContextFile[] = [];
  let remainingChars = MAX_WORKSPACE_TOTAL_CHARS;
  for (const row of ranked) {
    if (files.length >= MAX_WORKSPACE_FILES || remainingChars < 300) break;
    const file = excerptDesignFile(row, Math.min(MAX_WORKSPACE_FILE_CHARS, remainingChars));
    if (!file) continue;
    files.push(file);
    remainingChars -= file.excerpt.length;
  }

  if (files.length === 0) return null;

  return {
    rootPath: `hosted://design/${designId}`,
    summary: summarizeWorkspaceContext({ files, totalCount: candidates.length }),
    files,
  };
}