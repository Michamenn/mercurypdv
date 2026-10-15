// Combos/Promoções Service
import { erro } from '../core/errors.js';
import { assertCentavos, assertInt } from '../core/money.js';
import { texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';
import { calcularTotais, inserirItemValidado } from './pedidosService.js';

export const COMBO_TIPOS = ['preco_fixo', 'desconto_percentual', 'leve_pague', 'brinde'];

// Valida dados do combo conforme tipo
function validarCombo(body) {
  const tipo = COMBO_TIPOS.includes(body?.tipo) ? body.tipo : null;
  if (!tipo) throw erro.validacao('Tipo de combo inválido.');
  
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 80 });
  const descricao = body?.descricao ? texto(body.descricao, 'descricao', { maximo: 300 }) : null;
  
  let preco_fixo_centavos = null;
  let desconto_percentual = null;
  let leve_quantidade = null;
  let pague_quantidade = null;
  let brinde_produto_id = null;
  
  if (tipo === 'preco_fixo') {
    preco_fixo_centavos = assertCentavos(body?.preco_fixo_centavos, 'preco_fixo_centavos');
  } else if (tipo === 'desconto_percentual') {
    desconto_percentual = assertInt(body?.desconto_percentual, 'desconto_percentual', { minimo: 1, maximo: 100 });
  } else if (tipo === 'leve_pague') {
    leve_quantidade = assertInt(body?.leve_quantidade, 'leve_quantidade', { minimo: 2 });
    pague_quantidade = assertInt(body?.pague_quantidade, 'pague_quantidade', { minimo: 1, maximo: leve_quantidade - 1 });
  } else if (tipo === 'brinde') {
    brinde_produto_id = assertInt(body?.brinde_produto_id, 'brinde_produto_id', { minimo: 1 });
  }
  
  const valido_de = body?.valido_de ? new Date(body.valido_de).toISOString() : null;
  const valido_ate = body?.valido_ate ? new Date(body.valido_ate).toISOString() : null;
  
  if (valido_de && valido_ate && valido_de >= valido_ate) {
    throw erro.validacao('Data de início deve ser anterior à data de fim.');
  }
  
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;
  const exige_estoque = body?.exige_estoque === 0 || body?.exige_estoque === false ? 0 : 1;

  // Janela semanal + limite de usos (migração 008)
  const dias_semana = body?.dias_semana === undefined || body?.dias_semana === null ? '0,1,2,3,4,5,6'
    : String(body.dias_semana).split(',').map((d) => d.trim()).filter((d) => d !== '').join(',');
  if (!/^(?:[0-6])(?:,[0-6])*$/.test(dias_semana)) throw erro.validacao('dias_semana inválidos (0=domingo..6=sábado).');
  const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const hora_ini = body?.hora_ini ? String(body.hora_ini).slice(0, 5) : null;
  const hora_fim = body?.hora_fim ? String(body.hora_fim).slice(0, 5) : null;
  if ((hora_ini && !HORA_RE.test(hora_ini)) || (hora_fim && !HORA_RE.test(hora_fim))) {
    throw erro.validacao('Horário inválido (use HH:MM).');
  }
  if (hora_ini && hora_fim && hora_ini >= hora_fim) throw erro.validacao('hora_ini deve ser anterior a hora_fim.');
  if ((hora_ini && !hora_fim) || (!hora_ini && hora_fim)) throw erro.validacao('Informe hora_ini e hora_fim juntos.');
  const limite_usos = body?.limite_usos === undefined || body?.limite_usos === null || body?.limite_usos === ''
    ? null : assertInt(body.limite_usos, 'limite_usos', { minimo: 1, maximo: 1000000 });

  return { nome, descricao, tipo, preco_fixo_centavos, desconto_percentual, leve_quantidade, pague_quantidade, brinde_produto_id, valido_de, valido_ate, ativo, exige_estoque, dias_semana, hora_ini, hora_fim, limite_usos };
}

