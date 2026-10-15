import { erro } from '../core/errors.js';
import { assertCentavos, formatar } from '../core/money.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';
import * as caixa from './caixaService.js';
import { baixarEstoquePedido } from './estoqueService.js';
import { sincronizarPrecosVigentes, disponibilidadeProduto } from './catalogoService.js';
import { disponibilidadeVenda } from './estoqueService.js';
import { promocaoVigente } from './promocoesService.js';
import { obterTodas } from './configService.js';

export const FORMAS = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao'];
const KDS_ORDEM = { pendente: 0, preparando: 1, pronto: 2, entregue: 3 };

// ---------- Taxa de serviço ----------
// Recalcula e persiste a taxa do pedido conforme a configuração vigente.
// Idempotente e segura para chamar a cada mutação de itens/desconto.
export function aplicarTaxaServico(db, pedidoId) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) return null;
  const cfg = obterTodas(db);
  const modo = cfg.taxa_servico_modo;
  if (modo === 'desativada') {
    if (pedido.taxa_servico_centavos !== 0) {
      db.prepare('UPDATE pedidos SET taxa_servico_centavos = 0 WHERE id = ?').run(pedidoId);
    }
    return 0;
  }
  const totais = calcularTotais(db, pedidoId);
  // `cobrar_por = bruto` ignora desconto; `subtotal` aplica sobre bruto-desconto.
  const base = cfg.taxa_servico_cobrar_por === 'bruto' ? totais.bruto_centavos : totais.subtotal_centavos;
  let taxa;
  if (modo === 'fixa') {
    taxa = Math.max(0, Number(cfg.taxa_servico_fixo_centavos) || 0);
  } else {
    const pct = Math.max(0, Math.min(100, Number(cfg.taxa_servico_pct) || 0));
    // Arredonda para cima no centavo: taxa não se perde por arredondamento.
    taxa = Math.round((base * pct) / 100);
  }
  if (taxa < 0) taxa = 0;
  // Sem teto artificial: como a taxa é >= 0, o total só pode SUBIR em
  // relação ao subtotal, então o saldo pendente nunca fica negativo por
  // causa dela. Tentar "limitar" aqui zeraria a taxa de uma conta já paga,
  // fazendo o cliente ficar devendo menos do que a casa deixou cobrar.
  db.prepare('UPDATE pedidos SET taxa_servico_centavos = ? WHERE id = ?').run(taxa, pedidoId);
  return taxa;
}

// ---------- Totais: SEMPRE calculados no servidor (fonte da verdade) ----------
// Hierarquia: bruto -> desconto -> subtotal -> taxa de serviço -> total.
// A gorjeta NÃO entra em total_centavos de propósito: ela é um extra pago
// pelo cliente sobre a conta. Incluí-la aqui quebraria o invariante que
// `fechar` exige (soma dos pagamentos === total) e o caixa receberia
// gorjeta como se fosse receita da venda.
export function calcularTotais(db, pedidoId) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  const itens = db.prepare(
    `SELECT i.id, i.quantidade, i.preco_unit_centavos,
            COALESCE((SELECT SUM(a.preco_centavos * a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = i.id), 0) AS adicionais_centavos
     FROM pedido_itens i WHERE i.pedido_id = ? AND i.status = 'ativo'`
  ).all(pedidoId);
  let bruto = 0;
  for (const i of itens) bruto += (i.preco_unit_centavos + i.adicionais_centavos) * i.quantidade;
  const desconto = Math.min(pedido.desconto_centavos ?? 0, bruto);
  const subtotal = bruto - desconto;
  const taxa = Math.max(0, pedido.taxa_servico_centavos ?? 0);
  const total = subtotal + taxa;
  const pago = db.prepare(
    'SELECT COALESCE(SUM(valor_centavos),0) AS p FROM pagamentos WHERE pedido_id = ? AND estornado = 0'
  ).get(pedidoId).p;
  return {
    pedido_id: pedidoId,
    status: pedido.status,
    bruto_centavos: bruto,
    desconto_centavos: desconto,
    subtotal_centavos: subtotal,
    taxa_servico_centavos: taxa,
    gorjeta_centavos: pedido.gorjeta_centavos ?? 0,
    total_centavos: total,
    pago_centavos: pago,
    saldo_centavos: total - pago,
  };
}

function pedidoComTotais(db, pedidoId) {
  return { ...db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId), totais: calcularTotais(db, pedidoId) };
}

// Libera a mesa apenas quando não restar comanda aberta. Marca `ociosa_desde`
// para o mapa do salão destacar mesas paradas há muito tempo.
export function soltarMesaSeVazia(db, mesaId, agora = agoraISO()) {
  const abertas = db.prepare(
    `SELECT COUNT(*) AS n FROM pedidos WHERE mesa_id = ? AND status = 'aberto'`
  ).get(mesaId).n;
  if (abertas === 0) {
    db.prepare(`UPDATE mesas SET status = 'livre', ociosa_desde = ? WHERE id = ?`).run(agora, mesaId);
    return 'livre';
  }
  // Ainda há gente na mesa: garante 'ocupada' mesmo que algo tenha dessincronizado.
  db.prepare(`UPDATE mesas SET status = 'ocupada', ociosa_desde = NULL WHERE id = ? AND status = 'livre'`).run(mesaId);
  return 'ocupada';
}

// ---------- Criação ----------
export function proximoNumeroDia(db, agora = agoraISO()) {
  const dia = agora.slice(0, 10);
  const max = db.prepare(`SELECT COALESCE(MAX(numero_dia), 0) AS m FROM pedidos WHERE substr(aberto_em, 1, 10) = ?`).get(dia).m;
  return max + 1;
}

