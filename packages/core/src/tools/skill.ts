import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `skill` tool (T3.3). Lazy-loads the markdown body of a builtin skill
 * (or a brand reference under `brand:<slug>`). Per-session de-dup so a
 * second call returns a short "already loaded" stub instead of re-injecting
 * the whole text.
 *
 * Manifest exposure: skill names are listed in the system prompt at session
 * start (~500 bytes). Body content (~500–2000 bytes) only enters context on
 * explicit tool call.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = path.join(HERE, '..', 'skills', 'builtin');
const BRAND_DIR = path.join(HERE, '..', 'brand-refs');

export interface SkillManifestEntry {
  name: string;
  category: 'design' | 'brand';
  source: 'builtin' | 'brand-ref';
  path: string;
}

export async function listSkillManifest(): Promise<SkillManifestEntry[]> {
  const out: SkillManifestEntry[] = [];

  try {
    const builtins = await readdir(BUILTIN_DIR);
    for (const name of builtins) {
      if (!name.endsWith('.md')) continue;
      out.push({
        name: name.replace(/\.md$/, ''),
        category: 'design',
        source: 'builtin',
        path: path.join(BUILTIN_DIR, name),
      });
    }
  } catch {
    // builtin dir missing — return whatever we have
  }

  try {
    const brandSlugs = await readdir(BRAND_DIR);
    for (const slug of brandSlugs) {
      if (slug.startsWith('.') || slug === 'manifest.json') continue;
      out.push({
        name: `brand:${slug}`,
        category: 'brand',
        source: 'brand-ref',
        path: path.join(BRAND_DIR, slug, 'DESIGN.md'),
      });
    }
  } catch {
    // brand-refs dir missing — fine, skill manifest just shows builtins
  }

  return out;
}

export interface InvokeSkillOptions {
  name: string;
  alreadyLoaded?: ReadonlySet<string>;
}

export interface InvokeSkillResult {
  status: 'loaded' | 'already-loaded' | 'not-found';
  body?: string;
  reason?: string;
}

export async function invokeSkill(opts: InvokeSkillOptions): Promise<InvokeSkillResult> {
  if (opts.alreadyLoaded?.has(opts.name)) {
    return { status: 'already-loaded' };
  }
  const manifest = await listSkillManifest();
  const entry = manifest.find((e) => e.name === opts.name);
  if (!entry) {
    return { status: 'not-found', reason: `no skill registered as ${opts.name}` };
  }
  try {
    const body = await readFile(entry.path, 'utf8');
    return { status: 'loaded', body };
  } catch (err) {
    return {
      status: 'not-found',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
