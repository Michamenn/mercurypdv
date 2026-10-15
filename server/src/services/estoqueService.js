import { erro } from '../core/errors.js';
import { assertInt } from '../core/money.js';
import { texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';

// Estoque em MILÉSIMOS da unidade (1.500 g = 1500000) para precisão inteira.
// Modelo A2: ingredientes.quantidade_mil = total físico; estoque_lotes detalha
// por lote/validade/local (FIFO); ingrediente_locais espelha por local.
// Ordem de consumo: validade mais próxima primeiro (vencidos nunca),
// depois prioridade de local (bar, salão, câmara fria, depósito).

export const LOCAIS = ['deposito', 'camara_fria', 'bar', 'salao'];
const PRIORIDADE_LOCAL = { bar: 0, salao: 1, camara_fria: 2, deposito: 3 };
const TIPOS_SAIDA = ['saida_venda', 'perda', 'sobra', 'quebra', 'vencimento', 'ajuste', 'inventario'];

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function ordemLotes(db, ingredienteId, { excluirVencidos = true } = {}) {
  const hoje = hojeISO();
  const lotes = db.prepare(
    `SELECT * FROM estoque_lotes WHERE ingrediente_id = ? AND quantidade_mil > 0 ORDER BY id`
  ).all(ingredienteId);
  const validos = excluirVencidos ? lotes.filter((l) => !l.validade || l.validade >= hoje) : lotes;
  return validos.sort((a, b) => {
    const va = a.validade ?? '9999-12-31';
    const vb = b.validade ?? '9999-12-31';
    if (va !== vb) return va < vb ? -1 : 1;
    const pa = PRIORIDADE_LOCAL[a.local] ?? 9;
    const pb = PRIORIDADE_LOCAL[b.local] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });
}

function somaDisponivel(db, ingredienteId) {
  const hoje = hojeISO();
  const r = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN validade IS NULL OR validade >= ? THEN quantidade_mil ELSE 0 END), 0) AS disp,
            COALESCE(SUM(quantidade_mil), 0) AS total
     FROM estoque_lotes WHERE ingrediente_id = ?`
  ).get(hoje, ingredienteId);
  const temValidade = db.prepare(
    `SELECT COUNT(*) AS n FROM estoque_lotes WHERE ingrediente_id = ? AND validade IS NOT NULL`
  ).get(ingredienteId).n;
  return { disponivel: r.disp, total: r.total, controlaValidade: temValidade > 0 };
}

function ajustarLocais(db, ingredienteId, local, delta) {
  if (!local) return;
  db.prepare(
    `INSERT INTO ingrediente_locais (ingrediente_id, local, quantidade_mil) VALUES (?, ?, MAX(0, ?))
     ON CONFLICT(ingrediente_id, local) DO UPDATE SET quantidade_mil = MAX(0, quantidade_mil + ?)`
  ).run(ingredienteId, local, delta, delta);
}

// Núcleo de baixa FIFO. Política AD-004: venda nunca bloqueada por falta;
// o que faltar reduz o total (pode negativar) e é registrado.
export function consumirFIFO(db, { ingrediente_id, quantidade_mil, tipo = 'saida_venda', ref_tipo = null, ref_id = null, usuario_id, observacao = '', local_mov = null }) {
  if (!TIPOS_SAIDA.includes(tipo)) throw erro.validacao('Tipo de baixa inválido.');
  const qtd = assertInt(quantidade_mil, 'quantidade_mil', { minimo: 1 });
  const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ? AND ativo = 1').get(ingrediente_id);
  if (!ing) throw erro.naoEncontrado('Ingrediente não encontrado.');
  let restante = qtd;
  for (const lote of ordemLotes(db, ingrediente_id)) {
    if (restante <= 0) break;
    const usa = Math.min(lote.quantidade_mil, restante);
    db.prepare('UPDATE estoque_lotes SET quantidade_mil = quantidade_mil - ? WHERE id = ?').run(usa, lote.id);
    ajustarLocais(db, ingrediente_id, lote.local, -usa);
    restante -= usa;
  }
  const novoTotal = ing.quantidade_mil - qtd;
  db.prepare('UPDATE ingredientes SET quantidade_mil = ? WHERE id = ?').run(novoTotal, ingrediente_id);
  const info = db.prepare(
    `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, ref_tipo, ref_id, usuario_id, observacao, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ingrediente_id, tipo, qtd, novoTotal, local_mov, ref_tipo, ref_id, usuario_id, observacao || tipo, agoraISO());
  return { movimentacao_id: Number(info.lastInsertRowid), saldo_apos_mil: novoTotal, faltou_mil: restante };
}