export function criarBalcao(db, usuario, body, idempotencyKey, ip, hub) {
  const itens = Array.isArray(body?.itens) ? body.itens : [];
  if (itens.length === 0) throw erro.validacao('Informe ao menos um item.');
  if (itens.length > 100) throw erro.validacao('Máximo de 100 itens por venda.');
  const caixaSessao = caixa.exigirCaixaAberto(db);
  const canal = body?.canal === 'viagem' ? 'viagem' : 'salao'; // A3 item 3.2: para levar
  const observacao = body?.observacao === undefined || body?.observacao === null
    ? null : String(body.observacao).trim().slice(0, 300) || null;

  // Idempotência: retransmissão devolve o pedido original (BR-007).
  if (idempotencyKey) {
    const existente = db.prepare('SELECT id FROM pedidos WHERE idempotency_key = ?').get(idempotencyKey);
    if (existente) return { ...pedidoComTotais(db, existente.id), idempotente: true };
  }

  return transacao(db, () => {
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO pedidos (tipo, caixa_sessao_id, status, aberto_em, criado_em, idempotency_key, canal, observacao, numero_dia)
       VALUES ('balcao', ?, 'aberto', ?, ?, ?, ?, ?, ?)`
    ).run(caixaSessao.id, agora, agora, idempotencyKey ?? null, canal, observacao, proximoNumeroDia(db, agora));
    const pedidoId = Number(info.lastInsertRowid);
    for (const it of itens) inserirItemValidado(db, pedidoId, it, it?.idempotency_key ?? null);
    registrar(db, { usuarioId: usuario.id, acao: 'pedido_criado', entidade: 'pedido', entidadeId: pedidoId, detalhes: { tipo: 'balcao', canal, itens: itens.length }, ip });
    const resultado = pedidoComTotais(db, pedidoId);
    hub?.publicar('pedido.criado', { pedido_id: pedidoId, tipo: 'balcao', canal });
    return resultado;
  });
}

export function abrirComanda(db, usuario, mesaId, nomeCliente, ip, hub, extras = {}) {
  const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
  if (!mesa) throw erro.naoEncontrado('Mesa não encontrada.');
  if (mesa.bloqueada) throw erro.conflito('409_MESA_OCUPADA', `Mesa ${mesa.numero} está bloqueada: ${mesa.bloqueio_motivo ?? 'sem motivo informado'}.`);
  // Comanda individual: a mesa pode já estar ocupada por outra conta.
  // `individual` explicitado pelo garçom é o que autoriza coexistir.
  const individual = extras?.individual === true || extras?.individual === 1 ? 1 : 0;
  if (mesa.status !== 'livre' && !individual) {
    throw erro.conflito('409_MESA_OCUPADA', `Mesa ${mesa.numero} já está ocupada. Abra uma comanda individual para um novo cliente.`);
  }
  const nome = String(nomeCliente ?? '').trim().slice(0, 80) || `Mesa ${mesa.numero}`;
  const canal = extras?.canal === 'viagem' ? 'viagem' : 'salao';
  const observacao = extras?.observacao ? String(extras.observacao).trim().slice(0, 300) || null : null;
  const clienteId = extras?.cliente_id ? Number(extras.cliente_id) || null : null;
  return transacao(db, () => {
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO pedidos (tipo, mesa_id, comanda_nome, garcom_id, atendente_id, cliente_id, individual, status, aberto_em, criado_em, canal, observacao, numero_dia)
       VALUES ('mesa', ?, ?, ?, ?, ?, ?, 'aberto', ?, ?, ?, ?, ?)`
    ).run(mesaId, nome, usuario.id, usuario.id, clienteId, individual, agora, agora, canal, observacao, proximoNumeroDia(db, agora));
    const pedidoId = Number(info.lastInsertRowid);
    aplicarTaxaServico(db, pedidoId);
    db.prepare(`UPDATE mesas SET status = 'ocupada', ociosa_desde = NULL WHERE id = ?`).run(mesaId);
    registrar(db, { usuarioId: usuario.id, acao: 'comanda_aberta', entidade: 'pedido', entidadeId: pedidoId, detalhes: { mesa: mesa.numero, cliente: nome, canal, individual }, ip });
    const resultado = pedidoComTotais(db, pedidoId);
    hub?.publicar('mesa.atualizada', { mesa_id: mesaId, status: 'ocupada', pedido_id: pedidoId });
    return resultado;
  });
}

// Guardar/retomar pedido em aberto (A3 item 3.2). Guardado continua listável e retomável.
export function guardarPedido(db, usuario, pedidoId, guardado, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_CONFLITO_ESTADO', 'Só pedidos abertos podem ser guardados/retomados.');
  const g = guardado ? 1 : 0;
  db.prepare('UPDATE pedidos SET guardado = ? WHERE id = ?').run(g, pedidoId);
  registrar(db, {
    usuarioId: usuario.id, acao: guardado ? 'pedido_guardado' : 'pedido_retomado',
    entidade: 'pedido', entidadeId: pedidoId, ip,
  });
  hub?.publicar('pedido.atualizado', { pedido_id: pedidoId, guardado: g });
  return pedidoComTotais(db, pedidoId);
}

