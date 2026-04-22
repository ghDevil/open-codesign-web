/**
 * Diagnostics IPC handlers (main process).
 *
 * All channels are namespaced diagnostics:v1:* and carry schemaVersion: 1
 * on every object payload.
 *
 * Channels:
 *   diagnostics:v1:log            — relay a renderer log entry to electron-log
 *   diagnostics:v1:openLogFolder  — open the logs directory in Finder/Explorer
 *   diagnostics:v1:exportDiagnostics — bundle logs + metadata into a zip
 *   diagnostics:v1:showItemInFolder  — reveal a file in the OS file manager
 *   diagnostics:v1:listEvents     — list recent diagnostic events
 *   diagnostics:v1:reportEvent    — build bundle + return GH issue URL + markdown
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ActionTimelineEntry,
  CodesignError,
  type DiagnosticEventInput,
  type DiagnosticEventRow,
  type ListEventsInput,
  type ListEventsResult,
  type ReportEventInput,
  type ReportEventResult,
} from '@open-codesign/shared';
import { computeFingerprint } from '@open-codesign/shared/fingerprint';
import type BetterSqlite3 from 'better-sqlite3';
import { configDir, configPath } from './config';
import {
  composeSummaryMarkdown,
  redactPathsAndUrls,
  scrubPromptInLine,
} from './diagnostic-summary';
import { app, ipcMain, shell } from './electron-runtime';
import { getLogPath, getLogger, logsDir } from './logger';
import { findRecent, recordReported } from './reported-fingerprints';
import {
  getDiagnosticEventById,
  listDiagnosticEvents,
  recordDiagnosticEvent,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('diagnostics-ipc');

const GITHUB_REPO_URL = 'https://github.com/OpenCoworkAI/open-codesign';
const GH_BODY_MAX = 7000;
const REPORTED_FINGERPRINTS_FILENAME = 'reported-fingerprints.json';

function reportedFingerprintsPath(): string {
  return join(configDir(), REPORTED_FINGERPRINTS_FILENAME);
}

type LogLevel = 'info' | 'warn' | 'error';

export interface RendererLogEntry {
  schemaVersion: 1;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
  stack?: string;
}

function parseLogEntry(raw: unknown): RendererLogEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('diagnostics:v1:log expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError('diagnostics:v1:log requires schemaVersion: 1', 'IPC_BAD_INPUT');
  }
  if (r['level'] !== 'info' && r['level'] !== 'warn' && r['level'] !== 'error') {
    throw new CodesignError('level must be info | warn | error', 'IPC_BAD_INPUT');
  }
  if (typeof r['scope'] !== 'string' || r['scope'].trim().length === 0) {
    throw new CodesignError('scope must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['message'] !== 'string') {
    throw new CodesignError('message must be a string', 'IPC_BAD_INPUT');
  }
  if (r['data'] !== undefined && (typeof r['data'] !== 'object' || r['data'] === null)) {
    throw new CodesignError('data must be an object if provided', 'IPC_BAD_INPUT');
  }
  if (r['stack'] !== undefined && typeof r['stack'] !== 'string') {
    throw new CodesignError('stack must be a string if provided', 'IPC_BAD_INPUT');
  }
  const base: RendererLogEntry = {
    schemaVersion: 1,
    level: r['level'] as LogLevel,
    scope: r['scope'] as string,
    message: r['message'] as string,
  };
  if (r['data'] !== undefined) {
    base.data = r['data'] as Record<string, unknown>;
  }
  if (r['stack'] !== undefined) {
    base.stack = r['stack'] as string;
  }
  return base;
}

function parseListEventsInput(raw: unknown): ListEventsInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('diagnostics:v1:listEvents expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError('diagnostics:v1:listEvents requires schemaVersion: 1', 'IPC_BAD_INPUT');
  }
  if (r['limit'] !== undefined && typeof r['limit'] !== 'number') {
    throw new CodesignError('limit must be a number if provided', 'IPC_BAD_INPUT');
  }
  if (r['includeTransient'] !== undefined && typeof r['includeTransient'] !== 'boolean') {
    throw new CodesignError('includeTransient must be a boolean if provided', 'IPC_BAD_INPUT');
  }
  const out: ListEventsInput = { schemaVersion: 1 };
  if (r['limit'] !== undefined) out.limit = r['limit'] as number;
  if (r['includeTransient'] !== undefined) out.includeTransient = r['includeTransient'] as boolean;
  return out;
}

function parseReportEventInput(raw: unknown): ReportEventInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:reportEvent expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:reportEvent requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['eventId'] !== 'number' || !Number.isFinite(r['eventId'])) {
    throw new CodesignError('eventId must be a finite number', 'IPC_BAD_INPUT');
  }
  for (const key of ['includePromptText', 'includePaths', 'includeUrls', 'includeTimeline']) {
    if (typeof r[key] !== 'boolean') {
      throw new CodesignError(`${key} must be a boolean`, 'IPC_BAD_INPUT');
    }
  }
  if (typeof r['notes'] !== 'string') {
    throw new CodesignError('notes must be a string', 'IPC_BAD_INPUT');
  }
  if ((r['notes'] as string).length > 4000) {
    throw new CodesignError('reportEvent notes exceed 4000 characters', 'IPC_BAD_INPUT');
  }
  if (!Array.isArray(r['timeline'])) {
    throw new CodesignError('timeline must be an array', 'IPC_BAD_INPUT');
  }
  if ((r['timeline'] as unknown[]).length > 100) {
    throw new CodesignError('reportEvent timeline exceeds 100 entries', 'IPC_BAD_INPUT');
  }
  return {
    schemaVersion: 1,
    eventId: r['eventId'] as number,
    includePromptText: r['includePromptText'] as boolean,
    includePaths: r['includePaths'] as boolean,
    includeUrls: r['includeUrls'] as boolean,
    includeTimeline: r['includeTimeline'] as boolean,
    notes: r['notes'] as string,
    timeline: r['timeline'] as ActionTimelineEntry[],
  };
}

function parseIsFingerprintRecentInput(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:isFingerprintRecentlyReported expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:isFingerprintRecentlyReported requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['fingerprint'] !== 'string' || (r['fingerprint'] as string).length === 0) {
    throw new CodesignError('fingerprint must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['fingerprint'] as string;
}

function parseRecordRendererErrorInput(raw: unknown): {
  code: string;
  scope: string;
  message: string;
  stack?: string;
  runId?: string;
  context?: Record<string, unknown>;
} {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:recordRendererError expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:recordRendererError requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['code'] !== 'string' || (r['code'] as string).length === 0) {
    throw new CodesignError('code must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['scope'] !== 'string' || (r['scope'] as string).length === 0) {
    throw new CodesignError('scope must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['message'] !== 'string') {
    throw new CodesignError('message must be a string', 'IPC_BAD_INPUT');
  }
  if (r['stack'] !== undefined && typeof r['stack'] !== 'string') {
    throw new CodesignError('stack must be a string if provided', 'IPC_BAD_INPUT');
  }
  if (r['runId'] !== undefined && typeof r['runId'] !== 'string') {
    throw new CodesignError('runId must be a string if provided', 'IPC_BAD_INPUT');
  }
  if (r['context'] !== undefined && (typeof r['context'] !== 'object' || r['context'] === null)) {
    throw new CodesignError('context must be an object if provided', 'IPC_BAD_INPUT');
  }
  const out: {
    code: string;
    scope: string;
    message: string;
    stack?: string;
    runId?: string;
    context?: Record<string, unknown>;
  } = {
    code: r['code'] as string,
    scope: r['scope'] as string,
    message: r['message'] as string,
  };
  if (r['stack'] !== undefined) out.stack = r['stack'] as string;
  if (r['runId'] !== undefined) out.runId = r['runId'] as string;
  if (r['context'] !== undefined) out.context = r['context'] as Record<string, unknown>;
  return out;
}

/** Regex that matches common API key shapes; used as a secondary pass so keys
 *  that leak into unexpected fields (e.g. `notes = "my sk-abcdef..."`) still
 *  get masked. Format-based so it is necessarily narrow — the primary defense
 *  is field-based redaction below. */