export function listarIngredientes(db, { apenasBaixos = false } = {}) {
  const rows = db.prepare(`SELECT * FROM ingredientes WHERE ativo = 1 ORDER BY nome`).all();
  const hoje = hojeISO();
  const out = rows.map((r) => {
    const disp = somaDisponivel(db, r.id);
    const locais = db.prepare('SELECT local, quantidade_mil FROM ingrediente_locais WHERE ingrediente_id = ?').all(r.id);
    const vencidos = db.prepare(
      `SELECT COALESCE(SUM(quantidade_mil),0) AS v FROM estoque_lotes WHERE ingrediente_id = ? AND validade IS NOT NULL AND validade < ? AND quantidade_mil > 0`
    ).get(r.id, hoje).v;
    return {
      ...r,
      em_alerta: r.quantidade_mil < r.minimo_mil,
      disponivel_mil: disp.disponivel,
      controla_validade: disp.controlaValidade ? 1 : 0,
      vencidos_mil: vencidos,
      locais,
      quantidade_formatada: (r.quantidade_mil / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' ' + r.unidade,
    };
  });
  return apenasBaixos ? out.filter((r) => r.quantidade_mil < r.minimo_mil) : out;
}

export function criarIngrediente(db, usuario, body, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 80 });
  const unidade = ['g', 'ml', 'un'].includes(body?.unidade) ? body.unidade : 'g';
  const quantidade = assertInt(body?.quantidade_mil ?? 0, 'quantidade_mil', { minimo: 0 });
  const minimo = assertInt(body?.minimo_mil ?? 0, 'minimo_mil', { minimo: 0 });
  const local = LOCAIS.includes(body?.local) ? body.local : 'deposito';
  return transacao(db, () => {
    const dup = db.prepare('SELECT id FROM ingredientes WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe ingrediente com esse nome.');
    const info = db.prepare('INSERT INTO ingredientes (nome, unidade, quantidade_mil, minimo_mil) VALUES (?, ?, ?, ?)')
      .run(nome, unidade, quantidade, minimo);
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO ingrediente_locais (ingrediente_id, local, quantidade_mil) VALUES (?, ?, ?)')
      .run(id, local, quantidade);
    if (quantidade > 0) {
      db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, criado_em)
        VALUES (?, 'inicial', NULL, ?, ?, ?)`)
        .run(id, local, quantidade, agoraISO());
      db.prepare(
        `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, ref_tipo, ref_id, usuario_id, observacao, criado_em)
         VALUES (?, 'entrada', ?, ?, ?, 'inicial', NULL, ?, 'saldo inicial', ?)`
      ).run(id, quantidade, quantidade, local, usuario.id, agoraISO());
    }
    registrar(db, { usuarioId: usuario.id, acao: 'ingrediente_criado', entidade: 'ingrediente', entidadeId: id, detalhes: { nome, unidade }, ip });
    return db.prepare('SELECT * FROM ingredientes WHERE id = ?').get(id);
  });
}

// Movimentação manual. Tipos: entrada (com lote/validade/local/custo), perda,
// sobra, quebra, vencimento, devolucao, ajuste.
export function movimentar(db, usuario, ingredienteId, body, ip, hub) {
  const tipo = ['entrada', 'perda', 'sobra', 'quebra', 'vencimento', 'devolucao', 'ajuste'].includes(body?.tipo) ? body.tipo : null;
  if (!tipo) throw erro.validacao('Tipo deve ser: entrada, perda, sobra, quebra, vencimento, devolucao ou ajuste.');
  const obs = texto(body?.observacao ?? '', 'observacao', { obrigatorio: false, maximo: 300 });
  const local = LOCAIS.includes(body?.local) ? body.local : 'deposito';
  return transacao(db, () => {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ? AND ativo = 1').get(ingredienteId);
    if (!ing) throw erro.naoEncontrado('Ingrediente não encontrado.');

    if (['perda', 'sobra', 'quebra', 'vencimento'].includes(tipo)) {
      const qtd = assertInt(body?.quantidade_mil, 'quantidade_mil', { minimo: 1 });
      consumirFIFO(db, { ingrediente_id: ingredienteId, quantidade_mil: qtd, tipo, usuario_id: usuario.id, observacao: obs || tipo, local_mov: local });
    } else if (tipo === 'entrada') {
      const qtd = assertInt(body?.quantidade_mil, 'quantidade_mil', { minimo: 1 });
      const lote = texto(body?.lote ?? 'avulso', 'lote', { obrigatorio: false, maximo: 40, padrao: 'avulso' }) || 'avulso';
      const validade = body?.validade ? String(body.validade).slice(0, 10) : null;
      if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) throw erro.validacao('Validade inválida (use AAAA-MM-DD).');
      const custo = body?.custo_total_centavos === undefined || body?.custo_total_centavos === null || body?.custo_total_centavos === ''
        ? null : assertInt(body.custo_total_centavos, 'custo_total_centavos', { minimo: 0 });
      const custoUnit = custo === null ? null : Math.round(custo / (qtd / 1000));
      db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, custo_unit_centavos, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ingredienteId, lote, validade, local, qtd, custoUnit, agoraISO());
      const novoSaldo = ing.quantidade_mil + qtd;
      db.prepare('UPDATE ingredientes SET quantidade_mil = ? WHERE id = ?').run(novoSaldo, ingredienteId);
      ajustarLocais(db, ingredienteId, local, qtd);
      db.prepare(
        `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, custo_total_centavos, usuario_id, observacao, criado_em)
         VALUES (?, 'entrada', ?, ?, ?, ?, ?, ?, ?)`
      ).run(ingredienteId, qtd, novoSaldo, local, custo, usuario.id, obs || `entrada lote ${lote}`, agoraISO());
    } else if (tipo === 'devolucao') {
      const qtd = assertInt(body?.quantidade_mil, 'quantidade_mil', { minimo: 1 });
      db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, criado_em)
        VALUES (?, 'devolucao', NULL, ?, ?, ?)`).run(ingredienteId, local, qtd, agoraISO());
      const novoSaldo = ing.quantidade_mil + qtd;
      db.prepare('UPDATE ingredientes SET quantidade_mil = ? WHERE id = ?').run(novoSaldo, ingredienteId);
      ajustarLocais(db, ingredienteId, local, qtd);
      db.prepare(
        `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, usuario_id, observacao, criado_em)
         VALUES (?, 'devolucao', ?, ?, ?, ?, ?, ?)`
      ).run(ingredienteId, qtd, novoSaldo, local, usuario.id, obs || 'devolucao', agoraISO());
    } else if (tipo === 'ajuste') {
      const novoSaldo = assertInt(body?.novo_saldo_mil, 'novo_saldo_mil', { minimo: 0 });
      const delta = novoSaldo - ing.quantidade_mil;
      if (delta > 0) {
        db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, criado_em)
          VALUES (?, 'ajuste', NULL, ?, ?, ?)`).run(ingredienteId, local, delta, agoraISO());
        ajustarLocais(db, ingredienteId, local, delta);
      } else if (delta < 0) {
        consumirFIFO(db, { ingrediente_id: ingredienteId, quantidade_mil: -delta, tipo: 'ajuste', usuario_id: usuario.id, observacao: obs || 'ajuste negativo', local_mov: local });
      }
      db.prepare('UPDATE ingredientes SET quantidade_mil = ? WHERE id = ?').run(novoSaldo, ingredienteId);
      if (delta >= 0) {
        db.prepare(
          `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, usuario_id, observacao, criado_em)
           VALUES (?, 'ajuste', ?, ?, ?, ?, ?, ?)`
        ).run(ingredienteId, Math.abs(delta) || 1, novoSaldo, local, usuario.id, obs || 'ajuste', agoraISO());
      }
    }
    registrar(db, {
      usuarioId: usuario.id, acao: `estoque_${tipo}`, entidade: 'ingrediente', entidadeId: ingredienteId,
      detalhes: { observacao: obs }, ip,
    });
    const resultado = db.prepare('SELECT * FROM ingredientes WHERE id = ?').get(ingredienteId);
    if (resultado.quantidade_mil < resultado.minimo_mil) {
      setImmediate(() => hub?.publicar('estoque.alerta', { ingrediente_id: ingredienteId, nome: resultado.nome, saldo_mil: resultado.quantidade_mil, minimo_mil: resultado.minimo_mil }));
    }
    return resultado;
  });
}

// Transferência entre locais (total preservado; move lotes mais antigos primeiro).
export function transferir(db, usuario, body, ip) {
  const ingredienteId = assertInt(body?.ingrediente_id, 'ingrediente_id', { minimo: 1 });
  const origem = LOCAIS.includes(body?.origem) ? body.origem : null;
  const destino = LOCAIS.includes(body?.destino) ? body.destino : null;
  if (!origem || !destino || origem === destino) throw erro.validacao('Origem e destino devem ser locais diferentes.');
  const qtd = assertInt(body?.quantidade_mil, 'quantidade_mil', { minimo: 1 });
  const motivo = texto(body?.motivo ?? '', 'motivo', { obrigatorio: false, maximo: 200 });
  return transacao(db, () => {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ? AND ativo = 1').get(ingredienteId);
    if (!ing) throw erro.naoEncontrado('Ingrediente não encontrado.');
    const naOrigem = db.prepare(
      `SELECT COALESCE(SUM(quantidade_mil),0) AS t FROM estoque_lotes WHERE ingrediente_id = ? AND local = ? AND quantidade_mil > 0`
    ).get(ingredienteId, origem).t;
    if (naOrigem < qtd) throw erro.validacao(`Origem "${origem}" tem apenas ${(naOrigem / 1000).toLocaleString('pt-BR')} ${ing.unidade}.`);
    let restante = qtd;
    for (const lote of db.prepare(
      `SELECT * FROM estoque_lotes WHERE ingrediente_id = ? AND local = ? AND quantidade_mil > 0 ORDER BY validade IS NULL, validade, id`
    ).all(ingredienteId, origem)) {
      if (restante <= 0) break;
      const move = Math.min(lote.quantidade_mil, restante);
      db.prepare('UPDATE estoque_lotes SET quantidade_mil = quantidade_mil - ? WHERE id = ?').run(move, lote.id);
      db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, custo_unit_centavos, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ingredienteId, lote.lote, lote.validade, destino, move, lote.custo_unit_centavos, agoraISO());
      restante -= move;
    }
    ajustarLocais(db, ingredienteId, origem, -qtd);
    ajustarLocais(db, ingredienteId, destino, qtd);
    db.prepare(
      `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, origem, destino, usuario_id, observacao, criado_em)
       VALUES (?, 'transferencia', ?, ?, ?, ?, ?, ?, ?)`
    ).run(ingredienteId, qtd, ing.quantidade_mil, origem, destino, usuario.id, motivo || `transferência ${origem}→${destino}`, agoraISO());
    registrar(db, {
      usuarioId: usuario.id, acao: 'estoque_transferencia', entidade: 'ingrediente', entidadeId: ingredienteId,
      detalhes: { origem, destino, quantidade_mil: qtd, motivo }, ip,
    });
    return { ok: true, quantidade_mil: qtd };
  });
}

export function fichaSalvar(db, usuario, produtoId, itensFicha, ip) {  return transacao(db, () => {
    const produto = db.prepare('SELECT id FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    db.prepare('DELETE FROM produto_ingredientes WHERE produto_id = ?').run(produtoId);
    for (const it of (Array.isArray(itensFicha) ? itensFicha.slice(0, 50) : [])) {
      const ing = db.prepare('SELECT id FROM ingredientes WHERE id = ? AND ativo = 1').get(Number(it?.ingrediente_id));
      if (!ing) throw erro.validacao(`Ingrediente ${it?.ingrediente_id} inexistente.`);
      const qtd = assertInt(it?.quantidade_mil, 'quantidade_mil', { minimo: 1 });
      const perda = it?.perda_pct === undefined || it?.perda_pct === null || it?.perda_pct === '' ? 0 : Number(it.perda_pct);
      if (!Number.isFinite(perda) || perda < 0 || perda > 100) throw erro.validacao('perda_pct deve ser número entre 0 e 100.');
      db.prepare('INSERT INTO produto_ingredientes (produto_id, ingrediente_id, quantidade_mil, perda_pct) VALUES (?, ?, ?, ?)')
        .run(produtoId, ing.id, qtd, perda);
    }
    registrar(db, { usuarioId: usuario.id, acao: 'ficha_tecnica_salva', entidade: 'produto', entidadeId: produtoId, detalhes: { itens: itensFicha?.length ?? 0 }, ip });
    return db.prepare('SELECT pi.*, i.nome, i.unidade FROM produto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id WHERE pi.produto_id = ?').all(produtoId);
  });
}

export function listarMovimentacoes(db, { ingredienteId = null, limite = 200 } = {}) {
  if (ingredienteId) {
    return db.prepare(
      `SELECT m.*, i.nome AS ingrediente_nome, u.nome AS usuario_nome FROM estoque_movimentacoes m
       JOIN ingredientes i ON i.id = m.ingrediente_id JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.ingrediente_id = ? ORDER BY m.id DESC LIMIT ?`
    ).all(ingredienteId, limite);
  }
  return db.prepare(
    `SELECT m.*, i.nome AS ingrediente_nome, u.nome AS usuario_nome FROM estoque_movimentacoes m
     JOIN ingredientes i ON i.id = m.ingrediente_id JOIN usuarios u ON u.id = m.usuario_id
     ORDER BY m.id DESC LIMIT ?`
  ).all(limite);
}

// Necessidade com perda de preparo embutida (A1 item 1.13).
function necessidadeFicha(db, produtoId, quantidade) {
  const ficha = db.prepare(
    `SELECT pi.ingrediente_id, pi.quantidade_mil, pi.perda_pct FROM produto_ingredientes pi WHERE pi.produto_id = ?`
  ).all(produtoId);
  return ficha.map((f) => ({
    ingrediente_id: f.ingrediente_id,
    quantidade_mil: Math.ceil(f.quantidade_mil * quantidade * (1 + (f.perda_pct ?? 0) / 100)),
  }));
}

// Disponibilidade para venda: bloqueia se insumo com validade controlada não cobre.
export function disponibilidadeVenda(db, produtoId, quantidade = 1) {
  const alertas = [];
  for (const n of necessidadeFicha(db, produtoId, quantidade)) {
    const disp = somaDisponivel(db, n.ingrediente_id);
    if (disp.controlaValidade && disp.disponivel < n.quantidade_mil) {
      const ing = db.prepare('SELECT nome, unidade FROM ingredientes WHERE id = ?').get(n.ingrediente_id);
      alertas.push({ ingrediente: ing.nome, necessario: n.quantidade_mil, disponivel: disp.disponivel, unidade: ing.unidade });
    }
  }
  return alertas;
}

// Baixa automática no fechamento do pedido. IDEMPOTENTE: UNIQUE(tipo, ref, ingrediente)
// garante que reprocessos não dupliquem a baixa. Venda NÃO é bloqueada por estoque
// (política AD-004); saldo pode ficar negativo e alerta é emitido.
export function baixarEstoquePedido(db, pedidoId, usuarioId, ip) {
  const alertas = [];
  const jaProcessado = db.prepare(
    `SELECT COUNT(DISTINCT ingrediente_id) AS n FROM estoque_movimentacoes WHERE tipo = 'saida_venda' AND ref_tipo = 'pedido' AND ref_id = ?`
  ).get(pedidoId).n;
  if (jaProcessado > 0) return alertas; // reprocessamento: não baixa de novo

  const itens = db.prepare(
    `SELECT i.id, i.quantidade, i.produto_id FROM pedido_itens i WHERE i.pedido_id = ? AND i.status = 'ativo'`
  ).all(pedidoId);
  for (const item of itens) {
    const necessidades = necessidadeFicha(db, item.produto_id, item.quantidade);
    // agrupa por ingrediente (mesmo ingrediente em 2 produtos do pedido)
    const porIng = new Map();
    for (const n of necessidades) porIng.set(n.ingrediente_id, (porIng.get(n.ingrediente_id) ?? 0) + n.quantidade_mil);
    for (const [ingId, total] of porIng) {
      const ja = db.prepare(
        `SELECT 1 FROM estoque_movimentacoes WHERE tipo = 'saida_venda' AND ref_tipo = 'pedido' AND ref_id = ? AND ingrediente_id = ?`
      ).get(pedidoId, ingId);
      if (ja) continue;
      consumirFIFO(db, { ingrediente_id: ingId, quantidade_mil: total, tipo: 'saida_venda', ref_tipo: 'pedido', ref_id: pedidoId, usuario_id: usuarioId, observacao: `venda pedido #${pedidoId}` });
      const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ?').get(ingId);
      if (ing.quantidade_mil < ing.minimo_mil) {
        alertas.push({ ingrediente_id: ing.id, nome: ing.nome, saldo_mil: ing.quantidade_mil, minimo_mil: ing.minimo_mil });
      }
    }
  }
  if (itens.length > 0) {
    registrar(db, { usuarioId, acao: 'estoque_baixa_venda', entidade: 'pedido', entidadeId: pedidoId, detalhes: { itens: itens.length, alertas: alertas.length }, ip });
  }
  return alertas;
}