// Cortesia/brinde avulso com permissão e motivo (A3 item 3.5). Preço zero explícito.
export function cortesiaItem(db, usuario, pedidoId, body, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  const motivo = body?.motivo === undefined || body?.motivo === null ? '' : String(body.motivo).trim();
  if (motivo.length < 3) throw erro.validacao('Motivo da cortesia é obrigatório (mín. 3 caracteres).');
  const qtd = Number(body?.quantidade ?? 1);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99) throw erro.validacao('Quantidade deve ser 1–99.');
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(Number(body?.produto_id));
  if (!produto) throw erro.validacao('Produto inexistente ou inativo.');
  return transacao(db, () => {
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unit_centavos, observacoes, criado_em)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).run(pedidoId, produto.id, produto.nome, qtd, `CORTESIA — ${motivo.slice(0, 280)}`, agora);
    aplicarTaxaServico(db, pedidoId); // item a R$0 não muda o bruto, mas mantém a taxa coerente
    registrar(db, {
      usuarioId: usuario.id, acao: 'cortesia_aplicada', entidade: 'pedido_item', entidadeId: Number(info.lastInsertRowid),
      detalhes: { pedido_id: pedidoId, produto: produto.nome, quantidade: qtd, motivo }, ip,
    });
    hub?.publicar('pedido.atualizado', { pedido_id: pedidoId });
    return pedidoComTotais(db, pedidoId);
  });
}

// ---------- Divisão da conta por pessoas/itens (A3 item 3.9) ----------
// Grupos apenas rotulam partes da conta; os totais por grupo são calculados
// no servidor e cada grupo é pago com um pagamento normal (valor exato).
export function criarGrupo(db, usuario, pedidoId, nome, ip) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  const nomeLimpo = String(nome ?? '').trim().slice(0, 40);
  if (nomeLimpo.length < 1) throw erro.validacao('Nome do grupo é obrigatório.');
  const dup = db.prepare('SELECT id FROM pedido_grupos WHERE pedido_id = ? AND nome = ?').get(pedidoId, nomeLimpo);
  if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Grupo já existe neste pedido.');
  const info = db.prepare('INSERT INTO pedido_grupos (pedido_id, nome, criado_em) VALUES (?, ?, ?)')
    .run(pedidoId, nomeLimpo, agoraISO());
  registrar(db, { usuarioId: usuario.id, acao: 'grupo_divisao_criado', entidade: 'pedido', entidadeId: pedidoId, detalhes: { grupo: nomeLimpo }, ip });
  return db.prepare('SELECT * FROM pedido_grupos WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function atribuirGrupo(db, usuario, pedidoId, grupoId, atribuicoes, ip) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  const grupo = db.prepare('SELECT * FROM pedido_grupos WHERE id = ? AND pedido_id = ?').get(grupoId, pedidoId);
  if (!grupo) throw erro.naoEncontrado('Grupo não encontrado neste pedido.');
  return transacao(db, () => {
    db.prepare('DELETE FROM pedido_grupo_itens WHERE grupo_id = ?').run(grupoId);
    for (const a of (Array.isArray(atribuicoes) ? atribuicoes.slice(0, 100) : [])) {
      const item = db.prepare('SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ? AND status = ?').get(Number(a?.item_id), pedidoId, 'ativo');
      if (!item) throw erro.validacao(`Item ${a?.item_id} inválido para este pedido.`);
      const qtd = Number(a?.quantidade ?? item.quantidade);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > item.quantidade) {
        throw erro.validacao(`Quantidade do item "${item.nome_produto}" deve ser 1–${item.quantidade}.`);
      }
      // a soma atribuída deste item em TODOS os grupos não pode exceder a quantidade
      const outros = db.prepare(
        `SELECT COALESCE(SUM(gi.quantidade), 0) AS t FROM pedido_grupo_itens gi
         JOIN pedido_grupos g ON g.id = gi.grupo_id
         WHERE gi.item_id = ? AND g.pedido_id = ? AND gi.grupo_id != ?`
      ).get(item.id, pedidoId, grupoId).t;
      if (outros + qtd > item.quantidade) {
        throw erro.validacao(`Item "${item.nome_produto}": ${outros + qtd} atribuído(s) excede(m) a quantidade (${item.quantidade}).`);
      }
      db.prepare('INSERT INTO pedido_grupo_itens (grupo_id, item_id, quantidade) VALUES (?, ?, ?)')
        .run(grupoId, item.id, qtd);
    }
    registrar(db, { usuarioId: usuario.id, acao: 'grupo_divisao_atribuido', entidade: 'pedido', entidadeId: pedidoId, detalhes: { grupo_id: grupoId }, ip });
    return divisaoTotais(db, pedidoId);
  });
}

export function removerGrupo(db, usuario, pedidoId, grupoId, ip) {
  const grupo = db.prepare('SELECT * FROM pedido_grupos WHERE id = ? AND pedido_id = ?').get(grupoId, pedidoId);
  if (!grupo) throw erro.naoEncontrado('Grupo não encontrado neste pedido.');
  db.prepare('DELETE FROM pedido_grupo_itens WHERE grupo_id = ?').run(grupoId);
  db.prepare('DELETE FROM pedido_grupos WHERE id = ?').run(grupoId);
  registrar(db, { usuarioId: usuario.id, acao: 'grupo_divisao_removido', entidade: 'pedido', entidadeId: pedidoId, detalhes: { grupo: grupo.nome }, ip });
  return { ok: true };
}

