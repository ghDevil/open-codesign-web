/**
 * Thin re-export + Node-adapted init for the desktop snapshots-db.
 * Resolves the better-sqlite3 native binding for Node (not Electron).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
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

export function normalizeDesignFilePath(p: string): string {
  return p.replace(/^\/+/, '');
}

export function listDesigns(db: BetterSqlite3.Database) {
  return db
    .prepare('SELECT * FROM designs WHERE deleted_at IS NULL ORDER BY updated_at DESC')
    .all();
}

export function getDesign(db: BetterSqlite3.Database, id: string) {
  return db.prepare('SELECT * FROM designs WHERE id = ?').get(id) ?? null;
}

export function createDesign(db: BetterSqlite3.Database, input: { name?: string }): unknown {
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

export function duplicateDesign(db: BetterSqlite3.Database, id: string): unknown {
  const original = db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
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

export function listSnapshots(db: BetterSqlite3.Database, designId: string) {
  return db
    .prepare('SELECT * FROM design_snapshots WHERE design_id = ? ORDER BY created_at DESC')
    .all(designId);
}

export function getSnapshot(db: BetterSqlite3.Database, id: string) {
  return db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(id) ?? null;
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
): unknown {
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

export function listChatMessages(db: BetterSqlite3.Database, designId: string) {
  return db
    .prepare('SELECT * FROM chat_messages WHERE design_id = ? ORDER BY seq ASC')
    .all(designId);
}

export function appendChatMessage(
  db: BetterSqlite3.Database,
  input: {
    designId: string;
    seq: number;
    kind: string;
    payload: unknown;
    snapshotId?: string | null;
  },
): void {
  db.prepare(`
    INSERT INTO chat_messages (design_id, seq, kind, payload, snapshot_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(design_id, seq) DO NOTHING
  `).run(
    input.designId,
    input.seq,
    input.kind,
    JSON.stringify(input.payload),
    input.snapshotId ?? null,
    now(),
  );
}

export function updateChatMessagePayload(
  db: BetterSqlite3.Database,
  designId: string,
  seq: number,
  payload: unknown,
): void {
  db.prepare('UPDATE chat_messages SET payload = ? WHERE design_id = ? AND seq = ?').run(
    JSON.stringify(payload),
    designId,
    seq,
  );
}