// Valida itens do combo
function validarItensCombo(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw erro.validacao('Combo deve ter pelo menos 1 item.');
  }
  if (itens.length > 50) {
    throw erro.validacao('Máximo 50 itens por combo.');
  }
  
  const grupos = new Map();
  for (const it of itens) {
    const produto_id = assertInt(it?.produto_id, 'produto_id', { minimo: 1 });
    const quantidade = assertInt(it?.quantidade, 'quantidade', { minimo: 1, maximo: 999 });
    const obrigatorio = it?.obrigatorio === 0 || it?.obrigatorio === false ? 0 : 1;
    const grupo_escolha = it?.grupo_escolha ? assertInt(it.grupo_escolha, 'grupo_escolha', { minimo: 1 }) : null;
    const max_escolhas = it?.max_escolhas ? assertInt(it.max_escolhas, 'max_escolhas', { minimo: 1 }) : null;
    
    if (!obrigatorio && !grupo_escolha) {
      throw erro.validacao('Itens opcionais devem pertencer a um grupo de escolha.');
    }
    if (grupo_escolha && !max_escolhas) {
      throw erro.validacao('Grupos de escolha devem ter max_escolhas definido.');
    }
    if (grupo_escolha) {
      if (!grupos.has(grupo_escolha)) grupos.set(grupo_escolha, 0);
      grupos.set(grupo_escolha, grupos.get(grupo_escolha) + 1);
    }
  }
  
  // Validar grupos: max_escolhas não pode exceder itens do grupo
  for (const [grupo, count] of grupos) {
    const itemGrupo = itens.find(it => it.grupo_escolha === grupo);
    if (itemGrupo && itemGrupo.max_escolhas > count) {
      throw erro.validacao(`Grupo ${grupo}: max_escolhas (${itemGrupo.max_escolhas}) não pode exceder itens do grupo (${count}).`);
    }
  }
  
  return itens.map(it => ({
    produto_id: assertInt(it.produto_id, 'produto_id', { minimo: 1 }),
    quantidade: assertInt(it.quantidade, 'quantidade', { minimo: 1, maximo: 999 }),
    obrigatorio: it?.obrigatorio === 0 || it?.obrigatorio === false ? 0 : 1,
    grupo_escolha: it?.grupo_escolha ? assertInt(it.grupo_escolha, 'grupo_escolha', { minimo: 1 }) : null,
    max_escolhas: it?.max_escolhas ? assertInt(it.max_escolhas, 'max_escolhas', { minimo: 1 }) : null,
  }));
}

// Lista combos (com itens)
export function listarCombos(db, { comInativos = false } = {}) {
  const sql = `SELECT c.*, u.nome AS criado_por_nome FROM combos c LEFT JOIN usuarios u ON u.id = c.criado_por
    ${comInativos ? '' : 'WHERE c.ativo = 1'} ORDER BY c.nome`;
  const combos = db.prepare(sql).all();
  
  for (const c of combos) {
    c.itens = db.prepare(`
      SELECT ci.*, p.nome AS produto_nome, p.preco_centavos AS produto_preco, p.ativo AS produto_ativo
      FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
      WHERE ci.combo_id = ? ORDER BY ci.obrigatorio DESC, ci.grupo_escolha, p.nome
    `).all(c.id);
  }
  return combos;
}

// Obtém combo por ID com itens
export function obterCombo(db, id) {
  const c = db.prepare('SELECT c.*, u.nome AS criado_por_nome FROM combos c LEFT JOIN usuarios u ON u.id = c.criado_por WHERE c.id = ?').get(id);
  if (!c) throw erro.naoEncontrado('Combo não encontrado.');
  c.itens = db.prepare(`
    SELECT ci.*, p.nome AS produto_nome, p.preco_centavos AS produto_preco, p.ativo AS produto_ativo, p.area AS produto_area
    FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.combo_id = ? ORDER BY ci.obrigatorio DESC, ci.grupo_escolha, p.nome
  `).all(id);
  return c;
}