export function divisaoTotais(db, pedidoId) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  const totais = calcularTotais(db, pedidoId);
  const grupos = db.prepare('SELECT * FROM pedido_grupos WHERE pedido_id = ? ORDER BY id').all(pedidoId);
  const itens = db.prepare(
    `SELECT i.id, i.quantidade, i.preco_unit_centavos,
            COALESCE((SELECT SUM(a.preco_centavos * a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = i.id), 0) AS ad
     FROM pedido_itens i WHERE i.pedido_id = ? AND i.status = 'ativo'`
  ).all(pedidoId);
  const unitario = new Map(itens.map((i) => [i.id, i.preco_unit_centavos + i.ad]));
  const atribuido = new Map();
  const porGrupo = grupos.map((g) => {
    const linhas = db.prepare('SELECT item_id, quantidade FROM pedido_grupo_itens WHERE grupo_id = ?').all(g.id);
    let subtotal = 0;
    for (const l of linhas) {
      subtotal += (unitario.get(l.item_id) ?? 0) * l.quantidade;
      atribuido.set(l.item_id, (atribuido.get(l.item_id) ?? 0) + l.quantidade);
    }
    return { id: g.id, nome: g.nome, subtotal_centavos: subtotal };
  });
  let semGrupo = 0;
  for (const i of itens) {
    const resto = i.quantidade - (atribuido.get(i.id) ?? 0);
    if (resto > 0) semGrupo += (unitario.get(i.id) ?? 0) * resto;
  }
  return { pedido_id: pedidoId, total_centavos: totais.total_centavos, grupos: porGrupo, sem_grupo_centavos: semGrupo };
}

