import { erro } from '../core/errors.js';
import { dataISO, texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';

// Metodologia (documentada no manual e em docs/):
// - Bruto = soma dos itens ATIVOS (preço + adicionais × qtd) dos pedidos FECHADOS no período.
// - Descontos = desconto aplicado nos pedidos fechados.
// - Cancelamentos = valor dos itens CANCELADOS desses pedidos (não entra no bruto).
// - Líquido = total_fechado (bruto − desconto) = pagamentos não estornados dos pedidos fechados.
// - Ticket médio = líquido ÷ nº de pedidos fechados.
// - Margem estimada = líquido − custo atual dos produtos (estimativa, custo pode ter mudado).
export function resumo(db, deStr, ateStr) {
  const de = dataISO(deStr, 'de');
  const ate = dataISO(ateStr, 'ate');
  if (de > ate) throw erro.validacao('"de" deve ser anterior a "ate".');
  const deISO = de.toISOString();
  const ateISO = new Date(ate.getTime() + 24 * 3600_000 - 1).toISOString(); // inclusive

  const fechados = db.prepare(
    `SELECT id, total_fechado_centavos, desconto_centavos, aberto_em, fechado_em FROM pedidos
     WHERE status = 'fechado' AND fechado_em BETWEEN ? AND ?`
  ).all(deISO, ateISO);
  const ids = fechados.map((p) => p.id);

  let bruto = 0, descontos = 0, liquido = 0;
  for (const p of fechados) {
    bruto += p.total_fechado_centavos + p.desconto_centavos;
    descontos += p.desconto_centavos;
    liquido += p.total_fechado_centavos;
  }

  let cancelamentos = 0;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    cancelamentos = db.prepare(
      `SELECT COALESCE(SUM((i.preco_unit_centavos + COALESCE((SELECT SUM(a.preco_centavos*a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = i.id),0)) * i.quantidade),0) AS v
       FROM pedido_itens i WHERE i.pedido_id IN (${placeholders}) AND i.status = 'cancelado'`
    ).get(...ids).v;
  }

  const porForma = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT forma, SUM(valor_centavos) AS total FROM pagamentos
       WHERE pedido_id IN (${placeholders}) AND estornado = 0 GROUP BY forma`
    ).all(...ids);
    for (const r of rows) porForma[r.forma] = r.total;
  }

  const topProdutos = ids.length ? db.prepare(
    `SELECT i.nome_produto AS nome, SUM(i.quantidade) AS quantidade,
            SUM((i.preco_unit_centavos + COALESCE((SELECT SUM(a.preco_centavos*a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = i.id),0)) * i.quantidade) AS valor_centavos
     FROM pedido_itens i WHERE i.pedido_id IN (${ids.map(() => '?').join(',')}) AND i.status = 'ativo'
     GROUP BY i.nome_produto ORDER BY quantidade DESC LIMIT 15`
  ).all(...ids) : [];

  // Margem estimada (custo atual do produto — estimativa)
  let custoEstimado = 0;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    custoEstimado = db.prepare(
      `SELECT COALESCE(SUM(COALESCE(pr.custo_centavos,0) * i.quantidade),0) AS c
       FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id
       WHERE i.pedido_id IN (${placeholders}) AND i.status = 'ativo'`
    ).get(...ids).c;
  }

  // Horários de pico (vendas fechadas por hora)
  const porHora = {};
  for (const p of fechados) {
    const h = new Date(p.fechado_em).getHours();
    porHora[h] = (porHora[h] ?? 0) + p.total_fechado_centavos;
  }

  const qtd = fechados.length;
  return {
    periodo: { de: deISO, ate: ateISO },
    pedidos_fechados: qtd,
    bruto_centavos: bruto,
    descontos_centavos: descontos,
    cancelamentos_centavos: cancelamentos,
    liquido_centavos: liquido,
    ticket_medio_centavos: qtd ? Math.round(liquido / qtd) : 0,
    margem_estimada_centavos: liquido - custoEstimado,
    por_forma: porForma,
    top_produtos: topProdutos,
    por_hora: porHora,
    metodologia: {
      bruto: 'itens ativos dos pedidos fechados no período',
      liquido: 'total fechado (bruto - descontos) = pagamentos não estornados',
      cancelamentos: 'itens cancelados (informativo, fora do bruto)',
      margem: 'ESTIMADA com custo atual dos produtos — não é valor contábil',
    },
  };
}

export function vendasDoPeriodo(db, deStr, ateStr, limite = 300) {
  const de = dataISO(deStr, 'de');
  const ate = dataISO(ateStr, 'ate');
  if (de > ate) throw erro.validacao('"de" deve ser anterior a "ate".');
  return db.prepare(
    `SELECT p.id, p.tipo, p.total_fechado_centavos, p.desconto_centavos, p.aberto_em, p.fechado_em,
            u.nome AS fechado_por_nome, m.numero AS mesa_numero, p.comanda_nome
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.fechado_por
     LEFT JOIN mesas m ON m.id = p.mesa_id
     WHERE p.status = 'fechado' AND p.fechado_em BETWEEN ? AND ?
     ORDER BY p.fechado_em DESC LIMIT ?`
  ).all(de.toISOString(), new Date(ate.getTime() + 24 * 3600_000 - 1).toISOString(), limite);
}


// Fechamento de salão (A3 item 3.17): por garçom, comandas atendidas e itens
// entregues no período; assinatura do responsável com auditoria.
export function fechamentoSalao(db, deStr, ateStr) {
  const de = dataISO(deStr, 'de');
  const ate = dataISO(ateStr, 'ate');
  if (de > ate) throw erro.validacao('"de" deve ser anterior a "ate".');
  const deISO = de.toISOString();
  const ateISO = new Date(ate.getTime() + 24 * 3600_000 - 1).toISOString();
  const porGarcom = db.prepare(
    `SELECT u.id AS garcom_id, u.nome AS garcom_nome,
            COUNT(DISTINCT p.id) AS comandas,
            COALESCE(SUM(p.total_fechado_centavos), 0) AS total_centavos,
            COALESCE(SUM((SELECT SUM(i.quantidade) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.status = 'ativo' AND i.kds_status = 'entregue')), 0) AS itens_entregues
     FROM pedidos p JOIN usuarios u ON u.id = p.garcom_id
     WHERE p.tipo = 'mesa' AND p.status = 'fechado' AND p.fechado_em BETWEEN ? AND ?
     GROUP BY u.id ORDER BY total_centavos DESC`
  ).all(deISO, ateISO);
  const assinados = db.prepare(
    `SELECT f.*, u.nome AS responsavel_nome FROM fechamentos_salao f JOIN usuarios u ON u.id = f.responsavel_id
     WHERE f.periodo_de <= ? AND f.periodo_ate >= ? ORDER BY f.id DESC LIMIT 10`
  ).all(ateISO.slice(0, 10), deISO.slice(0, 10));
  return { periodo: { de: deISO, ate: ateISO }, por_garcom: porGarcom, assinados };
}

export function salvarFechamentoSalao(db, usuario, body, ip) {
  const periodo_de = texto(body?.periodo_de, 'periodo_de', { maximo: 10 });
  const periodo_ate = texto(body?.periodo_ate, 'periodo_ate', { maximo: 10 });
  const assinatura = typeof body?.assinatura_png === 'string' ? body.assinatura_png : '';
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{100,200000}$/.test(assinatura)) {
    throw erro.validacao('Assinatura inválida (desenhe no painel).');
  }
  const resumo = fechamentoSalao(db, periodo_de, periodo_ate);
  const info = db.prepare(
    `INSERT INTO fechamentos_salao (periodo_de, periodo_ate, responsavel_id, assinatura_png, resumo_json, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(periodo_de, periodo_ate, usuario.id, assinatura, JSON.stringify(resumo.por_garcom), new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  registrar(db, {
    usuarioId: usuario.id, acao: 'fechamento_salao_assinado', entidade: 'fechamento_salao', entidadeId: id,
    detalhes: { periodo_de, periodo_ate, comandas: resumo.por_garcom.reduce((s, g) => s + g.comandas, 0) }, ip,
  });
  return { id, ...resumo };
}
