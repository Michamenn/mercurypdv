import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { registrar } from '../core/audit.js';

// Backup consistente ONLINE via VACUUM INTO (cópia física coerente sem travar o caixa),
// seguido de PRAGMA integrity_check na cópia. Histórico em backups/historico.jsonl.
export function criarBackup(db, { usuarioId = null, motivo = 'automatico' } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(config.backupsDir, `lanchonete-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${destino.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
  const verificacao = verificarIntegridade(destino);
  const bytes = fs.statSync(destino).size;
  const registro = {
    arquivo: path.basename(destino), bytes, motivo, integrity: verificacao,
    usuario_id: usuarioId, criado_em: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(config.backupsDir, 'historico.jsonl'), JSON.stringify(registro) + '\n');
  aplicarRetencao();
  registrar(db, { usuarioId, acao: 'backup_criado', entidade: 'backup', entidadeId: registro.arquivo, detalhes: { bytes, integrity: verificacao, motivo } });
  return registro;
}

export function verificarIntegridade(arquivo) {
  const d = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const r = d.prepare('PRAGMA integrity_check').get();
    return r?.integrity_check ?? 'desconhecido';
  } finally {
    d.close();
  }
}

export function listarBackups() {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const arquivos = fs.readdirSync(config.backupsDir)
    .filter((f) => f.startsWith('lanchonete-') && f.endsWith('.sqlite'))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(config.backupsDir, f));
      return { arquivo: f, bytes: st.size, criado_em: st.mtime.toISOString() };
    });
  let historico = [];
  const hf = path.join(config.backupsDir, 'historico.jsonl');
  if (fs.existsSync(hf)) {
    try {
      historico = fs.readFileSync(hf, 'utf8').trim().split('\n').slice(-20).map((l) => JSON.parse(l)).reverse();
    } catch { /* histórico corrompido não bloqueia */ }
  }
  return { backups: arquivos, historico, destino: config.backupsDir };
}

export function aplicarRetencao() {
  const dias = config.backupRetencao;
  const corte = Date.now() - dias * 24 * 3600_000;
  let removidos = 0;
  for (const f of fs.readdirSync(config.backupsDir)) {
    if (!f.startsWith('lanchonete-') || !f.endsWith('.sqlite')) continue;
    const st = fs.statSync(path.join(config.backupsDir, f));
    if (st.mtime.getTime() < corte) {
      // remove também os arquivos WAL/SHM do backup, se existirem
      for (const sufixo of ['', '-wal', '-shm']) {
        try { fs.rmSync(path.join(config.backupsDir, f + sufixo), { force: true }); } catch { /* noop */ }
      }
      removidos++;
    }
  }
  return removidos;
}

// Restauração em destino ESPECÍFICO — nunca sobrescreve produção sem caminho explícito.
export function restaurarBackup(db, arquivo, destinoPath, { usuarioId = null, ip = null } = {}) {
  const origem = path.join(config.backupsDir, path.basename(arquivo));
  if (!fs.existsSync(origem)) throw new Error('Backup não encontrado.');
  const integridade = verificarIntegridade(origem);
  if (integridade !== 'ok') throw new Error(`Backup corrompido (integrity_check: ${integridade}). Restaure outro.`);
  fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
  if (path.resolve(destinoPath) === path.resolve(config.dbPath)) {
    throw new Error('Restauração sobre o banco em uso é bloqueada. Pare o servidor e use scripts/restaurar_backup.ps1.');
  }
  fs.copyFileSync(origem, destinoPath);
  const ok = verificarIntegridade(destinoPath);
  registrar(db, { usuarioId, acao: 'backup_restaurado', entidade: 'backup', entidadeId: path.basename(arquivo), detalhes: { destino: destinoPath, integrity: ok }, ip });
  return { destino: destinoPath, integrity: ok };
}