// ---------- Validade (A2 item 2.6) ----------
export function lotesVencidos(db) {
  const hoje = hojeISO();
  return db.prepare(
    `SELECT l.*, i.nome AS ingrediente_nome, i.unidade FROM estoque_lotes l
     JOIN ingredientes i ON i.id = l.ingrediente_id
     WHERE l.validade IS NOT NULL AND l.validade < ? AND l.quantidade_mil > 0
     ORDER BY l.validade`
  ).all(hoje);
}

export function baixarVencidos(db, usuario, ip) {
  return transacao(db, () => {
    const vencidos = lotesVencidos(db);
    let total = 0;
    for (const l of vencidos) {
      consumirFIFO(db, { ingrediente_id: l.ingrediente_id, quantidade_mil: l.quantidade_mil, tipo: 'vencimento', usuario_id: usuario.id, observacao: `lote ${l.lote} vencido em ${l.validade}`, local_mov: l.local });
      total++;
    }
    registrar(db, { usuarioId: usuario.id, acao: 'estoque_baixa_vencidos', detalhes: { lotes: total }, ip });
    return { lotes_baixados: total };
  });
}

// ---------- Inventário rotativo (A2 item 2.5) ----------
export function listaInventario(db, { quantidade = 10 } = {}) {
  const n = assertInt(quantidade, 'quantidade', { minimo: 1, maximo: 100 });
  const criticos = db.prepare(
    `SELECT *, 0 AS prioridade FROM ingredientes WHERE ativo = 1 AND quantidade_mil < minimo_mil ORDER BY nome LIMIT ?`
  ).all(n);
  const ids = new Set(criticos.map((c) => c.id));
  const resto = db.prepare(
    `SELECT * FROM ingredientes WHERE ativo = 1 ORDER BY RANDOM() LIMIT ?`
  ).all(n).filter((r) => !ids.has(r.id));
  return [...criticos, ...resto].slice(0, n).map((r) => ({
    ...r,
    locais: db.prepare('SELECT local, quantidade_mil FROM ingrediente_locais WHERE ingrediente_id = ?').all(r.id),
  }));
}

