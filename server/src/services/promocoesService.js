
import { erro } from '../core/errors.js';
import { assertCentavos, assertInt } from '../core/money.js';
import { texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validarPromo(body) {
  const produto_id = assertInt(body?.produto_id, 'produto_id', { minimo: 1 });
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 80 });
  const tipo = ['percentual', 'preco_fixo'].includes(body?.tipo) ? body.tipo : null;
  if (!tipo) throw erro.validacao('Tipo deve ser: percentual ou preco_fixo.');
  let desconto_percentual = null;
  let preco_fixo_centavos = null;
  if (tipo === 'percentual') {
    desconto_percentual = assertInt(body?.desconto_percentual ?? body?.valor, 'desconto_percentual', { minimo: 1, maximo: 100 });
  } else {
    preco_fixo_centavos = assertCentavos(body?.preco_fixo_centavos ?? body?.valor_centavos ?? body?.valor, 'preco_fixo_centavos');
  }
  const dias_semana = body?.dias_semana === undefined || body?.dias_semana === null ? '0,1,2,3,4,5,6'
    : String(body.dias_semana).split(',').map((d) => d.trim()).filter((d) => d !== '').join(',');
  if (!/^(?:[0-6])(?:,[0-6])*$/.test(dias_semana)) throw erro.validacao('dias_semana inválidos (0=domingo..6=sábado).');
  const hora_ini = body?.hora_ini ? String(body.hora_ini).slice(0, 5) : null;
  const hora_fim = body?.hora_fim ? String(body.hora_fim).slice(0, 5) : null;
  if ((hora_ini && !HORA_RE.test(hora_ini)) || (hora_fim && !HORA_RE.test(hora_fim))) {
    throw erro.validacao('Horário inválido (use HH:MM).');
  }
  if (hora_ini && hora_fim && hora_ini >= hora_fim) throw erro.validacao('hora_ini deve ser anterior a hora_fim.');
  if ((hora_ini && !hora_fim) || (!hora_ini && hora_fim)) throw erro.validacao('Informe hora_ini e hora_fim juntos.');
  const valido_de = body?.valido_de ? new Date(String(body.valido_de)).toISOString() : null;
  const valido_ate = body?.valido_ate ? new Date(String(body.valido_ate)).toISOString() : null;
  if (valido_de && valido_ate && valido_de >= valido_ate) throw erro.validacao('Início deve ser anterior ao fim.');
  const limite_usos = body?.limite_usos === undefined || body?.limite_usos === null || body?.limite_usos === ''
    ? null : assertInt(body.limite_usos, 'limite_usos', { minimo: 1, maximo: 1000000 });
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;
  return { produto_id, nome, tipo, desconto_percentual, preco_fixo_centavos, dias_semana, hora_ini, hora_fim, valido_de, valido_ate, limite_usos, ativo };
}

function emJanela(promo, agora = new Date()) {
  if (!promo || !promo.ativo) return false;
  const iso = agora.toISOString();
  if (promo.valido_de && promo.valido_de > iso) return false;
  if (promo.valido_ate && promo.valido_ate < iso) return false;
  const dias = String(promo.dias_semana ?? '0,1,2,3,4,5,6').split(',').map((d) => Number(d.trim()));
  if (!dias.includes(agora.getDay())) return false;
  if (promo.hora_ini && promo.hora_fim) {
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    if (!(promo.hora_ini <= hhmm && hhmm < promo.hora_fim)) return false;
  }
  if (promo.limite_usos !== null && promo.limite_usos !== undefined && (promo.usos ?? 0) >= promo.limite_usos) return false;
  return true;
}

// Retorna a promoção vigente (maior desconto primeiro) ou null.
export function promocaoVigente(db, produtoId, agora = new Date()) {
  const promos = db.prepare(`SELECT * FROM promocoes_produto WHERE produto_id = ? AND ativo = 1`).all(produtoId);
  const vigentes = promos.filter((p) => emJanela(p, agora));
  if (!vigentes.length) return null;
  const produto = db.prepare('SELECT preco_centavos FROM produtos WHERE id = ?').get(produtoId);
  const base = produto?.preco_centavos ?? 0;
  let melhor = null;
  let melhorPreco = base;
  for (const p of vigentes) {
    const preco = p.tipo === 'percentual' ? Math.round((base * (100 - p.desconto_percentual)) / 100) : Math.min(base, p.preco_fixo_centavos);
    if (preco < melhorPreco) { melhorPreco = preco; melhor = p; }
  }
  return melhor ? { ...melhor, preco_promocional_centavos: melhorPreco } : null;
}

