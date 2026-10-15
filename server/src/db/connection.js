import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function abrirBanco(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

// Transacao com BEGIN IMMEDIATE: serializa escritores, evita SQLITE_BUSY em picos.
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ja em rollback */ }
    throw e;
  }
}

export function agoraISO() {
  return new Date().toISOString();
}