export function registrarContagem(db, usuario, body, ip) {
  const ingredienteId = assertInt(body?.ingrediente_id, 'ingrediente_id', { minimo: 1 });
  const contado = assertInt(body?.contado_mil, 'contado_mil', { minimo: 0 });
  const local = body?.local ? (LOCAIS.includes(body.local) ? body.local : null) : null;
  const obs = texto(body?.observacao ?? '', 'observacao', { obrigatorio: false, maximo: 200 });
  return transacao(db, () => {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ? AND ativo = 1').get(ingredienteId);
    if (!ing) throw erro.naoEncontrado('Ingrediente não encontrado.');
    const esperado = local
      ? (db.prepare('SELECT quantidade_mil FROM ingrediente_locais WHERE ingrediente_id = ? AND local = ?').get(ingredienteId, local)?.quantidade_mil ?? 0)
      : ing.quantidade_mil;
    const diferenca = contado - esperado;
    if (diferenca !== 0) {
      if (diferenca > 0) {
        db.prepare(`INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, criado_em)
          VALUES (?, 'inventario', NULL, ?, ?, ?)`).run(ingredienteId, local ?? 'deposito', diferenca, agoraISO());
        ajustarLocais(db, ingredienteId, local ?? 'deposito', diferenca);
        db.prepare('UPDATE ingredientes SET quantidade_mil = quantidade_mil + ? WHERE id = ?').run(diferenca, ingredienteId);
      } else {
        consumirFIFO(db, { ingrediente_id: ingredienteId, quantidade_mil: -diferenca, tipo: 'inventario', usuario_id: usuario.id, observacao: obs || 'inventário (divergência negativa)', local_mov: local });
      }
      const apos = db.prepare('SELECT quantidade_mil FROM ingredientes WHERE id = ?').get(ingredienteId).quantidade_mil;
      if (diferenca > 0) {
        db.prepare(
          `INSERT INTO estoque_movimentacoes (ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, local, usuario_id, observacao, criado_em)
           VALUES (?, 'inventario', ?, ?, ?, ?, ?, ?)`
        ).run(ingredienteId, diferenca, apos, local, usuario.id, obs || 'inventário (sobra)', agoraISO());
      }
    }
    const info = db.prepare(
      `INSERT INTO inventario_contagens (ingrediente_id, local, esperado_mil, contado_mil, diferenca_mil, usuario_id, observacao, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ingredienteId, local, esperado, contado, diferenca, usuario.id, obs || null, agoraISO());
    registrar(db, {
      usuarioId: usuario.id, acao: 'inventario_contagem', entidade: 'ingrediente', entidadeId: ingredienteId,
      detalhes: { esperado_mil: esperado, contado_mil: contado, diferenca_mil: diferenca }, ip,
    });
    return { id: Number(info.lastInsertRowid), diferenca_mil: diferenca };
  });
}

// ---------- Curva ABC + sugestão de compra (A2 item 2.7) ----------
export function custoMedio(db, ingredienteId, { ultimas = 10 } = {}) {
  const rows = db.prepare(
    `SELECT quantidade_mil, custo_total_centavos FROM estoque_movimentacoes
     WHERE ingrediente_id = ? AND tipo = 'entrada' AND custo_total_centavos IS NOT NULL
     ORDER BY id DESC LIMIT ?`
  ).all(ingredienteId, ultimas);
  let qtd = 0, custo = 0;
  for (const r of rows) { qtd += r.quantidade_mil; custo += r.custo_total_centavos; }
  if (!qtd) return null;
  return custo / (qtd / 1000); // centavos por unidade (g/ml/un)
}

export function curvaABC(db, { dias = 30 } = {}) {
  const d = assertInt(dias, 'dias', { minimo: 1, maximo: 365 });
  const desde = new Date(Date.now() - d * 24 * 3600_000).toISOString();
  const rows = db.prepare(
    `SELECT m.ingrediente_id, i.nome, i.unidade, SUM(m.quantidade_mil) AS consumo_mil
     FROM estoque_movimentacoes m JOIN ingredientes i ON i.id = m.ingrediente_id
     WHERE m.tipo = 'saida_venda' AND m.criado_em >= ?
     GROUP BY m.ingrediente_id ORDER BY consumo_mil DESC`
  ).all(desde);
  const itens = rows.map((r) => ({ ...r, custo_medio_centavos: custoMedio(db, r.ingrediente_id), valor_centavos: 0 }));
  for (const it of itens) {
    it.valor_centavos = it.custo_medio_centavos === null ? 0 : Math.round(it.custo_medio_centavos * (it.consumo_mil / 1000));
  }
  const total = itens.reduce((s, it) => s + it.valor_centavos, 0) || 1;
  let acumulado = 0;
  for (const it of itens) {
    acumulado += it.valor_centavos / total;
    it.classe = acumulado <= 0.8 ? 'A' : acumulado <= 0.95 ? 'B' : 'C';
    it.participacao_pct = Math.round((it.valor_centavos / total) * 1000) / 10;
  }
  return { dias: d, itens, sem_custo: itens.filter((it) => it.custo_medio_centavos === null).length };
}

export function sugestaoCompra(db) {
  const baixos = db.prepare(
    `SELECT * FROM ingredientes WHERE ativo = 1 AND quantidade_mil < minimo_mil ORDER BY nome`
  ).all();
  return baixos.map((r) => ({
    ingrediente_id: r.id, nome: r.nome, unidade: r.unidade,
    atual_mil: r.quantidade_mil, minimo_mil: r.minimo_mil,
    sugerido_mil: Math.max(0, r.minimo_mil * 3 - r.quantidade_mil),
  }));
}

// ---------- Custo automático da ficha (A2 item 1.12) ----------
export function recalcularCusto(db, produtoId, usuario = null, ip = null) {
  return transacao(db, () => {
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    const ficha = db.prepare(
      `SELECT pi.ingrediente_id, pi.quantidade_mil, pi.perda_pct, i.nome FROM produto_ingredientes pi
       JOIN ingredientes i ON i.id = pi.ingrediente_id WHERE pi.produto_id = ?`
    ).all(produtoId);
    if (!ficha.length) throw erro.validacao('Produto sem ficha técnica.');
    let custo = 0;
    const semCusto = [];
    for (const f of ficha) {
      const cm = custoMedio(db, f.ingrediente_id);
      if (cm === null) { semCusto.push(f.nome); continue; }
      custo += cm * (f.quantidade_mil / 1000) * (1 + (f.perda_pct ?? 0) / 100);
    }
    const rendimento = produto.rendimento_porcoes ?? 1;
    const custoPorcao = Math.round(custo / rendimento);
    if (produto.custo_centavos !== custoPorcao) {
      db.prepare('UPDATE produtos SET custo_centavos = ? WHERE id = ?').run(custoPorcao, produtoId);
      registrar(db, {
        usuarioId: usuario?.id ?? null, acao: 'custo_recalculado', entidade: 'produto', entidadeId: produtoId,
        detalhes: { anterior_centavos: produto.custo_centavos, novo_centavos: custoPorcao, sem_custo: semCusto }, ip,
      });
    }
    const margemPct = produto.preco_centavos > 0
      ? Math.round(((produto.preco_centavos - custoPorcao) / produto.preco_centavos) * 1000) / 10 : null;
    return { produto_id: produtoId, custo_centavos: custoPorcao, margem_pct: margemPct, sem_custo: semCusto };
  });
}

// ---------- Barris de chopp (A2 item 2.8) ----------
export function instalarBarril(db, usuario, body, ip) {
  const rotulo = texto(body?.rotulo, 'rotulo', { minimo: 2, maximo: 80 });
  const tipo_chopp = texto(body?.tipo_chopp ?? 'pilsen', 'tipo_chopp', { obrigatorio: false, maximo: 40, padrao: 'pilsen' }) || 'pilsen';
  const numero = body?.numero ? String(body.numero).slice(0, 40) : null;
  const ingredienteId = assertInt(body?.ingrediente_id, 'ingrediente_id', { minimo: 1 });
  const capacidadeMl = assertInt(body?.capacidade_ml ?? 50000, 'capacidade_ml', { minimo: 1000, maximo: 100000 });
  return transacao(db, () => {
    const ing = db.prepare('SELECT id, unidade FROM ingredientes WHERE id = ? AND ativo = 1').get(ingredienteId);
    if (!ing) throw erro.naoEncontrado('Ingrediente não encontrado.');
    const aberto = db.prepare(`SELECT id FROM barris WHERE ingrediente_id = ? AND ativo = 1 AND esgotado_em IS NULL`).get(ingredienteId);
    if (aberto) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe barril ativo para este chopp. Esgote-o antes de instalar outro.');
    const info = db.prepare(
      `INSERT INTO barris (rotulo, tipo_chopp, numero, ingrediente_id, capacidade_ml, instalado_em, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(rotulo, tipo_chopp, numero, ingredienteId, capacidadeMl, agoraISO(), usuario.id);
    registrar(db, { usuarioId: usuario.id, acao: 'barril_instalado', entidade: 'barril', entidadeId: Number(info.lastInsertRowid), detalhes: { rotulo, capacidade_ml: capacidadeMl }, ip });
    return db.prepare('SELECT * FROM barris WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

export function listarBarris(db, { copoMl = 473 } = {}) {
  const copo = assertInt(copoMl, 'copo_ml', { minimo: 100, maximo: 2000 });
  const barris = db.prepare(
    `SELECT b.*, i.nome AS ingrediente_nome, i.quantidade_mil AS estoque_mil, u.nome AS criado_por_nome
     FROM barris b JOIN ingredientes i ON i.id = b.ingrediente_id LEFT JOIN usuarios u ON u.id = b.criado_por
     ORDER BY b.ativo DESC, b.instalado_em DESC`
  ).all();
  return barris.map((b) => ({
    ...b,
    copos_restantes: b.esgotado_em ? 0 : Math.max(0, Math.floor((b.estoque_mil / 1000) / (copo / 1000))),
    ruptura: !b.esgotado_em && b.estoque_mil <= 0,
  }));
}

export function esgotarBarril(db, usuario, barrilId, ip) {
  return transacao(db, () => {
    const b = db.prepare('SELECT * FROM barris WHERE id = ?').get(barrilId);
    if (!b) throw erro.naoEncontrado('Barril não encontrado.');
    if (b.esgotado_em) throw erro.conflito('409_CONFLITO_ESTADO', 'Barril já esgotado.');
    db.prepare('UPDATE barris SET esgotado_em = ?, ativo = 0 WHERE id = ?').run(agoraISO(), barrilId);
    registrar(db, { usuarioId: usuario.id, acao: 'barril_esgotado', entidade: 'barril', entidadeId: barrilId, detalhes: { rotulo: b.rotulo }, ip });
    return { ok: true };
  });
}


export function listarFicha(db, produtoId) {
  return db.prepare(
    `SELECT pi.ingrediente_id, pi.quantidade_mil, pi.perda_pct, i.nome, i.unidade
     FROM produto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id
     WHERE pi.produto_id = ? ORDER BY i.nome`
  ).all(produtoId);
}