export function listarPromocoes(db, produtoId = null) {
  const sql = `SELECT pp.*, p.nome AS produto_nome FROM promocoes_produto pp JOIN produtos p ON p.id = pp.produto_id
    ${produtoId ? 'WHERE pp.produto_id = ?' : ''} ORDER BY pp.ativo DESC, pp.id DESC`;
  return produtoId ? db.prepare(sql).all(produtoId) : db.prepare(sql).all();
}

export function criarPromocao(db, usuario, body, ip) {
  const d = validarPromo(body);
  return transacao(db, () => {
    const produto = db.prepare('SELECT id, nome FROM produtos WHERE id = ? AND ativo = 1').get(d.produto_id);
    if (!produto) throw erro.validacao('Produto inexistente ou inativo.');
    const info = db.prepare(
      `INSERT INTO promocoes_produto (produto_id, nome, tipo, desconto_percentual, preco_fixo_centavos,
        dias_semana, hora_ini, hora_fim, valido_de, valido_ate, limite_usos, ativo, criado_por, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(d.produto_id, d.nome, d.tipo, d.desconto_percentual, d.preco_fixo_centavos,
      d.dias_semana, d.hora_ini, d.hora_fim, d.valido_de, d.valido_ate, d.limite_usos, d.ativo, usuario.id, agoraISO());
    const id = Number(info.lastInsertRowid);
    registrar(db, { usuarioId: usuario.id, acao: 'promocao_criada', entidade: 'promocao', entidadeId: id, detalhes: { produto_id: d.produto_id, nome: d.nome, tipo: d.tipo }, ip });
    return db.prepare('SELECT * FROM promocoes_produto WHERE id = ?').get(id);
  });
}

export function atualizarPromocao(db, usuario, id, body, ip) {
  const d = validarPromo(body);
  return transacao(db, () => {
    const atual = db.prepare('SELECT * FROM promocoes_produto WHERE id = ?').get(id);
    if (!atual) throw erro.naoEncontrado('Promoção não encontrada.');
    const produto = db.prepare('SELECT id FROM produtos WHERE id = ? AND ativo = 1').get(d.produto_id);
    if (!produto) throw erro.validacao('Produto inexistente ou inativo.');
    db.prepare(
      `UPDATE promocoes_produto SET produto_id=?, nome=?, tipo=?, desconto_percentual=?, preco_fixo_centavos=?,
        dias_semana=?, hora_ini=?, hora_fim=?, valido_de=?, valido_ate=?, limite_usos=?, ativo=? WHERE id=?`
    ).run(d.produto_id, d.nome, d.tipo, d.desconto_percentual, d.preco_fixo_centavos,
      d.dias_semana, d.hora_ini, d.hora_fim, d.valido_de, d.valido_ate, d.limite_usos, d.ativo, id);
    registrar(db, { usuarioId: usuario.id, acao: 'promocao_alterada', entidade: 'promocao', entidadeId: id, detalhes: { nome: d.nome }, ip });
    return db.prepare('SELECT * FROM promocoes_produto WHERE id = ?').get(id);
  });
}

export function removerPromocao(db, usuario, id, ip) {
  const atual = db.prepare('SELECT * FROM promocoes_produto WHERE id = ?').get(id);
  if (!atual) throw erro.naoEncontrado('Promoção não encontrada.');
  db.prepare('UPDATE promocoes_produto SET ativo = 0 WHERE id = ?').run(id);
  registrar(db, { usuarioId: usuario.id, acao: 'promocao_removida', entidade: 'promocao', entidadeId: id, detalhes: { nome: atual.nome }, ip });
  return { ok: true };
}