// Cria combo
export function criarCombo(db, usuario, body, ip) {
  const dados = validarCombo(body);
  const itens = validarItensCombo(body?.itens ?? []);
  
  return transacao(db, () => {
    const info = db.prepare(`
      INSERT INTO combos (nome, descricao, tipo, preco_fixo_centavos, desconto_percentual, leve_quantidade, pague_quantidade, brinde_produto_id, valido_de, valido_ate, ativo, exige_estoque, dias_semana, hora_ini, hora_fim, limite_usos, criado_em, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dados.nome, dados.descricao, dados.tipo, dados.preco_fixo_centavos, dados.desconto_percentual, dados.leve_quantidade, dados.pague_quantidade, dados.brinde_produto_id, dados.valido_de, dados.valido_ate, dados.ativo, dados.exige_estoque, dados.dias_semana, dados.hora_ini, dados.hora_fim, dados.limite_usos, agoraISO(), usuario.id);
    
    const comboId = Number(info.lastInsertRowid);
    
    for (const it of itens) {
      db.prepare(`
        INSERT INTO combo_itens (combo_id, produto_id, quantidade, obrigatorio, grupo_escolha, max_escolhas)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(comboId, it.produto_id, it.quantidade, it.obrigatorio, it.grupo_escolha, it.max_escolhas);
    }
    
    registrar(db, { usuarioId: usuario.id, acao: 'combo_criado', entidade: 'combo', entidadeId: comboId, detalhes: { nome: dados.nome, tipo: dados.tipo, itens: itens.length }, ip });
    return obterCombo(db, comboId);
  });
}

