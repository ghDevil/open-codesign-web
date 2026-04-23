import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `scaffold` tool (T3.2). Copies a pre-bundled starter file from
 * `packages/core/src/scaffolds/` into the user's workspace.
 *
 * The set of legal `kind` values is the union of keys from
 * `manifest.json` (T4.2). Loaded lazily so the renderer can reflect
 * the catalog without bundling every scaffold's bytes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCAFFOLDS_ROOT = path.join(HERE, '..', 'scaffolds');

interface ManifestEntry {
  description: string;
  path: string;
  category?: string;
  license?: string;
}

interface Manifest {
  schemaVersion: number;
  scaffolds: Record<string, ManifestEntry>;
}

let cached: Manifest | null = null;

export async function loadScaffoldManifest(): Promise<Manifest> {
  if (cached) return cached;
  const raw = await readFile(path.join(SCAFFOLDS_ROOT, 'manifest.json'), 'utf8');
  cached = JSON.parse(raw) as Manifest;
  return cached;
}

export async function listScaffoldKinds(): Promise<string[]> {
  const m = await loadScaffoldManifest();
  return Object.keys(m.scaffolds).sort();
}

export interface ScaffoldRequest {
  kind: string;
  /** Workspace-relative destination path. */
  destPath: string;
  /** Workspace absolute root. */
  workspaceRoot: string;
}

export interface ScaffoldResult {
  ok: boolean;
  reason?: string;
  written?: string;
  bytes?: number;
}

export async function runScaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
  const manifest = await loadScaffoldManifest();
  const entry = manifest.scaffolds[req.kind];
  if (!entry) return { ok: false, reason: `unknown scaffold kind: ${req.kind}` };

  const sourceAbs = path.resolve(SCAFFOLDS_ROOT, entry.path);
  if (!sourceAbs.startsWith(SCAFFOLDS_ROOT) && !sourceAbs.startsWith(path.join(HERE, '..'))) {
    return { ok: false, reason: 'scaffold source escaped expected root' };
  }
  const dest = path.resolve(req.workspaceRoot, req.destPath);
  if (!dest.startsWith(req.workspaceRoot)) {
    return { ok: false, reason: 'destination outside workspace' };
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(sourceAbs, dest);
  const bytes = (await readFile(dest)).byteLength;
  return { ok: true, written: dest, bytes };
}
