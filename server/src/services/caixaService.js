import { erro } from '../core/errors.js';
import { assertCentavos } from '../core/money.js';
import { registrar } from '../core/audit.js';
import { agoraISO } from '../db/connection.js';

export const FORMAS = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao'];

export function sessaoAberta(db) {
  return db.prepare(
    `SELECT cs.*, u.nome AS usuario_abertura_nome FROM caixa_sessoes cs
     JOIN usuarios u ON u.id = cs.usuario_abertura WHERE cs.status = 'aberto' ORDER BY cs.id DESC LIMIT 1`
  ).get() ?? null;
}

export function exigirCaixaAberto(db) {
  const s = sessaoAberta(db);
  if (!s) throw erro.conflito('409_CAIXA_FECHADO', 'Não há caixa aberto. Abra o caixa para operar vendas e pagamentos.');
  return s;
}

export function abrir(db, usuario, valorSaldoInicial, ip) {
  if (sessaoAberta(db)) throw erro.conflito('409_CAIXA_JA_ABERTO', 'Já existe um caixa aberto. Feche-o antes de abrir outro.');
  const saldoInicial = assertCentavos(valorSaldoInicial, 'saldo_inicial');
  const agora = agoraISO();
  const info = db.prepare(
    `INSERT INTO caixa_sessoes (usuario_abertura, aberto_em, saldo_inicial_centavos, status)
     VALUES (?, ?, ?, 'aberto')`
  ).run(usuario.id, agora, saldoInicial);
  const id = Number(info.lastInsertRowid);
  registrar(db, { usuarioId: usuario.id, acao: 'caixa_abertura', entidade: 'caixa_sessao', entidadeId: id, detalhes: { saldo_inicial_centavos: saldoInicial }, ip });
  return db.prepare('SELECT * FROM caixa_sessoes WHERE id = ?').get(id);
}

// Esperado por forma = inicial(dinheiro) + suprimentos + vendas − sangrias (dinheiro);
// demais formas apenas vendas da forma.
export function apuradoPorForma(db, sessao) {
  const esperado = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  esperado.dinheiro += sessao.saldo_inicial_centavos;
  const movs = db.prepare(
    `SELECT tipo, forma, SUM(valor_centavos) AS total FROM caixa_movimentacoes WHERE sessao_id = ? GROUP BY tipo, forma`
  ).all(sessao.id);
  for (const m of movs) {
    if (m.tipo === 'suprimento') esperado[m.forma] += m.total;
    else esperado[m.forma] -= m.total;
  }
  const vendas = db.prepare(
    `SELECT pg.forma, COALESCE(SUM(pg.valor_centavos),0) AS total
     FROM pagamentos pg JOIN pedidos pe ON pe.id = pg.pedido_id
     WHERE pg.caixa_sessao_id = ? AND pg.estornado = 0 AND pe.status = 'fechado'
     GROUP BY pg.forma`
  ).all(sessao.id);
  // pagamentos de pedidos ainda abertos contam como "recebido aguardando fechamento"
  const vendasAbertas = db.prepare(
    `SELECT pg.forma, COALESCE(SUM(pg.valor_centavos),0) AS total
     FROM pagamentos pg JOIN pedidos pe ON pe.id = pg.pedido_id
     WHERE pg.caixa_sessao_id = ? AND pg.estornado = 0 AND pe.status = 'aberto'
     GROUP BY pg.forma`
  ).all(sessao.id);
  for (const v of vendas) esperado[v.forma] += v.total;
  // Pagamentos de pedidos AINDA ABERTOS também estão fisicamente na gaveta:
  // entram no esperado da conferência (senão toda venda deixada aberta gera
  // divergência fantasma no fechamento do caixa).
  for (const v of vendasAbertas) esperado[v.forma] += v.total;
  return {
    esperado,
    vendas_fechadas: Object.fromEntries(vendas.map((v) => [v.forma, v.total])),
    recebido_pedidos_abertos: Object.fromEntries(vendasAbertas.map((v) => [v.forma, v.total])),
  };
}

export function resumoAberto(db) {
  const s = sessaoAberta(db);
  if (!s) return null;
  const ap = apuradoPorForma(db, s);
  const movs = db.prepare(
    `SELECT m.*, u.nome AS usuario_nome FROM caixa_movimentacoes m JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.sessao_id = ? ORDER BY m.id DESC`
  ).all(s.id);
  return { sessao: s, ...ap, movimentacoes: movs };
}