// Atualiza combo
export function atualizarCombo(db, usuario, id, body, ip) {
  const combo = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!combo) throw erro.naoEncontrado('Combo não encontrado.');
  
  const dados = validarCombo(body);
  const itens = body?.itens ? validarItensCombo(body.itens) : null;
  
  return transacao(db, () => {
    db.prepare(`
      UPDATE combos SET nome=?, descricao=?, tipo=?, preco_fixo_centavos=?, desconto_percentual=?, leve_quantidade=?, pague_quantidade=?, brinde_produto_id=?, valido_de=?, valido_ate=?, ativo=?, exige_estoque=?, dias_semana=?, hora_ini=?, hora_fim=?, limite_usos=?, atualizado_em=?, atualizado_por=?
      WHERE id=?
    `).run(dados.nome, dados.descricao, dados.tipo, dados.preco_fixo_centavos, dados.desconto_percentual, dados.leve_quantidade, dados.pague_quantidade, dados.brinde_produto_id, dados.valido_de, dados.valido_ate, dados.ativo, dados.exige_estoque, dados.dias_semana, dados.hora_ini, dados.hora_fim, dados.limite_usos, agoraISO(), usuario.id, id);
    
    if (itens !== null) {
      db.prepare('DELETE FROM combo_itens WHERE combo_id = ?').run(id);
      for (const it of itens) {
        db.prepare(`
          INSERT INTO combo_itens (combo_id, produto_id, quantidade, obrigatorio, grupo_escolha, max_escolhas)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, it.produto_id, it.quantidade, it.obrigatorio, it.grupo_escolha, it.max_escolhas);
      }
    }
    
    registrar(db, { usuarioId: usuario.id, acao: 'combo_atualizado', entidade: 'combo', entidadeId: id, detalhes: { nome: dados.nome, itens_alterados: itens !== null }, ip });
    return obterCombo(db, id);
  });
}

// Alterna ativo/inativo
export function toggleComboAtivo(db, usuario, id, ip) {
  const combo = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!combo) throw erro.naoEncontrado('Combo não encontrado.');
  const novoAtivo = combo.ativo ? 0 : 1;
  
  db.prepare('UPDATE combos SET ativo=?, atualizado_em=?, atualizado_por=? WHERE id=?').run(novoAtivo, agoraISO(), usuario.id, id);
  registrar(db, { usuarioId: usuario.id, acao: 'combo_toggle_ativo', entidade: 'combo', entidadeId: id, detalhes: { novo_ativo: novoAtivo }, ip });
  return obterCombo(db, id);
}

// Remove combo (soft delete via ativo=0, ou hard delete se sem uso)
export function removerCombo(db, usuario, id, ip) {
  const combo = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!combo) throw erro.naoEncontrado('Combo não encontrado.');
  
  // Verificar se foi usado em pedidos (futuro: tabela pedido_combos)
  // Por enquanto, soft delete
  db.prepare('UPDATE combos SET ativo=0, atualizado_em=?, atualizado_por=? WHERE id=?').run(agoraISO(), usuario.id, id);
  registrar(db, { usuarioId: usuario.id, acao: 'combo_removido', entidade: 'combo', entidadeId: id, detalhes: { nome: combo.nome }, ip });
  return { ok: true };
}

// Valida se combo está vigente e ativo
export function validarComboVigente(combo, agora = new Date()) {
  if (!combo.ativo) throw erro.validacao('Combo inativo.');
  const iso = agora.toISOString();
  if (combo.valido_de && combo.valido_de > iso) throw erro.validacao('Combo ainda não iniciou.');
  if (combo.valido_ate && combo.valido_ate < iso) throw erro.validacao('Combo expirado.');
  // Janela semanal (dias + faixa horária). Sem vínculo = vale sempre.
  const dias = String(combo.dias_semana ?? '0,1,2,3,4,5,6').split(',').map((d) => Number(d.trim()));
  if (!dias.includes(agora.getDay())) throw erro.validacao(`Combo fora dos dias de validade.`);
  if (combo.hora_ini && combo.hora_fim) {
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    if (!(combo.hora_ini <= hhmm && hhmm < combo.hora_fim)) {
      throw erro.validacao(`Combo válido apenas entre ${combo.hora_ini} e ${combo.hora_fim}.`);
    }
  }
  if (combo.limite_usos !== null && combo.limite_usos !== undefined && (combo.usos ?? 0) >= combo.limite_usos) {
    throw erro.validacao('Limite de utilizações do combo esgotado.');
  }
  return true;
}

// Agrega necessidade de ingredientes de uma lista de {produto_id, quantidade} e
// retorna alertas de insuficiência (mesmo formato de verificarEstoqueCombo).
function alertasNecessidade(db, lista) {
  const alertas = [];
  const porIngrediente = new Map();
  for (const { produto_id, quantidade } of lista) {
    const ficha = db.prepare(
      `SELECT pi.ingrediente_id, pi.quantidade_mil, i.nome, i.unidade, i.quantidade_mil AS estoque
       FROM produto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id
       WHERE pi.produto_id = ?`
    ).all(produto_id);
    for (const f of ficha) {
      const atual = porIngrediente.get(f.ingrediente_id) ?? { ...f, necessario: 0 };
      atual.necessario += f.quantidade_mil * quantidade;
      porIngrediente.set(f.ingrediente_id, atual);
    }
  }
  for (const f of porIngrediente.values()) {
    if (f.estoque < f.necessario) {
      alertas.push({ ingrediente: f.nome, necessario: f.necessario, disponivel: f.estoque, unidade: f.unidade });
    }
  }
  return alertas;
}

function textoAlertas(alertas) {
  return 'Estoque insuficiente para combo: ' + alertas.map((a) => `${a.ingrediente} (faltam ${a.necessario - a.disponivel} ${a.unidade})`).join(', ');
}

// Aplica um combo a um pedido ABERTO, em UMA transação atômica:
// 1) insere itens obrigatórios (+ opcionais escolhidos + brinde a preço zero);
// 2) calcula o benefício conforme o tipo e soma ao desconto do pedido;
// 3) registra em pedido_combos (idempotente por idempotency_key).
// Regra documentada: o desconto do combo SOMA-SE a desconto manual existente;
// o motivo do pedido passa a conter "Combo <nome>".
// Modo somenteDesconto: não insere itens (o pedido já os contém — ex.: montado
// no carrinho do PDV); valida a cobertura e aplica só benefício + brinde.
export function aplicarComboAPedido(db, pedido, combo, { escolhas = [], somenteDesconto = false, usuario, ip = null, hub = null, idempotencyKey = null } = {}) {
  validarComboVigente(combo);
  if (!pedido || pedido.status !== 'aberto') {
    throw erro.conflito('409_PEDIDO_FECHADO', 'Combo só pode ser aplicado em pedido aberto.');
  }

  if (idempotencyKey) {
    const anterior = db.prepare('SELECT * FROM pedido_combos WHERE idempotency_key = ?').get(idempotencyKey);
    if (anterior) {
      if (anterior.pedido_id !== pedido.id) throw erro.conflito('409_IDEMPOTENCIA', 'Idempotency-Key já usada em outro pedido.');
      return { ...anterior, ...calcularTotais(db, pedido.id), idempotente: true };
    }
  }

  const obrigatorios = db.prepare(
    `SELECT ci.produto_id, ci.quantidade, p.nome, p.preco_centavos, p.ativo
     FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
     WHERE ci.combo_id = ? AND ci.obrigatorio = 1`
  ).all(combo.id);
  if (obrigatorios.length === 0) throw erro.validacao('Combo sem itens obrigatórios.');
  for (const it of obrigatorios) {
    if (!it.ativo) throw erro.validacao(`Produto "${it.nome}" do combo está inativo.`);
  }

  // Opcionais: valida escolhas contra os grupos do combo (0..max por grupo)
  const opcionaisDoCombo = db.prepare(
    `SELECT ci.produto_id, ci.grupo_escolha, ci.max_escolhas, p.nome, p.preco_centavos, p.ativo
     FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
     WHERE ci.combo_id = ? AND ci.obrigatorio = 0`
  ).all(combo.id);
  const porProduto = new Map(opcionaisDoCombo.map((o) => [o.produto_id, o]));
  const escolhidos = [];
  const contaGrupo = new Map();
  for (const e of (Array.isArray(escolhas) ? escolhas.slice(0, 20) : [])) {
    const o = porProduto.get(Number(e?.produto_id));
    if (!o) throw erro.validacao(`Produto ${e?.produto_id} não é opcional deste combo.`);
    if (!o.ativo) throw erro.validacao(`Produto "${o.nome}" está inativo.`);
    const qtd = assertInt(e?.quantidade ?? 1, 'escolha.quantidade', { minimo: 1, maximo: 99 });
    const usadas = (contaGrupo.get(o.grupo_escolha) ?? 0) + qtd;
    if (usadas > o.max_escolhas) {
      throw erro.validacao(`Grupo ${o.grupo_escolha}: máximo de ${o.max_escolhas} escolhas.`);
    }
    contaGrupo.set(o.grupo_escolha, usadas);
    escolhidos.push({ produto_id: o.produto_id, quantidade: qtd, nome: o.nome, preco_centavos: o.preco_centavos });
  }

  let brinde = null;
  if (combo.tipo === 'brinde') {
    brinde = db.prepare('SELECT id, nome, ativo FROM produtos WHERE id = ?').get(combo.brinde_produto_id);
    if (!brinde || !brinde.ativo) throw erro.validacao('Produto brinde inexistente ou inativo.');
  }

  if (combo.exige_estoque) {
    const necessidade = [
      ...obrigatorios.map((it) => ({ produto_id: it.produto_id, quantidade: it.quantidade })),
      ...escolhidos,
      ...(brinde ? [{ produto_id: brinde.id, quantidade: 1 }] : []),
    ];
    const alertas = alertasNecessidade(db, necessidade);
    if (alertas.length > 0) throw erro.validacao(textoAlertas(alertas));
  }

  return transacao(db, () => {
    const agora = agoraISO();
    const precosUnidadePagos = []; // para leve_pague: unidades pagáveis (exclui brinde)
    let somaCatalogo = 0;

    if (somenteDesconto) {
      // O pedido já deve conter os itens obrigatórios (montados no carrinho)
      const noPedido = db.prepare(
        `SELECT produto_id, COALESCE(SUM(quantidade), 0) AS qtd FROM pedido_itens
         WHERE pedido_id = ? AND status = 'ativo' GROUP BY produto_id`
      ).all(pedido.id);
      const mapa = new Map(noPedido.map((r) => [r.produto_id, r.qtd]));
      for (const it of obrigatorios) {
        if ((mapa.get(it.produto_id) ?? 0) < it.quantidade) {
          throw erro.validacao(`O pedido não contém os itens do combo (falta ${it.quantidade}x "${it.nome}").`);
        }
        somaCatalogo += it.preco_centavos * it.quantidade;
        for (let i = 0; i < it.quantidade; i++) precosUnidadePagos.push(it.preco_centavos);
      }
    } else {
      for (const it of obrigatorios) {
        inserirItemValidado(db, pedido.id, { produto_id: it.produto_id, quantidade: it.quantidade, observacoes: `Combo: ${combo.nome}` }, null);
        somaCatalogo += it.preco_centavos * it.quantidade;
        for (let i = 0; i < it.quantidade; i++) precosUnidadePagos.push(it.preco_centavos);
      }
    }
    for (const e of escolhidos) {
      inserirItemValidado(db, pedido.id, { produto_id: e.produto_id, quantidade: e.quantidade, observacoes: `Combo: ${combo.nome} (opcional)` }, null);
      somaCatalogo += e.preco_centavos * e.quantidade;
      for (let i = 0; i < e.quantidade; i++) precosUnidadePagos.push(e.preco_centavos);
    }
    if (brinde) {
      db.prepare(
        `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unit_centavos, observacoes, criado_em)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      ).run(pedido.id, brinde.id, brinde.nome, `BRINDE — Combo: ${combo.nome}`, agora);
    }

    let desconto = 0;
    if (combo.tipo === 'preco_fixo') {
      desconto = Math.max(0, somaCatalogo - combo.preco_fixo_centavos);
    } else if (combo.tipo === 'desconto_percentual') {
      desconto = Math.round((somaCatalogo * combo.desconto_percentual) / 100);
    } else if (combo.tipo === 'leve_pague') {
      const L = combo.leve_quantidade, P = combo.pague_quantidade;
      const ordenados = precosUnidadePagos.sort((a, b) => a - b);
      const total = ordenados.length;
      const pagos = Math.floor(total / L) * P + Math.min(total % L, P);
      const gratis = total - pagos;
      desconto = ordenados.slice(0, gratis).reduce((s, v) => s + v, 0);
    }
    // brinde: benefício é o item a preço zero (sem desconto adicional).

    if (desconto > 0) {
      const motivoCombo = `Combo "${combo.nome}" (-${(desconto / 100).toFixed(2)})`;
      const motivoAtual = pedido.desconto_motivo ? pedido.desconto_motivo + ' + ' : '';
      db.prepare('UPDATE pedidos SET desconto_centavos = desconto_centavos + ?, desconto_motivo = ?, desconto_usuario_id = ? WHERE id = ?')
        .run(desconto, (motivoAtual + motivoCombo).slice(0, 300), usuario.id, pedido.id);
    }

    // Integridade: o benefício não pode derrubar o total abaixo do já pago
    // (deixa a venda impossível de fechar/pagar). A transação desfaz tudo.
    const totaisApos = calcularTotais(db, pedido.id);
    if (totaisApos.saldo_centavos < 0) {
      throw erro.conflito('409_SALDO_PENDENTE',
        `O combo deixaria o total (R$ ${(totaisApos.total_centavos / 100).toFixed(2)}) abaixo do já pago (R$ ${(totaisApos.pago_centavos / 100).toFixed(2)}). Estorne o pagamento antes de aplicar o combo.`,
        { totais: totaisApos });
    }

    const info = db.prepare(
      `INSERT INTO pedido_combos (pedido_id, combo_id, desconto_centavos, idempotency_key, aplicado_por, aplicado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(pedido.id, combo.id, desconto, idempotencyKey, usuario.id, agora);
    db.prepare('UPDATE combos SET usos = usos + 1 WHERE id = ?').run(combo.id);
    const registro = db.prepare('SELECT * FROM pedido_combos WHERE id = ?').get(Number(info.lastInsertRowid));

    registrar(db, {
      usuarioId: usuario.id, acao: 'combo_aplicado', entidade: 'pedido', entidadeId: pedido.id,
      detalhes: { combo_id: combo.id, combo_nome: combo.nome, tipo: combo.tipo, desconto_centavos: desconto }, ip,
    });
    hub?.publicar('pedido.atualizado', { pedido_id: pedido.id });
    return { ...registro, ...calcularTotais(db, pedido.id) };
  });
}

// Calcula preço do combo baseado nos itens (para validação/sugestão)
export function calcularPrecoItens(db, comboId) {
  const itens = db.prepare(`
    SELECT ci.quantidade, p.preco_centavos
    FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.combo_id = ? AND ci.obrigatorio = 1
  `).all(comboId);
  
  let total = 0;
  for (const it of itens) total += it.preco_centavos * it.quantidade;
  return total;
}

// Verifica disponibilidade de estoque para combo
export function verificarEstoqueCombo(db, comboId) {
  const alertas = [];
  const itens = db.prepare(`
    SELECT ci.produto_id, ci.quantidade, p.nome
    FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.combo_id = ? AND ci.obrigatorio = 1
  `).all(comboId);
  
  for (const it of itens) {
    const ficha = db.prepare(`
      SELECT pi.ingrediente_id, pi.quantidade_mil, i.nome, i.unidade, i.quantidade_mil AS estoque, i.minimo_mil
      FROM produto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id
      WHERE pi.produto_id = ?
    `).all(it.produto_id);
    
    for (const f of ficha) {
      const necessario = f.quantidade_mil * it.quantidade;
      if (f.estoque < necessario) {
        alertas.push({ ingrediente: f.nome, necessario, disponivel: f.estoque, unidade: f.unidade });
      }
    }
  }
  return alertas;
}