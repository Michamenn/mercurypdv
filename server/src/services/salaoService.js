// ============================================================
// Salão Pro: mapa visual, layout, comandas individuais,
// transferência/junção de mesas, check-in, gorjeta e comissões.
// ============================================================
import { erro } from '../core/errors.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';
import { obterTodas } from './configService.js';
import { calcularTotais, soltarMesaSeVazia, aplicarTaxaServico } from './pedidosService.js';

const MINUTOS = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 60000) : null);

// ---------- Mapa do salão ----------
// Uma linha por mesa, com as comandas abertas agregadas. Usa subconsulta
// (não LEFT JOIN) para não multiplicar linhas quando há comanda individual.
export function mapaSalao(db) {
  const cfg = obterTodas(db);
  const limiteOcioso = Math.max(1, Number(cfg.mesa_ociosa_minutos) || 45);
  const nomenclatura = cfg.nomenclatura_pedido === 'comanda' ? 'comanda' : 'mesa';

  const mesas = db.prepare('SELECT * FROM mesas ORDER BY setor, numero').all();
  const abertas = db.prepare(
    `SELECT id, mesa_id FROM pedidos WHERE status = 'aberto' AND mesa_id IS NOT NULL`
  ).all();

  // Totais por mesa reaproveitando calcularTotais(): uma única fonte de
  // verdade para o dinheiro (nada de SQL de total duplicado aqui).
  const porMesa = new Map();
  for (const p of abertas) {
    const t = calcularTotais(db, p.id);
    const acc = porMesa.get(p.mesa_id) ?? { comandas: 0, total: 0, maisAntiga: null };
    acc.comandas++;
    acc.total += t.total_centavos;
    porMesa.set(p.mesa_id, acc);
  }
  // "Aberta há" usa a comanda mais antiga da mesa.
  const maisAntigas = db.prepare(
    `SELECT mesa_id, MIN(aberto_em) AS mais_antiga FROM pedidos
     WHERE status = 'aberto' AND mesa_id IS NOT NULL GROUP BY mesa_id`
  ).all();
  const desdeAbertura = new Map(maisAntigas.map((r) => [r.mesa_id, r.mais_antiga]));

  return {
    largura: Math.max(400, Number(cfg.layout_salao_largura) || 1200),
    altura: Math.max(300, Number(cfg.layout_salao_altura) || 800),
    limite_ociosa_min: limiteOcioso,
    nomenclatura,
    mesas: mesas.map((m) => {
      const acc = porMesa.get(m.id);
      const minutos = MINUTOS(
        m.status === 'livre' ? m.ociosa_desde : desdeAbertura.get(m.id) ?? m.ociosa_desde
      );
      // Mesa ociosa: livre e parada além do limite.
      const ociosa = m.status === 'livre' && minutos !== null && minutos >= limiteOcioso;
      return {
        ...m,
        rotulo: nomenclatura === 'comanda' ? `Comanda ${m.numero}` : `Mesa ${m.numero}`,
        comandas_abertas: acc?.comandas ?? 0,
        total_aberto_centavos: acc?.total ?? 0,
        minutos_parada: minutos,
        ociosa,
      };
    }),
  };
}

// Detalhe de uma mesa: comandas abertas com itens e totais.
export function detalheMesa(db, mesaId) {
  const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
  if (!mesa) throw erro.naoEncontrado('Mesa não encontrada.');
  const comandas = db.prepare(
    `SELECT p.*, u.nome AS garcom_nome, u2.nome AS atendente_nome, cl.nome AS cliente_nome
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.garcom_id
     LEFT JOIN usuarios u2 ON u2.id = p.atendente_id
     LEFT JOIN clientes cl ON cl.id = p.cliente_id
     WHERE p.mesa_id = ? AND p.status = 'aberto'
     ORDER BY p.id`
  ).all(mesaId);
  return {
    mesa,
    comandas: comandas.map((p) => ({ ...p, totais: calcularTotais(db, p.id) })),
  };
}

// ---------- Layout do salão ----------
export function salvarLayout(db, usuario, body, ip) {
  const itens = Array.isArray(body?.mesas) ? body.mesas.slice(0, 500) : [];
  if (!itens.length) throw erro.validacao('Informe ao menos uma mesa com posição.');
  const inteiro = (v, padrao) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : padrao;
  };
  return transacao(db, () => {
    let salvas = 0;
    for (const it of itens) {
      const id = Number(it?.id);
      if (!Number.isInteger(id)) continue;
      const mesa = db.prepare('SELECT id, numero FROM mesas WHERE id = ?').get(id);
      if (!mesa) continue;
      db.prepare(
        `UPDATE mesas SET pos_x = ?, pos_y = ?, largura = ?, altura = ?, formato = ?, assentos = ?
         WHERE id = ?`
      ).run(
        Math.max(0, inteiro(it.pos_x, 40)),
        Math.max(0, inteiro(it.pos_y, 40)),
        Math.max(60, Math.min(600, inteiro(it.largura, 110))),
        Math.max(60, Math.min(600, inteiro(it.altura, 110))),
        it.formato === 'redonda' ? 'redonda' : 'retangular',
        Math.max(1, Math.min(40, inteiro(it.assentos, 4))),
        id
      );
      salvas++;
    }
    registrar(db, { usuarioId: usuario.id, acao: 'layout_salão_salvo', entidade: 'mesas', entidadeId: null, detalhes: { salvas }, ip });
    return { ok: true, salvas };
  });
}