// Sangria/suprimento. Regras: somente dinheiro; sangria/suprimento do caixa exige
// step-up de admin quando o operador não é admin (matriz de permissões).
export function movimentar(db, sessao, usuario, { tipo, forma, valor_centavos, motivo }, autorizadoPorId, ip, hub) {
  if (!sessao || sessao.status !== 'aberto') throw erro.conflito('409_CAIXA_FECHADO', 'Caixa não está aberto.');
  if (tipo !== 'sangria' && tipo !== 'suprimento') throw erro.validacao('Tipo de movimentação inválido.');
  if (forma !== 'dinheiro') throw erro.validacao('Sangrias e suprimentos só se aplicam a dinheiro (cartão/PIX vão direto ao recebível).');
  const valor = assertCentavos(valor_centavos, 'valor');
  if (valor <= 0) throw erro.validacao('Valor deve ser maior que zero.');
  if (tipo === 'sangria') {
    // Disponível real em gaveta: fundo + suprimentos + vendas/pagamentos em
    // dinheiro (pedidos fechados E abertos) − sangrias anteriores.
    const ap = apuradoPorForma(db, sessao);
    if (ap.esperado.dinheiro < valor) {
      throw erro.validacao('Sangria excede o dinheiro disponível em caixa.');
    }
  }
  if (!motivo || String(motivo).trim().length < 3) throw erro.validacao('Motivo obrigatório (mínimo 3 caracteres).');
  const agora = agoraISO();
  const info = db.prepare(
    `INSERT INTO caixa_movimentacoes (sessao_id, tipo, forma, valor_centavos, motivo, usuario_id, autorizado_por, criado_em)
     VALUES (?, ?, 'dinheiro', ?, ?, ?, ?, ?)`
  ).run(sessao.id, tipo, valor, String(motivo).trim().slice(0, 300), usuario.id, autorizadoPorId, agora);
  registrar(db, {
    usuarioId: usuario.id, acao: `caixa_${tipo}`, entidade: 'caixa_movimentacao', entidadeId: Number(info.lastInsertRowid),
    detalhes: { valor_centavos: valor, motivo: String(motivo).trim().slice(0, 300), autorizado_por: autorizadoPorId }, ip,
  });
  hub?.publicar('caixa.movimento', { sessao_id: sessao.id, tipo, valor_centavos: valor });
  return db.prepare('SELECT * FROM caixa_movimentacoes WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function fechar(db, sessao, usuario, conferencia, observacoes, ip, hub) {
  if (!sessao || sessao.status !== 'aberto') throw erro.conflito('409_CAIXA_FECHADO', 'Caixa não está aberto.');
  const conf = {};
  for (const forma of FORMAS) {
    const informado = conferencia?.[forma];
    if (informado === undefined || informado === null) continue;
    conf[forma] = { esperado: null, informado: assertCentavos(informado, `conferencia.${forma}`) };
  }
  if (!('dinheiro' in conf)) throw erro.validacao('Conferência do dinheiro é obrigatória no fechamento.');
  const ap = apuradoPorForma(db, sessao);
  for (const forma of Object.keys(conf)) {
    conf[forma].esperado = ap.esperado[forma];
    conf[forma].diferenca = conf[forma].informado - conf[forma].esperado;
  }
  const divergencia = conf.dinheiro.informado - conf.dinheiro.esperado;
  const agora = agoraISO();
  db.prepare(
    `UPDATE caixa_sessoes SET status='fechado', fechado_em=?, usuario_fechamento=?, conferencia_json=?, divergencia_dinheiro_centavos=?, observacoes=?
     WHERE id = ?`
  ).run(agora, usuario.id, JSON.stringify(conf), divergencia, observacoes ?? null, sessao.id);
  registrar(db, {
    usuarioId: usuario.id, acao: 'caixa_fechamento', entidade: 'caixa_sessao', entidadeId: sessao.id,
    detalhes: { conferencia: conf, divergencia_dinheiro_centavos: divergencia }, ip,
  });
  hub?.publicar('caixa.fechado', { sessao_id: sessao.id, divergencia_dinheiro_centavos: divergencia });
  return db.prepare('SELECT * FROM caixa_sessoes WHERE id = ?').get(sessao.id);
}

export function historico(db, limite = 50) {
  return db.prepare(
    `SELECT cs.*, ua.nome AS usuario_abertura_nome, uf.nome AS usuario_fechamento_nome
     FROM caixa_sessoes cs
     JOIN usuarios ua ON ua.id = cs.usuario_abertura
     LEFT JOIN usuarios uf ON uf.id = cs.usuario_fechamento
     ORDER BY cs.id DESC LIMIT ?`
  ).all(limite);
}


// Detalhe completo de uma sessão (aberta ou fechada) para PDF de fechamento (A3 item 3.13).
export function detalheSessao(db, sessaoId) {
  const sessao = db.prepare(
    `SELECT cs.*, ua.nome AS usuario_abertura_nome, uf.nome AS usuario_fechamento_nome
     FROM caixa_sessoes cs JOIN usuarios ua ON ua.id = cs.usuario_abertura
     LEFT JOIN usuarios uf ON uf.id = cs.usuario_fechamento WHERE cs.id = ?`
  ).get(sessaoId);
  if (!sessao) throw erro.naoEncontrado('Sessão de caixa não encontrada.');
  const ap = apuradoPorForma(db, sessao);
  const movs = db.prepare(
    `SELECT m.*, u.nome AS usuario_nome FROM caixa_movimentacoes m JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.sessao_id = ? ORDER BY m.id`
  ).all(sessaoId);
  const vendas = db.prepare(
    `SELECT p.id, p.tipo, p.total_fechado_centavos, p.desconto_centavos, p.aberto_em, p.fechado_em,
            u.nome AS fechado_por_nome, m.numero AS mesa_numero, p.comanda_nome
     FROM pedidos p LEFT JOIN usuarios u ON u.id = p.fechado_por LEFT JOIN mesas m ON m.id = p.mesa_id
     WHERE p.caixa_sessao_id = ? AND p.status = 'fechado' ORDER BY p.fechado_em`
  ).all(sessaoId);
  return { sessao, ...ap, movimentacoes: movs, vendas };
}
