import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runner versionado: aplica cada migração uma única vez (schema_migrations).
export function migrar(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    aplicado_em TEXT NOT NULL
  );`);
  const aplicadas = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const arquivos = fs.readdirSync(path.join(__dirname, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // A migração 013 recria `usuarios`, que é referenciada por dezenas de tabelas
  // (sessoes.usuario_id, configuracao.atualizado_por, usuarios.criado_por, ...).
  // Com foreign_keys ON, o DROP TABLE dispara um DELETE implícito que aborta a
  // migração e o ALTER ... RENAME reescreve as REFERENCES nas tabelas filhas.
  // A documentação do SQLite recomenda desligar as FKs durante esse tipo de
  // reconstrução; o PRAGMA só tem efeito FORA de uma transação, então ligamos/
  // desligamos em volta do loop e restauramos o estado original ao final.
  const fkEstavaLigado = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;
  if (fkEstavaLigado) db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const arquivo of arquivos) {
      const version = Number(arquivo.split('_')[0]);
      if (aplicadas.has(version)) continue;
      const sql = fs.readFileSync(path.join(__dirname, 'migrations', arquivo), 'utf8');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, nome, aplicado_em) VALUES (?, ?, ?)')
          .run(version, arquivo, new Date().toISOString());
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* noop */ }
        throw new Error(`Migração ${arquivo} falhou: ${e.message}`);
      }
    }
  } finally {
    if (fkEstavaLigado) db.exec('PRAGMA foreign_keys = ON;');
  }
}