const API_KEY_RE = /(sk-[a-zA-Z0-9]{20,}|[a-f0-9]{32,})/g;

/** Mask the VALUE of any TOML line whose key looks sensitive, regardless of
 *  the value's format. Google (AIzaSy...), Azure base64, DeepSeek, and future
 *  bearer tokens all slip past format-based regexes. */
export function redactSensitiveTomlFields(s: string): string {
  return s.replace(
    /^(\s*(?:api_?key|token|bearer|secret|access_?token|refresh_?token|password)\s*=\s*)"[^"]*"/gim,
    '$1"***REDACTED***"',
  );
}

async function readConfigRedacted(): Promise<string> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    // Strip prompt / history fields first (multi-line values between quotes).
    const noPrompts = raw.replace(/^(prompt|history)\s*=\s*"""[\s\S]*?"""/gm, '');
    // Field-based redaction is the primary defense; format-based is a fallback
    // for keys that leak into non-sensitive-looking fields.
    const fieldMasked = redactSensitiveTomlFields(noPrompts);
    return fieldMasked.replace(API_KEY_RE, '***REDACTED***');
  } catch {
    return '(config not readable)';
  }
}

async function readLogTail(maxLines: number): Promise<string[]> {
  try {
    const content = await readFile(getLogPath(), 'utf8');
    if (content.length === 0) return [];
    const lines = content.split('\n');
    // Drop trailing empty line from final newline.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Build the diagnostics zip bundle. Always writes `summary.md` at the root
 * alongside `main.log`, `config-redacted.toml`, and `metadata.json`.
 *
 * The redaction toggles apply not only to `summary.md` (composed upstream)
 * but also to the raw `main.log` contents staged into the zip. Callers that
 * have no user-chosen toggles (e.g. the standalone Export Diagnostics
 * action) should pass all three flags as `false` to default to the safest
 * redaction.
 */
export async function buildBundle(opts: {
  summaryMarkdown: string;
  includePromptText: boolean;
  includePaths: boolean;
  includeUrls: boolean;
}): Promise<string> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Zip } = await import('zip-lib');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destDir = app.getPath('downloads');
  const destPath = path.join(destDir, `open-codesign-diagnostics-${timestamp}.zip`);

  let logContent: string;
  try {
    logContent = await readFile(getLogPath(), 'utf8');
  } catch {
    logContent = '(log file not readable)';
  }

  const scrubbedLog = logContent
    .split('\n')
    .map((line) => {
      let l = line;
      if (!opts.includePromptText) l = scrubPromptInLine(l);
      if (!opts.includePaths || !opts.includeUrls) {
        l = redactPathsAndUrls(l, {
          includePaths: opts.includePaths,
          includeUrls: opts.includeUrls,
        });
      }
      return l;
    })
    .join('\n');

  const configContent = await readConfigRedacted();

  const meta = JSON.stringify(
    {
      schemaVersion: 1,
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-diag-'));
  try {
    const logStagePath = path.join(stagingDir, 'main.log');
    const configStagePath = path.join(stagingDir, 'config-redacted.toml');
    const metaStagePath = path.join(stagingDir, 'metadata.json');
    const summaryStagePath = path.join(stagingDir, 'summary.md');

    await Promise.all([
      fs.writeFile(logStagePath, scrubbedLog, 'utf8'),
      fs.writeFile(configStagePath, configContent, 'utf8'),
      fs.writeFile(metaStagePath, meta, 'utf8'),
      fs.writeFile(summaryStagePath, opts.summaryMarkdown, 'utf8'),
    ]);

    await fs.mkdir(destDir, { recursive: true });

    const zip = new Zip();
    zip.addFile(logStagePath, 'main.log');
    zip.addFile(configStagePath, 'config-redacted.toml');
    zip.addFile(metaStagePath, 'metadata.json');
    zip.addFile(summaryStagePath, 'summary.md');
    await zip.archive(destPath);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  return destPath;
}

async function buildDiagnosticsZip(): Promise<string> {
  // Generic summary used by the standalone "Export Diagnostics" action; the
  // richer per-event summary is produced by the Report flow via buildBundle.
  const summary = [
    '# Diagnostic Export',
    '',
    `Exported at ${new Date().toISOString()} from open-codesign ${app.getVersion()}.`,
    '',
    'This bundle contains recent logs, redacted config, and environment metadata.',
    '',
  ].join('\n');
  return buildBundle({
    summaryMarkdown: summary,
    includePromptText: false,
    includePaths: false,
    includeUrls: false,
  });
}

function buildIssueUrl(params: {
  event: DiagnosticEventRow;
  summaryMarkdown: string;
  bundlePath: string;
}): string {
  const { event, summaryMarkdown, bundlePath } = params;
  const base = `${GITHUB_REPO_URL}/issues/new`;
  const title = `[bug] ${event.code} (fp: ${event.fingerprint})`;
  // Visible attach instruction. summary.md is English-only today, so keep
  // this English too — a bilingual block would drift from it. Better an
  // unambiguous English line than an invisible HTML comment.
  const attachBlock = [
    '',
    '## Diagnostic bundle',
    '',
    'Please attach the diagnostic zip to this issue so we can see the full log:',
    '',
    `\`${bundlePath}\``,
    '',
    '(Drag the file from Finder / Explorer into the issue comment box below.)',
    '',
    `<!-- bundle attached at: ${bundlePath} -->`,
  ].join('\n');
  const bodyRaw = `${summaryMarkdown}\n${attachBlock}`;
  const body =
    bodyRaw.length > GH_BODY_MAX
      ? `${bodyRaw.slice(0, GH_BODY_MAX)}\n\n_(truncated — see attached bundle: ${bundlePath})_`
      : bodyRaw;
  return `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('bug,diagnostic-auto')}`;
}

export function registerDiagnosticsIpc(db: Database | null): void {
  ipcMain.handle('diagnostics:v1:log', (_e: unknown, raw: unknown): void => {
    const entry = parseLogEntry(raw);
    const scopedLogger = getLogger(`renderer:${entry.scope}`);
    const fields: Record<string, unknown> = {};
    if (entry.data !== undefined) {
      Object.assign(fields, entry.data);
    }
    // Stack is forwarded as a separate key, never concatenated into the message,
    // so it doesn't duplicate what electron-log already captures per-error.
    if (entry.stack !== undefined) {
      fields['stack'] = entry.stack;
    }
    switch (entry.level) {
      case 'info':
        scopedLogger.info(entry.message, fields);
        break;
      case 'warn':
        scopedLogger.warn(entry.message, fields);
        break;
      case 'error':
        scopedLogger.error(entry.message, fields);
        break;
    }

    // Persist only error-level renderer entries into diagnostic_events.
    if (entry.level === 'error' && db !== null) {
      const dataCode =
        entry.data !== undefined && typeof entry.data['code'] === 'string'
          ? (entry.data['code'] as string)
          : undefined;
      const code = dataCode ?? 'RENDERER_ERROR';
      const runId =
        entry.data !== undefined && typeof entry.data['runId'] === 'string'
          ? (entry.data['runId'] as string)
          : undefined;
      recordDiagnosticEvent(db, {
        level: 'error',
        code,
        scope: entry.scope,
        runId,
        fingerprint: computeFingerprint({ errorCode: code, stack: entry.stack }),
        message: entry.message,
        stack: entry.stack,
        transient: false,
      });
    }
  });

  ipcMain.handle(
    'diagnostics:v1:recordRendererError',
    (_e: unknown, raw: unknown): { schemaVersion: 1; eventId: number | null } => {
      const input = parseRecordRendererErrorInput(raw);
      if (db === null) {
        return { schemaVersion: 1, eventId: null };
      }
      const fingerprint = computeFingerprint({ errorCode: input.code, stack: input.stack });
      const recordInput: DiagnosticEventInput = {
        level: 'error',
        code: input.code,
        scope: input.scope,
        runId: input.runId,
        fingerprint,
        message: input.message,
        stack: input.stack,
        transient: false,
      };
      if (input.context !== undefined) recordInput.context = input.context;
      const eventId = recordDiagnosticEvent(db, recordInput);
      return { schemaVersion: 1, eventId };
    },
  );

  ipcMain.handle('diagnostics:v1:openLogFolder', async (): Promise<void> => {
    await shell.openPath(logsDir());
  });

  ipcMain.handle('diagnostics:v1:exportDiagnostics', async (): Promise<string> => {
    try {
      const zipPath = await buildDiagnosticsZip();
      logger.info('diagnostics.exported', { path: zipPath });
      return zipPath;
    } catch (err) {
      logger.error('diagnostics.export.fail', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw new CodesignError(
        `Failed to export diagnostics: ${err instanceof Error ? err.message : String(err)}`,
        'DIAGNOSTICS_EXPORT_FAILED',
        { cause: err },
      );
    }
  });

  ipcMain.handle('diagnostics:v1:showItemInFolder', (_e: unknown, raw: unknown): void => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new CodesignError(
        'diagnostics:v1:showItemInFolder expects a non-empty path string',
        'IPC_BAD_INPUT',
      );
    }
    shell.showItemInFolder(raw);
  });

  ipcMain.handle('diagnostics:v1:listEvents', (_e: unknown, raw: unknown): ListEventsResult => {
    const input = parseListEventsInput(raw);
    if (db === null) {
      return { schemaVersion: 1, events: [], dbAvailable: false };
    }
    const opts: { limit?: number; includeTransient?: boolean } = {};
    if (input.limit !== undefined) opts.limit = input.limit;
    if (input.includeTransient !== undefined) opts.includeTransient = input.includeTransient;
    const events = listDiagnosticEvents(db, opts);
    return { schemaVersion: 1, events, dbAvailable: true };
  });

  ipcMain.handle(
    'diagnostics:v1:reportEvent',
    async (_e: unknown, raw: unknown): Promise<ReportEventResult> => {
      const input = parseReportEventInput(raw);
      if (db === null) {
        throw new CodesignError('Diagnostics database unavailable', 'IPC_NOT_FOUND');
      }
      const event = getDiagnosticEventById(db, input.eventId);
      if (event === undefined) {
        throw new CodesignError(`Diagnostic event ${input.eventId} not found`, 'IPC_NOT_FOUND');
      }

      const recentLogTail = await readLogTail(50);
      const summaryMarkdown = composeSummaryMarkdown({
        event,
        appVersion: app.getVersion(),
        platform: process.platform,
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node,
        timeline: input.timeline,
        recentLogTail,
        notes: input.notes,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
        includeTimeline: input.includeTimeline,
      });

      const bundlePath = await buildBundle({
        summaryMarkdown,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
      });
      const issueUrl = buildIssueUrl({ event, summaryMarkdown, bundlePath });

      try {
        recordReported(reportedFingerprintsPath(), event.fingerprint, issueUrl);
      } catch (err) {
        logger.warn('diagnostics.reported.dedupWrite.fail', {
          message: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('diagnostics.reported', {
        eventId: event.id,
        code: event.code,
        fingerprint: event.fingerprint,
        bundlePath,
      });

      return { schemaVersion: 1, issueUrl, bundlePath, summaryMarkdown };
    },
  );

  ipcMain.handle('diagnostics:v1:isFingerprintRecentlyReported', (_e: unknown, raw: unknown) => {
    const fingerprint = parseIsFingerprintRecentInput(raw);
    const hit = findRecent(reportedFingerprintsPath(), fingerprint);
    if (hit === undefined) {
      return { schemaVersion: 1 as const, reported: false };
    }
    return {
      schemaVersion: 1 as const,
      reported: true,
      ts: hit.ts,
      issueUrl: hit.issueUrl,
    };
  });
}