// Valida produto/adicionais no servidor e insere o item com snapshot de preço.
// Exportado para reuso atômico (ex.: combos). Deve rodar dentro de transação do chamador.
export function inserirItemValidado(db, pedidoId, item, idempotencyKey) {
  if (!item || typeof item !== 'object') throw erro.validacao('Item inválido.');
  if (idempotencyKey) {
    const dup = db.prepare('SELECT id, pedido_id FROM pedido_itens WHERE idempotency_key = ?').get(idempotencyKey);
    if (dup) return dup.id; // retransmissão não duplica item
  }
  const qtd = Number(item.quantidade);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) throw erro.validacao('Quantidade deve ser inteiro entre 1 e 999.');
  // Preço vigente: aplica reajustes programados cuja vigência chegou (A1 item 1.7)
  try {
    sincronizarPrecosVigentes(db);
  } catch { /* tabela ainda inexistente em bancos antigos sem migrar: segue com preço atual */ }
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(Number(item.produto_id));
  if (!produto) throw erro.validacao(`Produto ${item?.produto_id} inexistente ou inativo.`);
  // Disponibilidade: motivo de indisponibilidade ou fora de período (A1 itens 1.6/1.8)
  try {
    const disp = disponibilidadeProduto(db, produto);
    if (!disp.disponivel) throw erro.validacao(`Produto "${produto.nome}" indisponível: ${disp.motivo}.`);
  } catch (e) {
    if (e?.codigo === '422_VALIDACAO') throw e;
  }
  // Validade: bloqueia venda se insumo com validade controlada não cobre (A2 item 2.6)
  try {
    const alertasVal = disponibilidadeVenda(db, produto.id, qtd);
    if (alertasVal.length > 0) {
      throw erro.validacao(`Produto "${produto.nome}" bloqueado: ${alertasVal.map((a) => `${a.ingrediente} vencido/insuficiente`).join(', ')}.`);
    }
  } catch (e) {
    if (e?.codigo === '422_VALIDACAO') throw e;
  }
  const obs = item.observacoes === undefined || item.observacoes === null ? null : String(item.observacoes).trim().slice(0, 300) || null;

  // Variações (A1 item 1.2): valida vínculos e soma deltas (preço final nunca negativo).
  // Aceita item.variacoes = [{variacao_id}] ou o legado item.variacao_id.
  let precoUnit = produto.preco_centavos;
  const nomesVariacao = [];
  let variacaoDelta = 0;
  const variacoesPedidas = Array.isArray(item.variacoes)
    ? item.variacoes.slice(0, 10)
    : (item.variacao_id !== undefined && item.variacao_id !== null ? [{ variacao_id: item.variacao_id }] : []);
  const gruposUsados = new Set();
  for (const vv of variacoesPedidas) {
    const v = db.prepare('SELECT * FROM produto_variacoes WHERE id = ? AND produto_id = ? AND ativo = 1')
      .get(Number(vv?.variacao_id), produto.id);
    if (!v) throw erro.validacao(`Variação ${vv?.variacao_id} inexistente para o produto "${produto.nome}".`);
    if (gruposUsados.has(v.grupo)) throw erro.validacao(`Grupo "${v.grupo}" com mais de uma variação no mesmo item.`);
    gruposUsados.add(v.grupo);
    nomesVariacao.push(`${v.grupo}: ${v.nome}`);
    variacaoDelta += v.delta_centavos;
  }
  const variacaoNome = nomesVariacao.length ? nomesVariacao.join(' + ') : null;
  // Promoção por produto (vigente agora): vale sobre o preço base; delta de
  // variação soma depois. Registra a origem no item (auditoria do desconto).
  let promocaoId = null;
  let baseComPromo = produto.preco_centavos;
  try {
    const promo = promocaoVigente(db, produto.id);
    if (promo && promo.preco_promocional_centavos < baseComPromo) {
      baseComPromo = promo.preco_promocional_centavos;
      promocaoId = promo.id;
      db.prepare('UPDATE promocoes_produto SET usos = usos + ? WHERE id = ?').run(qtd, promo.id);
    }
  } catch (e) {
    if (e?.codigo && e.codigo !== '422_VALIDACAO') throw e;
    // sem tabela (banco antigo) ou sem promoção: segue preço normal
  }
  precoUnit = Math.max(0, baseComPromo + variacaoDelta);

  const info = db.prepare(
    `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unit_centavos, observacoes, variacao_nome, variacao_delta_centavos, promocao_id, idempotency_key, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pedidoId, produto.id, produto.nome, qtd, precoUnit, obs, variacaoNome, variacaoDelta, promocaoId, idempotencyKey ?? null, agoraISO());
  const itemId = Number(info.lastInsertRowid);

  // Adicionais: permitidos se vinculados ao produto OU se o produto não tem vínculos configurados.
  const vinculos = db.prepare('SELECT COUNT(*) AS n FROM produto_adicionais WHERE produto_id = ?').get(produto.id).n;
  const adicionais = Array.isArray(item.adicionais) ? item.adicionais.slice(0, 20) : [];
  for (const ad of adicionais) {
    const adicional = db.prepare('SELECT * FROM adicionais WHERE id = ? AND ativo = 1').get(Number(ad?.adicional_id));
    if (!adicional) throw erro.validacao(`Adicional ${ad?.adicional_id} inexistente ou inativo.`);
    if (vinculos > 0) {
      const permitido = db.prepare('SELECT 1 FROM produto_adicionais WHERE produto_id = ? AND adicional_id = ?').get(produto.id, adicional.id);
      if (!permitido) throw erro.validacao(`Adicional "${adicional.nome}" não é permitido para o produto "${produto.nome}".`);
    }
    const qtdAd = Number(ad.quantidade) || 1;
    if (!Number.isInteger(qtdAd) || qtdAd < 1 || qtdAd > 10) throw erro.validacao('Quantidade do adicional deve ser 1 a 10.');
    db.prepare(
      `INSERT INTO pedido_item_adicionais (item_id, adicional_id, nome, preco_centavos, quantidade) VALUES (?, ?, ?, ?, ?)`
    ).run(itemId, adicional.id, adicional.nome, adicional.preco_centavos, qtdAd);
  }
  return itemId;
}

export function adicionarItem(db, usuario, pedidoId, item, idempotencyKey, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  const itemId = transacao(db, () => {
    const id = inserirItemValidado(db, pedidoId, item, idempotencyKey);
    aplicarTaxaServico(db, pedidoId); // taxa acompanha o novo item
    return id;
  });
  hub?.publicar('pedido.atualizado', { pedido_id: pedidoId });
  registrar(db, { usuarioId: usuario.id, acao: 'item_adicionado', entidade: 'pedido_item', entidadeId: itemId, detalhes: { pedido_id: pedidoId }, ip });
  return { item_id: itemId, ...calcularTotais(db, pedidoId) };
}

// ---------- Encaminhar à cozinha (KDS) ----------
export function encaminhar(db, usuario, pedidoId, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  const agora = agoraISO();
  const pendentes = db.prepare(
    `SELECT id, nome_produto, quantidade FROM pedido_itens WHERE pedido_id = ? AND status = 'ativo' AND enviado_cozinha_em IS NULL`
  ).all(pedidoId);
  if (pendentes.length === 0) throw erro.conflito('409_CONFLITO_ESTADO', 'Não há itens pendentes de envio neste pedido.');
  transacao(db, () => {
    db.prepare(
      `UPDATE pedido_itens SET enviado_cozinha_em = ?, kds_status = 'pendente', kds_atualizado_em = ?
       WHERE pedido_id = ? AND status = 'ativo' AND enviado_cozinha_em IS NULL`
    ).run(agora, agora, pedidoId);
    registrar(db, { usuarioId: usuario.id, acao: 'pedido_encaminhado', entidade: 'pedido', entidadeId: pedidoId, detalhes: { itens: pendentes.length }, ip });
  });
  hub?.publicar('kds.enviado', { pedido_id: pedidoId, itens: pendentes, em: agora });
  return pedidoComTotais(db, pedidoId);
}

// ---------- Cancelamento de item (rastreável, BR-005) ----------
export function cancelarItem(db, usuario, itemId, motivo, ip, hub, stepUpAdminId = null) {
  if (!motivo || String(motivo).trim().length < 3) throw erro.validacao('Motivo do cancelamento é obrigatório (mín. 3 caracteres).');
  const item = db.prepare('SELECT * FROM pedido_itens WHERE id = ?').get(itemId);
  if (!item) throw erro.naoEncontrado('Item não encontrado.');
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(item.pedido_id);
  if (!pedido || pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Só é possível cancelar itens de pedidos abertos.');
  if (item.status !== 'ativo') throw erro.conflito('409_CONFLITO_ESTADO', 'Item já está cancelado.');

  const jaEnviado = item.enviado_cozinha_em !== null;
  if (jaEnviado) {
    // Matriz: caixa "requer senha admin"; garçom NÃO pode após envio; admin direto sim.
    if (usuario.cargo === 'garcom') throw erro.permissao('Garçom não pode cancelar item já enviado à cozinha.');
    if (usuario.cargo !== 'admin' && !stepUpAdminId) {
      throw erro.permissao('Cancelamento de item já enviado exige autorização de administrador.');
    }
  }
  const motivoLimpo = String(motivo).trim().slice(0, 300);
  // Integridade: cancelamento não pode deixar o total abaixo do já pago
  // (senão o pedido fica com saldo negativo e não fecha nem recebe pagamento).
  const linha = db.prepare(
    `SELECT COALESCE((SELECT SUM(a.preco_centavos * a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = pedido_itens.id), 0) AS ad
     FROM pedido_itens WHERE id = ?`
  ).get(itemId);
  const contribuicao = (item.preco_unit_centavos + linha.ad) * item.quantidade;
  const totaisAgora = calcularTotais(db, item.pedido_id);
  if (totaisAgora.total_centavos - contribuicao < totaisAgora.pago_centavos) {
    throw erro.conflito('409_SALDO_PENDENTE',
      `Cancelar "${item.nome_produto}" deixaria o total (R$ ${formatar(totaisAgora.total_centavos - contribuicao)}) abaixo do já pago (R$ ${formatar(totaisAgora.pago_centavos)}). Estorne o pagamento antes de cancelar.`,
      { totais: totaisAgora });
  }
  transacao(db, () => {
    db.prepare(
      `UPDATE pedido_itens SET status = 'cancelado', cancelado_em = ?, cancelado_por = ?, cancelamento_motivo = ?, cancelamento_autorizado_por = ?
       WHERE id = ?`
    ).run(agoraISO(), usuario.id, motivoLimpo, stepUpAdminId, itemId);
    aplicarTaxaServico(db, item.pedido_id); // base da taxa caiu com o cancelamento
    registrar(db, {
      usuarioId: usuario.id, acao: 'item_cancelado', entidade: 'pedido_item', entidadeId: itemId,
      detalhes: { pedido_id: item.pedido_id, produto: item.nome_produto, quantidade: item.quantidade, enviado: jaEnviado, motivo: motivoLimpo, autorizado_por: stepUpAdminId }, ip,
    });
  });
  hub?.publicar('pedido.atualizado', { pedido_id: item.pedido_id });
  return calcularTotais(db, item.pedido_id);
}

// ---------- Desconto (permissão + motivo; calculado/clamped no servidor) ----------
export function aplicarDesconto(db, usuario, pedidoId, valorDesconto, motivo, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');
  if (!motivo || String(motivo).trim().length < 3) throw erro.validacao('Motivo do desconto é obrigatório.');
  const valor = assertCentavos(valorDesconto, 'desconto');
  const anterior = pedido.desconto_centavos;
  transacao(db, () => {
    const totais = calcularTotais(db, pedidoId);
    const efetivo = Math.min(valor, totais.bruto_centavos);
    // Integridade: o total final (com taxa) não pode ficar abaixo do já pago.
    const totalAposDesconto = totais.subtotal_centavos - efetivo + totais.taxa_servico_centavos;
    if (totalAposDesconto < totais.pago_centavos) {
      throw erro.conflito('409_SALDO_PENDENTE',
        `Desconto deixaria o total (R$ ${formatar(totalAposDesconto)}) abaixo do já pago (R$ ${formatar(totais.pago_centavos)}). Estorne o pagamento antes de aplicar o desconto.`,
        { totais });
    }
    db.prepare('UPDATE pedidos SET desconto_centavos = ?, desconto_motivo = ?, desconto_usuario_id = ? WHERE id = ?')
      .run(efetivo, String(motivo).trim().slice(0, 300), usuario.id, pedidoId);
    aplicarTaxaServico(db, pedidoId); // base da taxa pode ter mudado
    registrar(db, {
      usuarioId: usuario.id, acao: 'desconto_aplicado', entidade: 'pedido', entidadeId: pedidoId,
      detalhes: { anterior_centavos: anterior, novo_centavos: efetivo, motivo: String(motivo).trim().slice(0, 300) }, ip,
    });
  });
  hub?.publicar('pedido.atualizado', { pedido_id: pedidoId });
  return pedidoComTotais(db, pedidoId);
}

// ---------- Pagamentos divididos (idempotentes) ----------
export function pagar(db, usuario, pedidoId, pagamento, idempotencyKey, ip, hub) {
  if (!idempotencyKey) throw erro.validacao('Idempotency-Key é obrigatória para pagamentos.');
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'aberto') throw erro.conflito('409_PEDIDO_FECHADO', 'Pedido não está aberto.');

  const existente = db.prepare('SELECT * FROM pagamentos WHERE idempotency_key = ?').get(idempotencyKey);
  if (existente && existente.pedido_id === pedidoId) {
    return { pagamento: { ...existente }, ...calcularTotais(db, pedidoId), idempotente: true };
  }
  if (existente) throw erro.conflito('409_IDEMPOTENCIA', 'Idempotency-Key já usada em outro pedido.');

  const forma = pagamento?.forma;
  if (!FORMAS.includes(forma)) throw erro.validacao(`Forma deve ser: ${FORMAS.join(', ')}.`);
  const valor = assertCentavos(pagamento?.valor_centavos, 'valor_centavos');
  if (valor <= 0) throw erro.validacao('Valor do pagamento deve ser maior que zero.');
  // Troco/recebido só existem no dinheiro: formas eletrônicas nunca geram troco.
  if (forma !== 'dinheiro' && pagamento?.recebido_centavos != null) {
    throw erro.validacao('recebido_centavos só é aceito em pagamentos em dinheiro (formas eletrônicas não geram troco).');
  }

  return transacao(db, () => {
    const totais = calcularTotais(db, pedidoId);
    if (valor > totais.saldo_centavos) {
      throw erro.conflito('409_VALOR_EXCEDIDO', `Pagamento (R$ ${(valor / 100).toFixed(2)}) excede o saldo pendente (R$ ${(totais.saldo_centavos / 100).toFixed(2)}).`);
    }
    let recebido = null, troco = 0;
    if (forma === 'dinheiro') {
      const r = pagamento?.recebido_centavos === undefined || pagamento?.recebido_centavos === null ? valor : assertCentavos(pagamento.recebido_centavos, 'recebido_centavos');
      if (r < valor) throw erro.validacao('Valor recebido em dinheiro não pode ser menor que o valor do pagamento.');
      recebido = r;
      troco = r - valor;
    }
    const caixaSessao = caixa.exigirCaixaAberto(db);
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO pagamentos (pedido_id, caixa_sessao_id, forma, valor_centavos, recebido_centavos, troco_centavos, idempotency_key, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(pedidoId, caixaSessao.id, forma, valor, recebido, troco, idempotencyKey, usuario.id, agora);
    registrar(db, {
      usuarioId: usuario.id, acao: 'pagamento_registrado', entidade: 'pagamento', entidadeId: Number(info.lastInsertRowid),
      detalhes: { pedido_id: pedidoId, forma, valor_centavos: valor, troco_centavos: troco }, ip,
    });
    hub?.publicar('pagamento.registrado', { pedido_id: pedidoId, forma, valor_centavos: valor });
    return { pagamento: db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(Number(info.lastInsertRowid)), ...calcularTotais(db, pedidoId) };
  });
}

// ---------- Estorno (admin, somente pedido aberto) ----------
export function estornarPagamento(db, usuario, pagamentoId, motivo, ip, hub, stepUpAdminId = null) {
  if (!motivo || String(motivo).trim().length < 3) throw erro.validacao('Motivo do estorno é obrigatório.');
  const pg = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pagamentoId);
  if (!pg) throw erro.naoEncontrado('Pagamento não encontrado.');
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pg.pedido_id);
  if (!pedido || pedido.status !== 'aberto') throw erro.conflito('409_CONFLITO_ESTADO', 'Estorno só é permitido com pedido ainda aberto.');
  if (pg.estornado) throw erro.conflito('409_CONFLITO_ESTADO', 'Pagamento já estornado.');
  if (usuario.cargo !== 'admin' && !stepUpAdminId) throw erro.permissao('Estorno exige autorização de administrador.');
  transacao(db, () => {
    db.prepare('UPDATE pagamentos SET estornado = 1, estornado_em = ?, estorno_motivo = ?, estornado_por = ? WHERE id = ?')
      .run(agoraISO(), String(motivo).trim().slice(0, 300), stepUpAdminId ?? usuario.id, pagamentoId);
    registrar(db, {
      usuarioId: usuario.id, acao: 'pagamento_estornado', entidade: 'pagamento', entidadeId: pagamentoId,
      detalhes: { pedido_id: pg.pedido_id, valor_centavos: pg.valor_centavos, forma: pg.forma, motivo: String(motivo).trim().slice(0, 300), autorizado_por: stepUpAdminId }, ip,
    });
  });
  hub?.publicar('pagamento.estornado', { pedido_id: pg.pedido_id, pagamento_id: pagamentoId });
  return calcularTotais(db, pg.pedido_id);
}

// Validação final da quitação (endurece o fechamento contra valores incorretos):
// recalcula tudo do zero e confere cada pagamento. Retorna o demonstrativo.
export function validarQuitacao(db, pedidoId) {
  const totais = calcularTotais(db, pedidoId);
  const pagamentos = db.prepare(
    `SELECT * FROM pagamentos WHERE pedido_id = ? AND estornado = 0 ORDER BY id`
  ).all(pedidoId);
  const problemas = [];
  let soma = 0;
  for (const pg of pagamentos) {
    if (!FORMAS.includes(pg.forma)) problemas.push(`pagamento #${pg.id}: forma inválida`);
    if (!Number.isInteger(pg.valor_centavos) || pg.valor_centavos <= 0) {
      problemas.push(`pagamento #${pg.id}: valor inválido`);
    }
    if (pg.forma === 'dinheiro') {
      if (pg.recebido_centavos === null || pg.recebido_centavos < pg.valor_centavos) {
        problemas.push(`pagamento #${pg.id}: recebido inconsistente`);
      }
      if (pg.troco_centavos !== pg.recebido_centavos - pg.valor_centavos) {
        problemas.push(`pagamento #${pg.id}: troco inconsistente`);
      }
    } else if (pg.troco_centavos !== 0 || pg.recebido_centavos !== null) {
      problemas.push(`pagamento #${pg.id}: troco/recebido só existem no dinheiro`);
    }
    soma += pg.valor_centavos;
  }
  if (totais.total_centavos < 0) problemas.push('total do pedido inválido');
  if (soma !== totais.total_centavos) {
    problemas.push(`soma dos pagamentos (${soma}) difere do total (${totais.total_centavos})`);
  }
  return { totais, pagamentos: pagamentos.length, soma_centavos: soma, problemas };
}

