import { type ChildProcess, spawn } from 'node:child_process';
import { getLogger } from './logger';

/**
 * Background process registry (T5.1).
 *
 * Per docs/v0.2-plan.md §4 "后台进程 (tab 模型)":
 *   - design tab open  -> background process alive
 *   - design tab close -> SIGTERM (3s) -> SIGKILL
 *   - app exit         -> TERM all -> KILL all
 *   - per-design ≤3 processes, global ≤10
 *
 * Each entry remembers its design (so the renderer's Processes panel
 * can scope) and its detected port (regex'd out of the first 2s of
 * stdout for vite/next/astro/webpack patterns).
 */

const log = getLogger('processes');
const PER_DESIGN_LIMIT = 3;
const GLOBAL_LIMIT = 10;

const PORT_RE =
  /(?:listening on(?:\s+port)?\s+|local:\s*http:\/\/[^:]+:|server (?:running )?on(?:\s+port)?\s+|on port\s+|http:\/\/[^:]+:|:)(\d{4,5})/i;

export interface ProcessEntry {
  id: string;
  designId: string;
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  startedAt: number;
  port?: number;
  child: ChildProcess;
}

const processes = new Map<string, ProcessEntry>();

function nextId(): string {
  return `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SpawnRequest {
  designId: string;
  command: string;
  args?: ReadonlyArray<string>;
  cwd: string;
}

export interface SpawnResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

export function spawnTracked(req: SpawnRequest): SpawnResult {
  if (processes.size >= GLOBAL_LIMIT) {
    return { ok: false, reason: `global process limit (${GLOBAL_LIMIT}) reached` };
  }
  const perDesign = Array.from(processes.values()).filter(
    (p) => p.designId === req.designId,
  ).length;
  if (perDesign >= PER_DESIGN_LIMIT) {
    return { ok: false, reason: `per-design process limit (${PER_DESIGN_LIMIT}) reached` };
  }
  const child = spawn(req.command, [...(req.args ?? [])], {
    cwd: req.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const id = nextId();
  const entry: ProcessEntry = {
    id,
    designId: req.designId,
    command: req.command,
    args: req.args ?? [],
    cwd: req.cwd,
    startedAt: Date.now(),
    child,
  };
  processes.set(id, entry);

  const portTimeout = setTimeout(() => {
    // Stop scanning stdout for ports after 2s — keeps idle work down.
    child.stdout?.removeListener('data', onChunk);
  }, 2000);
  const onChunk = (buf: Buffer) => {
    const match = PORT_RE.exec(buf.toString());
    if (match?.[1]) {
      entry.port = Number(match[1]);
      clearTimeout(portTimeout);
      child.stdout?.removeListener('data', onChunk);
    }
  };
  child.stdout?.on('data', onChunk);

  child.on('exit', (code, signal) => {
    log.info('process.exit', { id, designId: req.designId, code, signal });
    processes.delete(id);
  });
  child.on('error', (err) => {
    log.warn('process.error', { id, designId: req.designId, error: String(err) });
    processes.delete(id);
  });

  return { ok: true, id };
}

export function listProcesses(designId?: string): ProcessEntry[] {
  const all = Array.from(processes.values());
  return designId ? all.filter((p) => p.designId === designId) : all;
}

export function stopProcess(id: string): boolean {
  const entry = processes.get(id);
  if (!entry) return false;
  return killChild(entry);
}

export function stopProcessesForDesign(designId: string): number {
  let n = 0;
  for (const entry of Array.from(processes.values())) {
    if (entry.designId !== designId) continue;
    if (killChild(entry)) n++;
  }
  return n;
}

export function shutdownAllProcesses(): void {
  for (const entry of Array.from(processes.values())) killChild(entry);
}

function killChild(entry: ProcessEntry): boolean {
  try {
    entry.child.kill('SIGTERM');
    setTimeout(() => {
      if (!entry.child.killed) {
        try {
          entry.child.kill('SIGKILL');
        } catch {
          // process may already be gone
        }
      }
    }, 3000);
    return true;
  } catch (err) {
    log.warn('process.kill.fail', { id: entry.id, error: String(err) });
    return false;
  }
}

export const __test = { PORT_RE, PER_DESIGN_LIMIT, GLOBAL_LIMIT };