// ---------- Transferência de mesa ----------
// Move as comandas abertas de uma mesa para outra. A mesa de origem fica
// livre; a de destino passa a ocupada. Sem comandas, apenas libera a origem.
export function transferirMesa(db, usuario, origemId, destinoId, ip, hub, motivo = null) {
  return transacao(db, () => {
    const origem = db.prepare('SELECT * FROM mesas WHERE id = ?').get(origemId);
    const destino = db.prepare('SELECT * FROM mesas WHERE id = ?').get(destinoId);
    if (!origem || !destino) throw erro.naoEncontrado('Mesa de origem ou destino não encontrada.');
    if (origem.id === destino.id) throw erro.validacao('Origem e destino devem ser mesas diferentes.');
    if (destino.bloqueada) throw erro.conflito('409_MESA_OCUPADA', `Mesa ${destino.numero} está bloqueada.`);
    const destinoOcupado = db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos WHERE mesa_id = ? AND status = 'aberto'`
    ).get(destino.id).n;
    if (destinoOcupado > 0 && !destino.status.includes('ocupada')) {
      throw erro.conflito('409_MESA_OCUPADA', `Mesa ${destino.numero} já tem comanda aberta. Use "juntar mesas".`);
    }

    const comandas = db.prepare(`SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'aberto'`).all(origem.id);
    const agora = agoraISO();
    for (const c of comandas) {
      db.prepare('UPDATE pedidos SET mesa_id = ? WHERE id = ?').run(destino.id, c.id);
    }
    soltarMesaSeVazia(db, origem.id, agora);
    if (comandas.length) {
      db.prepare(`UPDATE mesas SET status = 'ocupada', ociosa_desde = NULL WHERE id = ?`).run(destino.id);
    }
    db.prepare(
      `INSERT INTO mesa_movimentacoes (tipo, mesa_origem_id, mesa_destino_id, mesas_envolvidas, pedidos_envolvidos, usuario_id, motivo, criado_em)
       VALUES ('transferencia', ?, ?, ?, ?, ?, ?, ?)`
    ).run(origem.id, destino.id, JSON.stringify([origem.id, destino.id]),
          JSON.stringify(comandas.map((c) => c.id)), usuario.id, motivo ? String(motivo).slice(0, 200) : null, agora);
    registrar(db, { usuarioId: usuario.id, acao: 'mesa_transferida', entidade: 'mesa', entidadeId: origem.id, detalhes: { destino: destino.id, comandas: comandas.length }, ip });
    setImmediate(() => {
      hub?.publicar('mesa.atualizada', { mesa_id: origem.id, status: 'livre' });
      hub?.publicar('mesa.atualizada', { mesa_id: destino.id, status: 'ocupada' });
    });
    return { ok: true, mesas: [origem.numero, destino.numero], comandas_movidas: comandas.length };
  });
}

// ---------- Junção de mesas ----------
// Consolida as comandas abertas de várias mesas em uma só. As comandas são
// PRESERVADAS (não somadas): cada cliente continua com a sua conta, apenas
// passam a pertencer à mesa de destino.
export function juntarMesas(db, usuario, mesaIds, destinoId, ip, hub, motivo = null) {
  const ids = [...new Set((Array.isArray(mesaIds) ? mesaIds : []).map(Number).filter(Number.isInteger))];
  if (ids.length < 2) throw erro.validacao('Selecione ao menos 2 mesas para juntar.');
  if (!ids.includes(Number(destinoId))) throw erro.validacao('A mesa de destino deve estar entre as selecionadas.');
  return transacao(db, () => {
    const destino = db.prepare('SELECT * FROM mesas WHERE id = ?').get(destinoId);
    if (!destino) throw erro.naoEncontrado('Mesa de destino não encontrada.');
    if (destino.bloqueada) throw erro.conflito('409_MESA_OCUPADA', `Mesa ${destino.numero} está bloqueada.`);
    const agora = agoraISO();
    const comandas = [];
    for (const id of ids) {
      const abertas = db.prepare(`SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'aberto'`).all(id);
      for (const c of abertas) {
        if (id === destino.id) continue;
        db.prepare('UPDATE pedidos SET mesa_id = ? WHERE id = ?').run(destino.id, c.id);
        comandas.push(c.id);
      }
      if (id !== destino.id) soltarMesaSeVazia(db, id, agora);
    }
    db.prepare(`UPDATE mesas SET status = 'ocupada', ociosa_desde = NULL WHERE id = ?`).run(destino.id);
    db.prepare(
      `INSERT INTO mesa_movimentacoes (tipo, mesa_origem_id, mesa_destino_id, mesas_envolvidas, pedidos_envolvidos, usuario_id, motivo, criado_em)
       VALUES ('juncao', NULL, ?, ?, ?, ?, ?, ?)`
    ).run(destino.id, JSON.stringify(ids), JSON.stringify(comandas), usuario.id,
          motivo ? String(motivo).slice(0, 200) : null, agora);
    registrar(db, { usuarioId: usuario.id, acao: 'mesas_juntas', entidade: 'mesa', entidadeId: destino.id, detalhes: { mesas: ids, comandas: comandas.length }, ip });
    setImmediate(() => {
      for (const id of ids) hub?.publicar('mesa.atualizada', { mesa_id: id, status: id === destino.id ? 'ocupada' : 'livre' });
    });
    return { ok: true, destino: destino.numero, comandas_movidas: comandas.length };
  });
}

// ---------- Check-in de cliente ----------
export function buscarClientes(db, termo, limite = 20) {
  const t = String(termo ?? '').trim();
  if (!t) return db.prepare('SELECT * FROM clientes ORDER BY nome LIMIT ?').all(Math.min(50, limite));
  return db.prepare(
    `SELECT * FROM clientes
     WHERE nome LIKE ? OR IFNULL(documento,'') LIKE ? OR IFNULL(telefone,'') LIKE ?
     ORDER BY nome LIMIT ?`
  ).all(`%${t}%`, `%${t}%`, `%${t}%`, Math.min(50, limite));
}

export function criarCliente(db, usuario, body, ip) {
  const nome = String(body?.nome ?? '').trim().slice(0, 80);
  if (nome.length < 2) throw erro.validacao('Nome do cliente é obrigatório (mín. 2 caracteres).');
  const documento = String(body?.documento ?? '').trim().slice(0, 20) || null;
  const telefone = String(body?.telefone ?? '').trim().slice(0, 20) || null;
  const observacao = String(body?.observacao ?? '').trim().slice(0, 200) || null;
  return transacao(db, () => {
    if (documento) {
      const dup = db.prepare('SELECT id FROM clientes WHERE documento = ?').get(documento);
      if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe cliente com este documento.');
    }
    const info = db.prepare(
      `INSERT INTO clientes (nome, documento, telefone, observacao, criado_em, criado_por) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nome, documento, telefone, observacao, agoraISO(), usuario.id);
    registrar(db, { usuarioId: usuario.id, acao: 'cliente_criado', entidade: 'cliente', entidadeId: Number(info.lastInsertRowid), detalhes: { nome }, ip });
    return db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

// ---------- Vínculo do atendente ----------
// Rebreve o garçom responsável pela comanda (atendente). Automático por padrão:
// sem atendente explícito, assume o garçom que abriu.
export function definirAtendente(db, usuario, pedidoId, atendenteId, ip, hub) {
  return transacao(db, () => {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
    if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Só é possível vincular atendente em comanda aberta.');
    const alvo = Number(atendenteId) || usuario.id;
    const atendente = db.prepare(`SELECT id, nome, cargo FROM usuarios WHERE id = ? AND ativo = 1`).get(alvo);
    if (!atendente) throw erro.naoEncontrado('Usuário atendente não encontrado ou inativo.');
    db.prepare('UPDATE pedidos SET atendente_id = ? WHERE id = ?').run(atendente.id, pedidoId);
    registrar(db, { usuarioId: usuario.id, acao: 'atendente_vinculado', entidade: 'pedido', entidadeId: pedidoId, detalhes: { atendente: atendente.nome }, ip });
    setImmediate(() => hub?.publicar('pedido.atualizado', { pedido_id: pedidoId }));
    return { ok: true, pedido_id: pedidoId, atendente_id: atendente.id, atendente_nome: atendente.nome };
  });
}

// ---------- Gorjeta ----------
// Gorjeta NÃO entra no total da venda (ver calcularTotais): é registro de
// comissão. O dinheiro da gorjeta é movimentado no caixa à parte.
export function registrarGorjeta(db, usuario, pedidoId, body, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  const valor = Number(body?.valor_centavos);
  if (!Number.isInteger(valor) || valor <= 0) throw erro.validacao('Valor da gorjeta deve ser maior que zero.');
  const forma = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao'].includes(body?.forma) ? body.forma : 'dinheiro';
  const garcomId = Number(body?.garcom_id) || pedido.atendente_id || pedido.garcom_id;
  if (!garcomId) throw erro.validacao('Informe o garçom que recebeu a gorjeta.');
  const garcom = db.prepare('SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1').get(garcomId);
  if (!garcom) throw erro.naoEncontrado('Garçom não encontrado ou inativo.');

  return transacao(db, () => {
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO gorjetas (pedido_id, garcom_id, valor_centavos, forma, observacao, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pedidoId, garcom.id, valor, forma, String(body?.observacao ?? '').trim().slice(0, 200) || null, usuario.id, agora);
    // Espelha no pedido para conferência rápida na comanda.
    db.prepare('UPDATE pedidos SET gorjeta_centavos = gorjeta_centavos + ? WHERE id = ?').run(valor, pedidoId);
    registrar(db, { usuarioId: usuario.id, acao: 'gorjeta_registrada', entidade: 'gorjeta', entidadeId: Number(info.lastInsertRowid), detalhes: { pedido_id: pedidoId, garcom: garcom.nome, valor_centavos: valor }, ip });
    setImmediate(() => hub?.publicar('pedido.atualizado', { pedido_id: pedidoId }));
    return db.prepare('SELECT * FROM gorjetas WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

// ---------- Taxa: reprecificação em massa ----------
// Ao mudar a configuração da taxa, as comandas JÁ ABERTAS precisam acompanhar.
// Sem isso, ligar a taxa só valeria para comandas abertas depois do ajuste —
// o caixa veria a tela mostrando 10% e a comanda antiga continuaria sem taxa.
export function recalcularTaxasAbertas(db) {
  const abertas = db.prepare(`SELECT id FROM pedidos WHERE status = 'aberto'`).all();
  for (const p of abertas) aplicarTaxaServico(db, p.id);
  return { recalculadas: abertas.length };
}

// ---------- Comissões ----------
// Base:Gorjeta de cada garçom. Com taxa (%) mostra também o valor a pagar.
export function comissoes(db, de, ate) {
  const pct = Math.max(0, Math.min(100, Number(obterTodas(db).comissao_pct) || 0));
  const filtro = de && ate ? 'AND substr(g.criado_em,1,10) BETWEEN ? AND ?' : '';
  const params = de && ate ? [de, ate] : [];
  const porGarcom = db.prepare(
    `SELECT u.id, u.nome,
            COALESCE(SUM(g.valor_centavos), 0) AS gorjeta_centavos,
            COUNT(g.id) AS quantidade,
            COUNT(DISTINCT g.pedido_id) AS comandas
     FROM usuarios u
     LEFT JOIN gorjetas g ON g.garcom_id = u.id AND g.estornado = 0 ${filtro}
     WHERE u.cargo = 'garcom'
     GROUP BY u.id, u.nome
     ORDER BY gorjeta_centavos DESC`
  ).all(...params);

  const vendas = db.prepare(
    `SELECT u.id, u.nome,
            COUNT(p.id) AS comandas,
            COALESCE(SUM(p.total_fechado_centavos), 0) AS vendido_centavos,
            COALESCE(SUM(p.taxa_servico_centavos), 0) AS taxa_centavos
     FROM usuarios u
     LEFT JOIN pedidos p ON p.garcom_id = u.id AND p.status = 'fechado'
       ${de && ate ? 'AND substr(p.fechado_em,1,10) BETWEEN ? AND ?' : ''}
     WHERE u.cargo = 'garcom'
     GROUP BY u.id, u.nome
     ORDER BY vendido_centavos DESC`
  ).all(...params);

  const vendasPor = new Map(vendas.map((v) => [v.id, v]));
  const linhas = porGarcom.map((g) => {
    const v = vendasPor.get(g.id);
    const venda = v?.vendido_centavos ?? 0;
    return {
      garcom_id: g.id,
      garcom_nome: g.nome,
      gorjeta_centavos: g.gorjeta_centavos,
      gorjeta_ocorrencias: g.quantidade,
      comandas_com_gorjeta: g.comandas,
      comandas_fechadas: v?.comandas ?? 0,
      vendido_centavos: venda,
      ticket_medio_centavos: v?.comandas ? Math.round(venda / v.comandas) : 0,
      comissao_pct: pct,
      // Comissão incide sobre a gorjeta (regra padrão); a venda fica à parte.
      comissao_centavos: Math.round((g.gorjeta_centavos * pct) / 100),
    };
  });
  return {
    comissao_pct: pct,
    base: 'gorjeta',
    por_garcom: linhas,
    total_gorjeta_centavos: linhas.reduce((s, l) => s + l.gorjeta_centavos, 0),
    total_comissao_centavos: linhas.reduce((s, l) => s + l.comissao_centavos, 0),
    total_vendido_centavos: linhas.reduce((s, l) => s + l.vendido_centavos, 0),
  };
}