// ---------- Fechamento (BR-003: saldo pendente zero; baixa de estoque 1×) ----------
export function fechar(db, usuario, pedidoId, ip, hub) {
  return transacao(db, () => {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
    if (pedido.status !== 'aberto') throw erro.conflito('409_CONFLITO_ESTADO', 'Pedido não está aberto.');
    const totais = calcularTotais(db, pedidoId);
    if (totais.total_centavos < 0) throw erro.conflito('409_SALDO_PENDENTE', 'Pedido com total negativo: valores inconsistentes.');
    if (totais.saldo_centavos !== 0) {
      if (totais.saldo_centavos < 0) {
        throw erro.conflito('409_SALDO_PENDENTE',
          `Pago (R$ ${formatar(totais.pago_centavos)}) excede o total (R$ ${formatar(totais.total_centavos)}). Estorne o excesso para fechar a venda.`,
          { totais });
      }
      throw erro.conflito('409_SALDO_PENDENTE',
        `Fechamento bloqueado: saldo pendente de R$ ${formatar(totais.saldo_centavos)}.`,
        { totais });
    }
    const validacao = validarQuitacao(db, pedidoId);
    if (validacao.problemas.length > 0) {
      throw erro.conflito('409_VALORES_INCONSISTENTES',
        'Fechamento bloqueado: valores inconsistentes. ' + validacao.problemas.join('; '),
        { validacao });
    }
    const agora = agoraISO();
    db.prepare(
      `UPDATE pedidos SET status = 'fechado', fechado_em = ?, fechado_por = ?, total_fechado_centavos = ? WHERE id = ?`
    ).run(agora, usuario.id, totais.total_centavos, pedidoId);
    // Só libera a mesa quando NÃO restar nenhuma outra comanda aberta nela.
    // Com comanda individual, várias contas coexistem na mesma mesa: fechar
    // uma não pode expulsar o cliente das outras.
    if (pedido.mesa_id) soltarMesaSeVazia(db, pedido.mesa_id, agora);
    const alertas = baixarEstoquePedido(db, pedidoId, usuario.id, ip);
    registrar(db, {
      usuarioId: usuario.id, acao: 'pedido_fechado', entidade: 'pedido', entidadeId: pedidoId,
      detalhes: { total_centavos: totais.total_centavos, bruto_centavos: totais.bruto_centavos, desconto_centavos: totais.desconto_centavos }, ip,
    });
    const resultado = pedidoComTotais(db, pedidoId);
    // eventos publicados fora da transação estarão ok após commit; aqui ainda dentro — enviar após
    setImmediate(() => {
      hub?.publicar('pedido.fechado', { pedido_id: pedidoId, mesa_id: pedido.mesa_id });
      for (const a of alertas) hub?.publicar('estoque.alerta', a);
    });
    return resultado;
  });
}

