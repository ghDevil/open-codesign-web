/**
 * Thin re-export + Node-adapted init for the desktop snapshots-db.
 * Resolves the better-sqlite3 native binding for Node (not Electron).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  ChatAppendInput,
  ChatMessageRow,
  ChatToolCallPayload,
  CommentCreateInput,
  CommentRect,
  CommentRow,
  CommentScope,
  CommentStatus,
  Design,
  DesignSnapshot,
} from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);

function resolveNativeBinding(): string {
  const pkgJson = require.resolve('better-sqlite3/package.json') as string;
  const releaseDir = path.join(path.dirname(pkgJson), 'build', 'Release');
  const nodeSpecific = path.join(releaseDir, 'better_sqlite3.node-node.node');
  if (fs.existsSync(nodeSpecific)) return nodeSpecific;
  return path.join(releaseDir, 'better_sqlite3.node');
}

function openDatabase(filename: string): BetterSqlite3.Database {
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  return new Database(filename, { nativeBinding: resolveNativeBinding() });
}

function applySchema(db: BetterSqlite3.Database): void {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS designs (
      id            TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      name          TEXT NOT NULL DEFAULT 'Untitled design',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      thumbnail_text TEXT,
      deleted_at    TEXT,
      workspace_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_designs_deleted_at ON designs(deleted_at);

    CREATE TABLE IF NOT EXISTS design_snapshots (
      id             TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      design_id      TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      parent_id      TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL,
      type           TEXT NOT NULL CHECK(type IN ('initial','edit','fork')),
      prompt         TEXT,
      artifact_type  TEXT NOT NULL CHECK(artifact_type IN ('html','react','svg')),
      artifact_source TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      message        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_design_created ON design_snapshots(design_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      design_id   TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      seq         INTEGER NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('user','assistant_text','tool_call','artifact_delivered','error')),
      payload     TEXT NOT NULL,
      snapshot_id TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (design_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_design ON chat_messages(design_id, seq);

    CREATE TABLE IF NOT EXISTS design_files (
      id          TEXT PRIMARY KEY,
      design_id   TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      path        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (design_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_design_files_design ON design_files(design_id);

    CREATE TABLE IF NOT EXISTS comments (
      id                     TEXT PRIMARY KEY,
      schema_version         INTEGER NOT NULL DEFAULT 1,
      design_id              TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      snapshot_id            TEXT NOT NULL REFERENCES design_snapshots(id) ON DELETE CASCADE,
      kind                   TEXT NOT NULL CHECK (kind IN ('note','edit')),
      selector               TEXT NOT NULL,
      tag                    TEXT NOT NULL,
      outer_html             TEXT NOT NULL,
      rect                   TEXT NOT NULL,
      text                   TEXT NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
      scope                  TEXT NOT NULL DEFAULT 'element',
      parent_outer_html      TEXT,
      created_at             TEXT NOT NULL,
      applied_in_snapshot_id TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      ts              INTEGER NOT NULL,
      level           TEXT    NOT NULL CHECK (level IN ('info','warn','error')),
      code            TEXT    NOT NULL,
      scope           TEXT    NOT NULL,
      run_id          TEXT,
      fingerprint     TEXT    NOT NULL,
      message         TEXT    NOT NULL,
      stack           TEXT,
      transient       INTEGER NOT NULL DEFAULT 0,
      count           INTEGER NOT NULL DEFAULT 1,
      context_json    TEXT
    );
  `);
}

export function initSnapshotsDb(dbPath: string): BetterSqlite3.Database {
  const db = openDatabase(dbPath);
  applySchema(db);
  return db;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

interface DesignRowDb {
  id: string;
  schema_version: number;
  name: string;
  created_at: string;
  updated_at: string;
  thumbnail_text: string | null;
  deleted_at: string | null;
  workspace_path: string | null;
}

interface SnapshotRowDb {
  id: string;
  schema_version: number;
  design_id: string;
  parent_id: string | null;
  type: 'initial' | 'edit' | 'fork';
  prompt: string | null;
  artifact_type: 'html' | 'react' | 'svg';
  artifact_source: string;
  created_at: string;
  message: string | null;
}

interface ChatMessageRowDb {
  id: number;
  design_id: string;
  seq: number;
  kind: ChatMessageRow['kind'];
  payload: string;
  snapshot_id: string | null;
  created_at: string;
}

interface CommentRowDb {
  id: string;
  schema_version: number;
  design_id: string;
  snapshot_id: string;
  kind: string;
  selector: string;
  tag: string;
  outer_html: string;
  rect: string;
  text: string;
  status: string;
  created_at: string;
  applied_in_snapshot_id: string | null;
  scope: string | null;
  parent_outer_html: string | null;
}

function rowToDesign(row: DesignRowDb): Design {
  return {
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnailText: row.thumbnail_text,
    deletedAt: row.deleted_at,
    workspacePath: row.workspace_path,
  };
}

function rowToSnapshot(row: SnapshotRowDb): DesignSnapshot {
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    parentId: row.parent_id,
    type: row.type,
    prompt: row.prompt,
    artifactType: row.artifact_type,
    artifactSource: row.artifact_source,
    createdAt: row.created_at,
    ...(row.message ? { message: row.message } : {}),
  };
}

function rowToChatMessage(row: ChatMessageRowDb): ChatMessageRow {
  let payload: unknown = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = {};
  }
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    seq: row.seq,
    kind: row.kind,
    payload,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
  };
}

function rowToComment(row: CommentRowDb): CommentRow {
  let rect: CommentRect = { top: 0, left: 0, width: 0, height: 0 };
  try {
    const parsed = JSON.parse(row.rect) as Partial<CommentRect>;
    rect = {
      top: typeof parsed.top === 'number' ? parsed.top : 0,
      left: typeof parsed.left === 'number' ? parsed.left : 0,
      width: typeof parsed.width === 'number' ? parsed.width : 0,
      height: typeof parsed.height === 'number' ? parsed.height : 0,
    };
  } catch {
    // keep zero rect
  }
  const scope: CommentScope = row.scope === 'global' ? 'global' : 'element';
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    snapshotId: row.snapshot_id,
    kind: row.kind as CommentRow['kind'],
    selector: row.selector,
    tag: row.tag,
    outerHTML: row.outer_html,
    rect,
    text: row.text,
    status: row.status as CommentStatus,
    createdAt: row.created_at,
    appliedInSnapshotId: row.applied_in_snapshot_id,
    scope,
    ...(row.parent_outer_html ? { parentOuterHTML: row.parent_outer_html } : {}),
  };
}

export function normalizeDesignFilePath(p: string): string {
  return p.replace(/^\/+/, '');
}

export function listDesigns(db: BetterSqlite3.Database) {
  return (
    db.prepare('SELECT * FROM designs WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as
      DesignRowDb[]
  ).map(rowToDesign);
}

export function getDesign(db: BetterSqlite3.Database, id: string) {
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRowDb | undefined;
  return row ? rowToDesign(row) : null;
}

export function createDesign(db: BetterSqlite3.Database, input: { name?: string }): Design | null {
  const id = uuid();
  const ts = now();
  db.prepare('INSERT INTO designs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    input.name ?? 'Untitled design',
    ts,
    ts,
  );
  return getDesign(db, id);
}

export function renameDesign(db: BetterSqlite3.Database, id: string, name: string): void {
  db.prepare('UPDATE designs SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
}

export function setDesignThumbnail(
  db: BetterSqlite3.Database,
  id: string,
  thumbnail: string,
): void {
  db.prepare('UPDATE designs SET thumbnail_text = ?, updated_at = ? WHERE id = ?').run(
    thumbnail,
    now(),
    id,
  );
}

export function softDeleteDesign(db: BetterSqlite3.Database, id: string): void {
  db.prepare('UPDATE designs SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    now(),
    now(),
    id,
  );
}

export function duplicateDesign(db: BetterSqlite3.Database, id: string): Design | null {
  const original = db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRowDb | undefined;
  if (!original) throw new Error(`Design ${id} not found`);
  const newId = uuid();
  const ts = now();
  db.prepare('INSERT INTO designs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    newId,
    `${original.name} (copy)`,
    ts,
    ts,
  );
  return getDesign(db, newId);
}

export function listSnapshots(db: BetterSqlite3.Database, designId: string): DesignSnapshot[] {
  return (
    db
      .prepare('SELECT * FROM design_snapshots WHERE design_id = ? ORDER BY created_at DESC')
      .all(designId) as SnapshotRowDb[]
  ).map(rowToSnapshot);
}

export function getSnapshot(db: BetterSqlite3.Database, id: string): DesignSnapshot | null {
  const row = db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(id) as
    | SnapshotRowDb
    | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function createSnapshot(
  db: BetterSqlite3.Database,
  input: {
    designId: string;
    parentId?: string | null;
    type: 'initial' | 'edit' | 'fork';
    prompt?: string | null;
    artifactType: 'html' | 'react' | 'svg';
    artifactSource: string;
    message?: string | null;
  },
): DesignSnapshot | null {
  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO design_snapshots (id, design_id, parent_id, type, prompt, artifact_type, artifact_source, created_at, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.designId,
    input.parentId ?? null,
    input.type,
    input.prompt ?? null,
    input.artifactType,
    input.artifactSource,
    ts,
    input.message ?? null,
  );
  db.prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run(ts, input.designId);
  return getSnapshot(db, id);
}

export function deleteSnapshot(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM design_snapshots WHERE id = ?').run(id);
}

export function upsertDesignFile(
  db: BetterSqlite3.Database,
  designId: string,
  filePath: string,
  content: string,
): void {
  const ts = now();
  const id = uuid();
  db.prepare(`
    INSERT INTO design_files (id, design_id, path, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(design_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(id, designId, filePath, content, ts, ts);
}

export function listChatMessages(db: BetterSqlite3.Database, designId: string): ChatMessageRow[] {
  return (
    db
      .prepare('SELECT * FROM chat_messages WHERE design_id = ? ORDER BY seq ASC')
      .all(designId) as ChatMessageRowDb[]
  ).map(rowToChatMessage);
}

export function appendChatMessage(
  db: BetterSqlite3.Database,
  input: ChatAppendInput,
): ChatMessageRow {
  const maxSeqRow = db
    .prepare('SELECT COALESCE(MAX(seq), -1) AS max_seq FROM chat_messages WHERE design_id = ?')
    .get(input.designId) as { max_seq: number };
  const seq = (maxSeqRow?.max_seq ?? -1) + 1;
  const createdAt = now();
  const result = db
    .prepare(
      `INSERT INTO chat_messages (design_id, seq, kind, payload, snapshot_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.designId,
      seq,
      input.kind,
      JSON.stringify(input.payload),
      input.snapshotId ?? null,
      createdAt,
    );
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid) as
    | ChatMessageRowDb
    | undefined;
  if (!row) throw new Error('Failed to fetch inserted chat message');
  return rowToChatMessage(row);
}

export function updateChatToolCallStatus(
  db: BetterSqlite3.Database,
  designId: string,
  seq: number,
  status: 'done' | 'error',
  errorMessage?: string,
): void {
  const row = db
    .prepare('SELECT * FROM chat_messages WHERE design_id = ? AND seq = ?')
    .get(designId, seq) as ChatMessageRowDb | undefined;
  if (!row) throw new Error(`Chat message ${designId}:${seq} not found`);
  const parsed = rowToChatMessage(row);
  if (parsed.kind !== 'tool_call') throw new Error(`Chat message ${designId}:${seq} is not tool_call`);
  const prev = (parsed.payload ?? {}) as ChatToolCallPayload;
  const next: ChatToolCallPayload = {
    ...prev,
    status,
    ...(status === 'error' && errorMessage ? { error: { message: errorMessage } } : {}),
  };
  db.prepare('UPDATE chat_messages SET payload = ? WHERE design_id = ? AND seq = ?').run(
    JSON.stringify(next),
    designId,
    seq,
  );
}

export function seedChatFromSnapshots(db: BetterSqlite3.Database, designId: string): number {
  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE design_id = ?')
    .get(designId) as { count: number } | undefined;
  if ((existing?.count ?? 0) > 0) return 0;
  const snapshots = listSnapshots(db, designId);
  let inserted = 0;
  for (const snap of snapshots.slice().reverse()) {
    if (snap.prompt) {
      appendChatMessage(db, {
        designId,
        kind: 'user',
        payload: { text: snap.prompt },
        snapshotId: snap.id,
      });
      inserted += 1;
    }
    if (snap.message) {
      appendChatMessage(db, {
        designId,
        kind: 'assistant_text',
        payload: { text: snap.message },
        snapshotId: snap.id,
      });
      inserted += 1;
    }
  }
  return inserted;
}

export function createComment(db: BetterSqlite3.Database, input: CommentCreateInput): CommentRow {
  const id = crypto.randomUUID();
  const createdAt = now();
  const scope: CommentScope = input.scope === 'global' ? 'global' : 'element';
  const parentOuterHTML =
    typeof input.parentOuterHTML === 'string' && input.parentOuterHTML.length > 0
      ? input.parentOuterHTML.slice(0, 600)
      : null;
  db.prepare(
    `INSERT INTO comments
      (id, schema_version, design_id, snapshot_id, kind, selector, tag, outer_html, rect, text, status, scope, parent_outer_html, created_at, applied_in_snapshot_id)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL)`,
  ).run(
    id,
    input.designId,
    input.snapshotId,
    input.kind,
    input.selector,
    input.tag,
    input.outerHTML,
    JSON.stringify(input.rect),
    input.text,
    scope,
    parentOuterHTML,
    createdAt,
  );
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRowDb | undefined;
  if (!row) throw new Error('Failed to fetch inserted comment');
  return rowToComment(row);
}

export function listComments(
  db: BetterSqlite3.Database,
  designId: string,
  snapshotId?: string,
): CommentRow[] {
  const rows = (
    snapshotId
      ? db
          .prepare('SELECT * FROM comments WHERE design_id = ? AND snapshot_id = ? ORDER BY created_at ASC')
          .all(designId, snapshotId)
      : db.prepare('SELECT * FROM comments WHERE design_id = ? ORDER BY created_at ASC').all(designId)
  ) as CommentRowDb[];
  return rows.map(rowToComment);
}

export function listPendingEdits(db: BetterSqlite3.Database, designId: string): CommentRow[] {
  return (
    db
      .prepare(
        "SELECT * FROM comments WHERE design_id = ? AND kind = 'edit' AND status = 'pending' ORDER BY created_at ASC",
      )
      .all(designId) as CommentRowDb[]
  ).map(rowToComment);
}

export function updateComment(
  db: BetterSqlite3.Database,
  id: string,
  patch: { text?: string; status?: CommentStatus },
): CommentRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.text !== undefined) {
    fields.push('text = ?');
    values.push(patch.text);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (fields.length === 0) {
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRowDb | undefined;
    return row ? rowToComment(row) : null;
  }
  values.push(id);
  const result = db.prepare(`UPDATE comments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (result.changes === 0) return null;
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRowDb | undefined;
  return row ? rowToComment(row) : null;
}

export function deleteComment(db: BetterSqlite3.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  return result.changes > 0;
}

export function markCommentsApplied(
  db: BetterSqlite3.Database,
  ids: string[],
  snapshotId: string,
): CommentRow[] {
  if (ids.length === 0) return [];
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      "UPDATE comments SET status = 'applied', applied_in_snapshot_id = ? WHERE id = ?",
    );
    for (const id of ids) stmt.run(snapshotId, id);
  });
  tx();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM comments WHERE id IN (${placeholders})`)
    .all(...ids) as CommentRowDb[];
  return rows.map(rowToComment);
}
