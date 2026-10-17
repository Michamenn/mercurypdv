import { erro } from '../core/errors.js';
import { agoraISO } from '../db/connection.js';

// ---------- Notificações do sino (1.3.1) ----------
// Feed único do estabelecimento: pedidos prontos na cozinha avisam garçons e
// atendentes. Leitura compartilhada (marcar lidas / limpar) — a contagem de
// não lidas aparece no sino do topo para todos com permissão de atendimento.

const RETENCAO = 500; // mantém no máximo ~500 notificações antigas

export function criar(db, { tipo, titulo, detalhes = null, pedidoId = null, mesaNumero = null }) {
  const tiposOk = ['pedido_pronto', 'garcom_chamado', 'estoque_baixo', 'sistema'];
  if (!tiposOk.includes(tipo)) throw erro.validacao('Tipo de notificação inválido.');
  const tituloOk = typeof titulo === 'string' ? titulo.trim().slice(0, 120) : '';
  if (!tituloOk) throw erro.validacao('Notificação exige título.');
  const info = db.prepare(
    `INSERT INTO notificacoes (tipo, titulo, detalhes, pedido_id, mesa_numero, criado_em) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tipo, tituloOk, detalhes ? String(detalhes).slice(0, 300) : null,
    pedidoId ?? null, mesaNumero ?? null, agoraISO());
  const id = Number(info.lastInsertRowid);
  // expurgo leve e barato: remove as mais antigas além da retenção
  db.prepare('DELETE FROM notificacoes WHERE id <= ? AND lida = 1').run(id - RETENCAO);
  return { id, tipo, titulo: tituloOk, detalhes, pedido_id: pedidoId ?? null, mesa_numero: mesaNumero ?? null, criado_em: agoraISO(), lida: 0 };
}

export function listar(db, { limite = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100);
  const itens = db.prepare(
    `SELECT * FROM notificacoes ORDER BY id DESC LIMIT ?`
  ).all(lim);
  const naoLidas = db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE lida = 0').get().n;
  return { itens, nao_lidas: naoLidas };
}

export function marcarTodasLidas(db) {
  db.prepare('UPDATE notificacoes SET lida = 1, lida_em = ? WHERE lida = 0').run(agoraISO());
  return listar(db);
}

// "Limpar": apaga tudo que já foi lido e zera o sino. Não lidas também são
// removidas — é a ação explícita de limpeza pedida pelo operador.
export function limpar(db) {
  db.prepare('DELETE FROM notificacoes').run();
  return { ok: true, itens: [], nao_lidas: 0 };
}