// ---------- KDS ----------
export function avancarKds(db, usuario, pedidoId, ip, hub) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  const itens = db.prepare(
    `SELECT id, kds_status FROM pedido_itens WHERE pedido_id = ? AND status = 'ativo' AND enviado_cozinha_em IS NOT NULL`
  ).all(pedidoId);
  if (itens.length === 0) throw erro.conflito('409_CONFLITO_ESTADO', 'Nenhum item enviado à cozinha.');
  const estados = [...new Set(itens.map((i) => i.kds_status))];
  if (estados.length !== 1) throw erro.conflito('409_CONFLITO_ESTADO', 'Itens em estados distintos; avance individualmente.');
  const atual = estados[0];
  const proximo = { pendente: 'preparando', preparando: 'pronto', pronto: 'entregue' }[atual];
  if (!proximo) throw erro.conflito('409_CONFLITO_ESTADO', 'Pedido já foi entregue.');
  const agora = agoraISO();
  transacao(db, () => {
    db.prepare('UPDATE pedido_itens SET kds_status = ?, kds_atualizado_em = ? WHERE pedido_id = ? AND status = ? AND enviado_cozinha_em IS NOT NULL AND kds_status = ?')
      .run(proximo, agora, pedidoId, 'ativo', atual);
    registrar(db, { usuarioId: usuario.id, acao: 'kds_avanco', entidade: 'pedido', entidadeId: pedidoId, detalhes: { de: atual, para: proximo }, ip });
  });
  hub?.publicar('kds.status', { pedido_id: pedidoId, de: atual, para: proximo, em: agora });
  return { pedido_id: pedidoId, kds_status: proximo };
}

