import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

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

const ScaffoldParams = Type.Object({
  kind: Type.String({
    minLength: 1,
    description:
      'Manifest key identifying which prebuilt starter to copy. See packages/core/src/scaffolds/manifest.json for the authoritative list.',
  }),
  destPath: Type.String({
    minLength: 1,
    description:
      'Workspace-relative destination path (e.g. "frames/iphone.jsx"). Parent directories are created.',
  }),
});

export type ScaffoldDetails =
  | { ok: true; kind: string; destPath: string; written: string; bytes: number }
  | { ok: false; kind: string; destPath: string; reason: string }
  | { ok: false; reason: string };

export function makeScaffoldTool(
  getWorkspaceRoot: () => string | null | undefined,
): AgentTool<typeof ScaffoldParams, ScaffoldDetails> {
  return {
    name: 'scaffold',
    label: 'Scaffold',
    description:
      "Drop a prebuilt starter file into the current workspace. kind: one of the keys in packages/core/src/scaffolds/manifest.json (device-frame / browser / dev-mockup / ui-primitive / background / surface / deck / landing). destPath: workspace-relative path. Example: scaffold({kind: 'iphone-16-pro-frame', destPath: 'frames/iphone.jsx'}).",
    parameters: ScaffoldParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<ScaffoldDetails>> {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        const reason = 'no workspace attached to this session';
        return {
          content: [{ type: 'text', text: `scaffold failed: ${reason}` }],
          details: { ok: false, reason },
        };
      }
      const result = await runScaffold({
        kind: params.kind,
        destPath: params.destPath,
        workspaceRoot,
      });
      if (result.ok && result.written && typeof result.bytes === 'number') {
        return {
          content: [
            {
              type: 'text',
              text: `Scaffolded ${params.kind} -> ${result.written} (${result.bytes} bytes)`,
            },
          ],
          details: {
            ok: true,
            kind: params.kind,
            destPath: params.destPath,
            written: result.written,
            bytes: result.bytes,
          },
        };
      }
      const reason = result.reason ?? 'unknown error';
      return {
        content: [{ type: 'text', text: `scaffold failed: ${reason}` }],
        details: {
          ok: false,
          kind: params.kind,
          destPath: params.destPath,
          reason,
        },
      };
    },
  };
}