export function filaKds(db) {
  const pedidos = db.prepare(
    `SELECT p.id, p.tipo, p.comanda_nome, p.aberto_em, m.numero AS mesa_numero,
            COALESCE(u.nome, '') AS garcom_nome
     FROM pedidos p
     LEFT JOIN mesas m ON m.id = p.mesa_id
     LEFT JOIN usuarios u ON u.id = p.garcom_id
     WHERE p.status = 'aberto'
       AND EXISTS (SELECT 1 FROM pedido_itens i WHERE i.pedido_id = p.id AND i.status='ativo' AND i.enviado_cozinha_em IS NOT NULL)
     ORDER BY p.id ASC`
  ).all();
  for (const p of pedidos) {
    p.itens = db.prepare(
      `SELECT i.id, i.nome_produto, i.quantidade, i.observacoes, i.kds_status, i.enviado_cozinha_em,
              COALESCE((SELECT GROUP_CONCAT(a.nome || ' (x' || a.quantidade || ')', ', ')
                        FROM pedido_item_adicionais a WHERE a.item_id = i.id), '') AS adicionais
       FROM pedido_itens i WHERE i.pedido_id = ? AND i.status = 'ativo' AND i.enviado_cozinha_em IS NOT NULL
       ORDER BY i.id`
    ).all(p.id);
    p.kds_status = p.itens.every((i) => i.kds_status === 'entregue') ? 'entregue'
      : p.itens.some((i) => i.kds_status === 'preparando') ? 'preparando'
      : p.itens.some((i) => i.kds_status === 'pronto') ? 'pronto' : 'pendente';
  }
  return { pedidos, seq: null };
}

// ---------- Consultas ----------
export function obter(db, pedidoId) {
  const p = pedidoComTotais(db, pedidoId);
  if (!p.id) throw erro.naoEncontrado('Pedido não encontrado.');
  p.itens = db.prepare(
    `SELECT i.*, i.status AS status,
            COALESCE((SELECT GROUP_CONCAT(a.nome || ' (x' || a.quantidade || ')', ', ') FROM pedido_item_adicionais a WHERE a.item_id = i.id), '') AS adicionais,
            cu.nome AS cancelado_por_nome
     FROM pedido_itens i LEFT JOIN usuarios cu ON cu.id = i.cancelado_por
     WHERE i.pedido_id = ? ORDER BY i.id`
  ).all(pedidoId);
  p.pagamentos = db.prepare(
    `SELECT pg.*, u.nome AS usuario_nome FROM pagamentos pg JOIN usuarios u ON u.id = pg.usuario_id
     WHERE pg.pedido_id = ? ORDER BY pg.id`
  ).all(pedidoId);
  p.mesa_numero = p.mesa_id ? db.prepare('SELECT numero FROM mesas WHERE id = ?').get(p.mesa_id)?.numero ?? null : null;
  return p;
}

export function listarAbertos(db) {
  const ids = db.prepare(`SELECT id FROM pedidos WHERE status = 'aberto' ORDER BY id`).all();
  return ids.map((r) => obter(db, r.id));
}
