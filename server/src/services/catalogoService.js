import { erro } from '../core/errors.js';
import { assertCentavos, assertInt } from '../core/money.js';
import { texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';
import { promocaoVigente } from './promocoesService.js';

// ---------- Categorias ----------
export const TIPOS_ITEM = ['lanche', 'prato', 'porcao', 'bebida', 'sobremesa', 'servico', 'outro'];

// Disponibilidade de venda: indisponível com motivo OU fora de período vinculado.
export function disponibilidadeProduto(db, produto, agora = new Date()) {
  if (produto.indisponivel_motivo) {
    return { disponivel: false, motivo: produto.indisponivel_motivo };
  }
  const vinculos = db.prepare('SELECT COUNT(*) AS n FROM produto_periodos WHERE produto_id = ?').get(produto.id).n;
  if (vinculos === 0) return { disponivel: true, motivo: null };
  const periodos = db.prepare(
    `SELECT pp.periodo_id, pc.nome, pc.dias, pc.hora_ini, pc.hora_fim
     FROM produto_periodos pp JOIN periodos_cardapio pc ON pc.id = pp.periodo_id
     WHERE pp.produto_id = ? AND pc.ativo = 1`
  ).all(produto.id);
  const dia = agora.getDay();
  const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  for (const p of periodos) {
    const dias = String(p.dias).split(',').map((d) => Number(d.trim()));
    if (dias.includes(dia) && p.hora_ini <= hhmm && hhmm < p.hora_fim) {
      return { disponivel: true, motivo: null };
    }
  }
  return { disponivel: false, motivo: `Fora do período de venda (${periodos.map((p) => p.nome).join(', ')})` };
}

// ---------- Categorias ----------
export function listarCategorias(db, { comInativos = false } = {}) {
  return db.prepare(`SELECT * FROM categorias ${comInativos ? '' : 'WHERE ativo = 1'} ORDER BY ordem, nome`).all();
}

export function criarCategoria(db, usuario, body, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 60 });
  const ordem = assertInt(body?.ordem ?? 0, 'ordem', { minimo: 0, maximo: 9999 });
  return transacao(db, () => {
    const dup = db.prepare('SELECT id FROM categorias WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Categoria já existe.');
    const info = db.prepare('INSERT INTO categorias (nome, ordem) VALUES (?, ?)').run(nome, ordem);
    registrar(db, { usuarioId: usuario.id, acao: 'categoria_criada', entidade: 'categoria', entidadeId: Number(info.lastInsertRowid), detalhes: { nome }, ip });
    return db.prepare('SELECT * FROM categorias WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

// ---------- Produtos ----------
export function listarProdutos(db, { comInativos = false } = {}) {
  const sql = `SELECT p.*, c.nome AS categoria_nome FROM produtos p JOIN categorias c ON c.id = p.categoria_id
    ${comInativos ? '' : 'WHERE p.ativo = 1 AND c.ativo = 1'} ORDER BY c.ordem, p.nome`;
  const produtos = db.prepare(sql).all();
  const vinculos = db.prepare('SELECT pa.produto_id, pa.adicional_id, a.nome, a.preco_centavos FROM produto_adicionais pa JOIN adicionais a ON a.id = pa.adicional_id WHERE a.ativo = 1').all();
  const porProduto = new Map();
  for (const v of vinculos) {
    if (!porProduto.has(v.produto_id)) porProduto.set(v.produto_id, []);
    porProduto.get(v.produto_id).push({ adicional_id: v.adicional_id, nome: v.nome, preco_centavos: v.preco_centavos });
  }
  const variacoes = db.prepare('SELECT id, produto_id, grupo, nome, delta_centavos FROM produto_variacoes WHERE ativo = 1 ORDER BY grupo, nome').all();
  const varPorProduto = new Map();
  for (const v of variacoes) {
    if (!varPorProduto.has(v.produto_id)) varPorProduto.set(v.produto_id, []);
    varPorProduto.get(v.produto_id).push(v);
  }
  return produtos.map((p) => {
    const disp = disponibilidadeProduto(db, p);
    let preco_vigente_centavos = p.preco_centavos;
    let promocao_ativa = null;
    try {
      const promo = promocaoVigente(db, p.id);
      if (promo && promo.preco_promocional_centavos < preco_vigente_centavos) {
        preco_vigente_centavos = promo.preco_promocional_centavos;
        promocao_ativa = { id: promo.id, nome: promo.nome, tipo: promo.tipo };
      }
    } catch { /* sem tabela em banco antigo */ }
    return {
      ...p,
      adicionais: porProduto.get(p.id) ?? [],
      variacoes: varPorProduto.get(p.id) ?? [],
      disponivel: disp.disponivel ? 1 : 0,
      indisponibilidade_motivo: disp.disponivel ? null : disp.motivo,
      preco_vigente_centavos,
      promocao_ativa,
    };
  });
}

export function salvarProduto(db, usuario, body, produtoId = null, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 80 });
  const categoriaId = assertInt(body?.categoria_id, 'categoria_id', { minimo: 1 });
  const preco = assertCentavos(body?.preco_centavos, 'preco_centavos');
  const custo = body?.custo_centavos === undefined || body?.custo_centavos === null || body?.custo_centavos === ''
    ? null : assertCentavos(body.custo_centavos, 'custo_centavos');
  const area = ['cozinha', 'bar'].includes(body?.area) ? body.area : 'cozinha';
  const tempo = assertInt(body?.tempo_preparo_min ?? 10, 'tempo_preparo_min', { minimo: 0, maximo: 600 });
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;
  const tipo_item = TIPOS_ITEM.includes(body?.tipo_item) ? body.tipo_item : 'lanche';
  const codigo_barras = body?.codigo_barras === undefined || body?.codigo_barras === null || String(body.codigo_barras).trim() === ''
    ? null : String(body.codigo_barras).trim().slice(0, 32);
  if (codigo_barras && !/^[0-9A-Za-z-]{3,32}$/.test(codigo_barras)) {
    throw erro.validacao('Código de barras inválido (3–32 caracteres alfanuméricos).');
  }
  const apelidos = body?.apelidos === undefined || body?.apelidos === null ? null
    : String(body.apelidos).toLowerCase().split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10).join(', ') || null;
  const indisponivel_motivo = body?.indisponivel_motivo === undefined || body?.indisponivel_motivo === null || String(body.indisponivel_motivo).trim() === ''
    ? null : String(body.indisponivel_motivo).trim().slice(0, 120);
  const rendimento = body?.rendimento_porcoes === undefined || body?.rendimento_porcoes === null || body?.rendimento_porcoes === ''
    ? 1 : assertInt(body.rendimento_porcoes, 'rendimento_porcoes', { minimo: 1, maximo: 10000 });

  return transacao(db, () => {
    const cat = db.prepare('SELECT id FROM categorias WHERE id = ? AND ativo = 1').get(categoriaId);
    if (!cat) throw erro.validacao('Categoria inexistente ou inativa.');
    if (codigo_barras) {
      const dup = db.prepare('SELECT id FROM produtos WHERE codigo_barras = ? AND id != ?').get(codigo_barras, produtoId ?? -1);
      if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Código de barras já cadastrado em outro produto.');
    }
    if (produtoId) {
      const atual = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
      if (!atual) throw erro.naoEncontrado('Produto não encontrado.');
      db.prepare(
        `UPDATE produtos SET nome=?, categoria_id=?, preco_centavos=?, custo_centavos=?, area=?, tempo_preparo_min=?, ativo=?,
         tipo_item=?, codigo_barras=?, apelidos=?, indisponivel_motivo=?, rendimento_porcoes=? WHERE id=?`
      ).run(nome, categoriaId, preco, custo, area, tempo, ativo, tipo_item, codigo_barras, apelidos, indisponivel_motivo, rendimento, produtoId);
      // Alteração de preço é audited (price integrity)
      if (atual.preco_centavos !== preco) {
        db.prepare(
          `INSERT INTO preco_historico (produto_id, preco_centavos, valido_de, aplicado, criado_por, criado_em)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).run(produtoId, preco, agoraISO(), usuario.id, agoraISO());
        registrar(db, {
          usuarioId: usuario.id, acao: 'preco_alterado', entidade: 'produto', entidadeId: produtoId,
          detalhes: { anterior_centavos: atual.preco_centavos, novo_centavos: preco, nome }, ip,
        });
      } else {
        registrar(db, { usuarioId: usuario.id, acao: 'produto_alterado', entidade: 'produto', entidadeId: produtoId, detalhes: { nome }, ip });
      }
      if ((atual.indisponivel_motivo ?? null) !== indisponivel_motivo) {
        registrar(db, {
          usuarioId: usuario.id, acao: indisponivel_motivo ? 'produto_indisponivel' : 'produto_disponivel',
          entidade: 'produto', entidadeId: produtoId, detalhes: { nome, motivo: indisponivel_motivo }, ip,
        });
      }
      return db.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
    }
    const info = db.prepare(
      `INSERT INTO produtos (nome, categoria_id, preco_centavos, custo_centavos, area, tempo_preparo_min, ativo,
        tipo_item, codigo_barras, apelidos, indisponivel_motivo, rendimento_porcoes, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nome, categoriaId, preco, custo, area, tempo, ativo, tipo_item, codigo_barras, apelidos, indisponivel_motivo, rendimento, agoraISO());
    const novoId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO preco_historico (produto_id, preco_centavos, valido_de, aplicado, criado_por, criado_em)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(novoId, preco, agoraISO(), usuario.id, agoraISO());
    registrar(db, { usuarioId: usuario.id, acao: 'produto_criado', entidade: 'produto', entidadeId: novoId, detalhes: { nome, preco_centavos: preco }, ip });
    return db.prepare('SELECT * FROM produtos WHERE id = ?').get(novoId);
  });
}

// ---------- Adicionais ----------
export function listarAdicionais(db) {
  return db.prepare('SELECT * FROM adicionais WHERE ativo = 1 ORDER BY nome').all();
}

export function criarAdicional(db, usuario, body, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 60 });
  const preco = assertCentavos(body?.preco_centavos, 'preco_centavos');
  return transacao(db, () => {
    const dup = db.prepare('SELECT id FROM adicionais WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Adicional já existe.');
    const info = db.prepare('INSERT INTO adicionais (nome, preco_centavos) VALUES (?, ?)').run(nome, preco);
    registrar(db, { usuarioId: usuario.id, acao: 'adicional_criado', entidade: 'adicional', entidadeId: Number(info.lastInsertRowid), detalhes: { nome, preco_centavos: preco }, ip });
    return db.prepare('SELECT * FROM adicionais WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

export function vincularAdicionais(db, usuario, produtoId, adicionalIds, ip) {
  return transacao(db, () => {
    const produto = db.prepare('SELECT id FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    db.prepare('DELETE FROM produto_adicionais WHERE produto_id = ?').run(produtoId);
    for (const id of (Array.isArray(adicionalIds) ? adicionalIds.slice(0, 50) : [])) {
      const ad = db.prepare('SELECT id FROM adicionais WHERE id = ? AND ativo = 1').get(Number(id));
      if (!ad) throw erro.validacao(`Adicional ${id} inexistente.`);
      db.prepare('INSERT INTO produto_adicionais (produto_id, adicional_id) VALUES (?, ?)').run(produtoId, ad.id);
    }
    registrar(db, { usuarioId: usuario.id, acao: 'produto_adicionais_vinculados', entidade: 'produto', entidadeId: produtoId, detalhes: { total: adicionalIds?.length ?? 0 }, ip });
    return { ok: true };
  });
}

// ---------- Mesas ----------
export function listarMesas(db) {
  // Subconsultas (e não LEFT JOIN) porque uma mesa pode ter VÁRIAS comandas
  // abertas (comanda individual). Um JOIN aqui duplicaria a linha da mesa.
  return db.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM pedidos p WHERE p.mesa_id = m.id AND p.status = 'aberto') AS comandas_abertas,
            (SELECT p.id FROM pedidos p WHERE p.mesa_id = m.id AND p.status = 'aberto' ORDER BY p.id LIMIT 1) AS pedido_id,
            (SELECT p.comanda_nome FROM pedidos p WHERE p.mesa_id = m.id AND p.status = 'aberto' ORDER BY p.id LIMIT 1) AS comanda_nome,
            (SELECT p.aberto_em FROM pedidos p WHERE p.mesa_id = m.id AND p.status = 'aberto' ORDER BY p.id LIMIT 1) AS aberto_em
     FROM mesas m ORDER BY m.setor, m.numero`
  ).all();
}

export function salvarMesa(db, usuario, body, mesaId = null, ip) {
  const numero = assertInt(body?.numero, 'numero', { minimo: 1, maximo: 9999 });
  const setor = texto(body?.setor ?? 'salao', 'setor', { obrigatorio: false, maximo: 40, padrao: 'salao' }) || 'salao';
  return transacao(db, () => {
    if (mesaId) {
      const atual = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
      if (!atual) throw erro.naoEncontrado('Mesa não encontrada.');
      // Renumerar só com mesa livre (evita confundir comandas em atendimento)
      if (atual.status !== 'livre') {
        throw erro.conflito('409_MESA_OCUPADA', `Mesa ${atual.numero} está ${atual.status}; renumere apenas mesas livres.`);
      }
      const outra = db.prepare('SELECT id FROM mesas WHERE numero = ? AND id != ?').get(numero, mesaId);
      if (outra) throw erro.conflito('409_CONFLITO_ESTADO', `Já existe outra mesa com o número ${numero}.`);
      db.prepare('UPDATE mesas SET numero = ?, setor = ? WHERE id = ?').run(numero, setor, mesaId);
      registrar(db, { usuarioId: usuario.id, acao: 'mesa_alterada', entidade: 'mesa', entidadeId: mesaId, detalhes: { numero, setor }, ip });
      return db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    }
    const dup = db.prepare('SELECT id FROM mesas WHERE numero = ?').get(numero);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', `Mesa ${numero} já existe.`);
    const info = db.prepare(`INSERT INTO mesas (numero, setor, criado_em) VALUES (?, ?, ?)`).run(numero, setor, agoraISO());
    registrar(db, { usuarioId: usuario.id, acao: 'mesa_criada', entidade: 'mesa', entidadeId: Number(info.lastInsertRowid), detalhes: { numero, setor }, ip });
    return db.prepare('SELECT * FROM mesas WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

// Exclusão só de mesa livre E sem nenhum histórico de pedidos (preserva auditoria financeira).
export function removerMesa(db, usuario, mesaId, ip) {
  return transacao(db, () => {
    const atual = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    if (!atual) throw erro.naoEncontrado('Mesa não encontrada.');
    if (atual.status !== 'livre') {
      throw erro.conflito('409_MESA_OCUPADA', `Mesa ${atual.numero} está ${atual.status}; exclua apenas mesas livres.`);
    }
    const usos = db.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE mesa_id = ?').get(mesaId).n;
    if (usos > 0) {
      throw erro.conflito('409_CONFLITO_ESTADO', `Mesa ${atual.numero} possui ${usos} comanda(s) no histórico e não pode ser excluída (preservação de auditoria).`);
    }
    db.prepare('DELETE FROM mesas WHERE id = ?').run(mesaId);
    registrar(db, { usuarioId: usuario.id, acao: 'mesa_removida', entidade: 'mesa', entidadeId: mesaId, detalhes: { numero: atual.numero, setor: atual.setor }, ip });
    return { ok: true, removida: atual.numero };
  });
}

// ---------- Variações do produto (A1 item 1.2) ----------
export function listarVariacoes(db, produtoId) {
  return db.prepare('SELECT * FROM produto_variacoes WHERE produto_id = ? ORDER BY grupo, nome').all(produtoId);
}

export function salvarVariacao(db, usuario, produtoId, body, variacaoId = null, ip) {
  const grupo = texto(body?.grupo ?? 'opcao', 'grupo', { obrigatorio: false, maximo: 40, padrao: 'opcao' }) || 'opcao';
  const nome = texto(body?.nome, 'nome', { minimo: 1, maximo: 60 });
  const delta = body?.delta_centavos === undefined || body?.delta_centavos === null
    ? 0 : assertInt(body.delta_centavos, 'delta_centavos', { minimo: -999999, maximo: 999999 });
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;
  return transacao(db, () => {
    const produto = db.prepare('SELECT id FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    if (variacaoId) {
      const atual = db.prepare('SELECT * FROM produto_variacoes WHERE id = ? AND produto_id = ?').get(variacaoId, produtoId);
      if (!atual) throw erro.naoEncontrado('Variação não encontrada.');
      const dup = db.prepare('SELECT id FROM produto_variacoes WHERE produto_id = ? AND nome = ? AND id != ?').get(produtoId, nome, variacaoId);
      if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe variação com esse nome neste produto.');
      db.prepare('UPDATE produto_variacoes SET grupo = ?, nome = ?, delta_centavos = ?, ativo = ? WHERE id = ?')
        .run(grupo, nome, delta, ativo, variacaoId);
      registrar(db, { usuarioId: usuario.id, acao: 'variacao_alterada', entidade: 'produto_variacao', entidadeId: variacaoId, detalhes: { produto_id: produtoId, nome, delta_centavos: delta }, ip });
      return db.prepare('SELECT * FROM produto_variacoes WHERE id = ?').get(variacaoId);
    }
    const dup = db.prepare('SELECT id FROM produto_variacoes WHERE produto_id = ? AND nome = ?').get(produtoId, nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe variação com esse nome neste produto.');
    const info = db.prepare('INSERT INTO produto_variacoes (produto_id, grupo, nome, delta_centavos, ativo) VALUES (?, ?, ?, ?, ?)')
      .run(produtoId, grupo, nome, delta, ativo);
    registrar(db, { usuarioId: usuario.id, acao: 'variacao_criada', entidade: 'produto_variacao', entidadeId: Number(info.lastInsertRowid), detalhes: { produto_id: produtoId, nome, delta_centavos: delta }, ip });
    return db.prepare('SELECT * FROM produto_variacoes WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

// ---------- Preço com vigência (A1 item 1.7) ----------
export function programarPreco(db, usuario, produtoId, body, ip) {
  const preco = assertCentavos(body?.preco_centavos, 'preco_centavos');
  const validoRaw = body?.valido_de ? String(body.valido_de) : null;
  const validoDe = validoRaw ? new Date(validoRaw).toISOString() : agoraISO();
  if (Number.isNaN(new Date(validoDe).getTime())) throw erro.validacao('Data de vigência inválida.');
  return transacao(db, () => {
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    const agora = agoraISO();
    const aplicarAgora = validoDe <= agora;
    const info = db.prepare(
      `INSERT INTO preco_historico (produto_id, preco_centavos, valido_de, aplicado, criado_por, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(produtoId, preco, validoDe, aplicarAgora ? 1 : 0, usuario.id, agora);
    if (aplicarAgora && produto.preco_centavos !== preco) {
      db.prepare('UPDATE produtos SET preco_centavos = ? WHERE id = ?').run(preco, produtoId);
      registrar(db, {
        usuarioId: usuario.id, acao: 'preco_alterado', entidade: 'produto', entidadeId: produtoId,
        detalhes: { anterior_centavos: produto.preco_centavos, novo_centavos: preco, nome: produto.nome, vigencia: validoDe }, ip,
      });
    }
    return { id: Number(info.lastInsertRowid), aplicado: aplicarAgora ? 1 : 0, preco_centavos: preco, valido_de: validoDe };
  });
}

export function historicoPrecos(db, produtoId) {
  return db.prepare(
    `SELECT h.*, u.nome AS criado_por_nome FROM preco_historico h LEFT JOIN usuarios u ON u.id = h.criado_por
     WHERE h.produto_id = ? ORDER BY h.valido_de DESC, h.id DESC LIMIT 100`
  ).all(produtoId);
}

// Aplica preços programados cuja vigência chegou. Chamado antes de montar vendas.
export function sincronizarPrecosVigentes(db) {
  const agora = agoraISO();
  const pendentes = db.prepare(
    `SELECT h.id, h.produto_id, h.preco_centavos, p.preco_centavos AS atual
     FROM preco_historico h JOIN produtos p ON p.id = h.produto_id
     WHERE h.aplicado = 0 AND h.valido_de <= ?
     ORDER BY h.valido_de, h.id`
  ).all(agora);
  let aplicados = 0;
  for (const h of pendentes) {
    db.prepare('UPDATE preco_historico SET aplicado = 1 WHERE id = ?').run(h.id);
    if (h.atual !== h.preco_centavos) {
      db.prepare('UPDATE produtos SET preco_centavos = ? WHERE id = ?').run(h.preco_centavos, h.produto_id);
      registrar(db, {
        usuarioId: null, acao: 'preco_vigencia_aplicada', entidade: 'produto', entidadeId: h.produto_id,
        detalhes: { anterior_centavos: h.atual, novo_centavos: h.preco_centavos, automatico: true },
      });
    }
    aplicados++;
  }
  return aplicados;
}

// ---------- Períodos de cardápio (A1 item 1.8) ----------
const DIAS_RE = /^(?:[0-6])(?:,[0-6])*$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function listarPeriodos(db) {
  return db.prepare('SELECT * FROM periodos_cardapio ORDER BY nome').all();
}

export function salvarPeriodo(db, usuario, body, periodoId = null, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 60 });
  const dias = texto(body?.dias ?? '0,1,2,3,4,5,6', 'dias', { obrigatorio: false, maximo: 20, padrao: '0,1,2,3,4,5,6' }) || '0,1,2,3,4,5,6';
  if (!DIAS_RE.test(dias)) throw erro.validacao('Dias inválidos (use 0=domingo..6=sábado separados por vírgula).');
  const hora_ini = texto(body?.hora_ini, 'hora_ini', { maximo: 5 });
  const hora_fim = texto(body?.hora_fim, 'hora_fim', { maximo: 5 });
  if (!HORA_RE.test(hora_ini) || !HORA_RE.test(hora_fim)) throw erro.validacao('Horário inválido (use HH:MM).');
  if (hora_ini >= hora_fim) throw erro.validacao('Hora inicial deve ser anterior à final.');
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;
  return transacao(db, () => {
    if (periodoId) {
      const atual = db.prepare('SELECT * FROM periodos_cardapio WHERE id = ?').get(periodoId);
      if (!atual) throw erro.naoEncontrado('Período não encontrado.');
      db.prepare('UPDATE periodos_cardapio SET nome = ?, dias = ?, hora_ini = ?, hora_fim = ?, ativo = ? WHERE id = ?')
        .run(nome, dias, hora_ini, hora_fim, ativo, periodoId);
      registrar(db, { usuarioId: usuario.id, acao: 'periodo_alterado', entidade: 'periodo', entidadeId: periodoId, detalhes: { nome }, ip });
      return db.prepare('SELECT * FROM periodos_cardapio WHERE id = ?').get(periodoId);
    }
    const dup = db.prepare('SELECT id FROM periodos_cardapio WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Período já existe.');
    const info = db.prepare('INSERT INTO periodos_cardapio (nome, dias, hora_ini, hora_fim, ativo) VALUES (?, ?, ?, ?, ?)')
      .run(nome, dias, hora_ini, hora_fim, ativo);
    registrar(db, { usuarioId: usuario.id, acao: 'periodo_criado', entidade: 'periodo', entidadeId: Number(info.lastInsertRowid), detalhes: { nome }, ip });
    return db.prepare('SELECT * FROM periodos_cardapio WHERE id = ?').get(Number(info.lastInsertRowid));
  });
}

export function removerPeriodo(db, usuario, periodoId, ip) {
  return transacao(db, () => {
    const atual = db.prepare('SELECT * FROM periodos_cardapio WHERE id = ?').get(periodoId);
    if (!atual) throw erro.naoEncontrado('Período não encontrado.');
    db.prepare('DELETE FROM produto_periodos WHERE periodo_id = ?').run(periodoId);
    db.prepare('DELETE FROM periodos_cardapio WHERE id = ?').run(periodoId);
    registrar(db, { usuarioId: usuario.id, acao: 'periodo_removido', entidade: 'periodo', entidadeId: periodoId, detalhes: { nome: atual.nome }, ip });
    return { ok: true };
  });
}

export function vincularPeriodos(db, usuario, produtoId, periodoIds, ip) {
  return transacao(db, () => {
    const produto = db.prepare('SELECT id FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw erro.naoEncontrado('Produto não encontrado.');
    db.prepare('DELETE FROM produto_periodos WHERE produto_id = ?').run(produtoId);
    for (const id of (Array.isArray(periodoIds) ? periodoIds.slice(0, 20) : [])) {
      const per = db.prepare('SELECT id FROM periodos_cardapio WHERE id = ?').get(Number(id));
      if (!per) throw erro.validacao(`Período ${id} inexistente.`);
      db.prepare('INSERT INTO produto_periodos (produto_id, periodo_id) VALUES (?, ?)').run(produtoId, per.id);
    }
    registrar(db, { usuarioId: usuario.id, acao: 'produto_periodos_vinculados', entidade: 'produto', entidadeId: produtoId, detalhes: { total: periodoIds?.length ?? 0 }, ip });
    return { ok: true };
  });
}

// ---------- Mais vendidos (A1 item 1.10) ----------
export function topVendidos(db, { dias = 30, limite = 8 } = {}) {
  const d = assertInt(dias, 'dias', { minimo: 1, maximo: 365 });
  const lim = assertInt(limite, 'limite', { minimo: 1, maximo: 24 });
  const desde = new Date(Date.now() - d * 24 * 3600_000).toISOString();
  return db.prepare(
    `SELECT i.produto_id AS produto_id, i.nome_produto AS nome, SUM(i.quantidade) AS quantidade,
            SUM((i.preco_unit_centavos) * i.quantidade) AS valor_centavos
     FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
     WHERE i.status = 'ativo' AND p.status = 'fechado' AND p.fechado_em >= ?
     GROUP BY i.produto_id ORDER BY quantidade DESC LIMIT ?`
  ).all(desde, lim);
}


// ---------- Bloqueio de mesa (A3 item 3.7) ----------
export function bloquearMesa(db, usuario, mesaId, body, ip) {
  const bloqueada = body?.bloqueada === true || body?.bloqueada === 1 ? 1 : 0;
  const motivo = bloqueada
    ? (String(body?.motivo ?? '').trim().slice(0, 120) || 'Bloqueio operacional')
    : null;
  return transacao(db, () => {
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    if (!mesa) throw erro.naoEncontrado('Mesa não encontrada.');
    if (mesa.status !== 'livre' && bloqueada) {
      throw erro.conflito('409_MESA_OCUPADA', `Mesa ${mesa.numero} está ${mesa.status}; só mesas livres podem ser bloqueadas.`);
    }
    db.prepare('UPDATE mesas SET bloqueada = ?, bloqueio_motivo = ? WHERE id = ?').run(bloqueada, motivo, mesaId);
    registrar(db, {
      usuarioId: usuario.id, acao: bloqueada ? 'mesa_bloqueada' : 'mesa_desbloqueada',
      entidade: 'mesa', entidadeId: mesaId, detalhes: { numero: mesa.numero, motivo }, ip,
    });
    return db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
  });
}

// ---------- Chamado de garçom (A3 item 3.16) ----------
export function chamarGarcom(db, usuario, mesaId, body, ip, hub) {
  const tipo = ['chamar', 'conta', 'apoio'].includes(body?.tipo) ? body.tipo : 'chamar';
  return transacao(db, () => {
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    if (!mesa) throw erro.naoEncontrado('Mesa não encontrada.');
    const pedido = db.prepare(`SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1`).get(mesaId);
    const dup = db.prepare(`SELECT id FROM chamados_garcom WHERE mesa_id = ? AND status = 'pendente' AND tipo = ?`).get(mesaId, tipo);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', `Mesa ${mesa.numero} já tem chamado pendente.`);
    const info = db.prepare(
      `INSERT INTO chamados_garcom (mesa_id, pedido_id, tipo, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)`
    ).run(mesaId, pedido?.id ?? null, tipo, usuario.id, agoraISO());
    const id = Number(info.lastInsertRowid);
    registrar(db, { usuarioId: usuario.id, acao: 'garcom_chamado', entidade: 'chamado', entidadeId: id, detalhes: { mesa: mesa.numero, tipo }, ip });
    setImmediate(() => hub?.publicar('garcom.chamado', { chamado_id: id, mesa_id: mesaId, mesa_numero: mesa.numero, tipo }));
    return db.prepare('SELECT * FROM chamados_garcom WHERE id = ?').get(id);
  });
}

export function listarChamados(db) {
  return db.prepare(
    `SELECT c.*, m.numero AS mesa_numero FROM chamados_garcom c JOIN mesas m ON m.id = c.mesa_id
     WHERE c.status = 'pendente' ORDER BY c.id`
  ).all();
}

export function atenderChamado(db, usuario, chamadoId, ip, hub) {
  return transacao(db, () => {
    const c = db.prepare('SELECT * FROM chamados_garcom WHERE id = ?').get(chamadoId);
    if (!c) throw erro.naoEncontrado('Chamado não encontrado.');
    if (c.status !== 'pendente') throw erro.conflito('409_CONFLITO_ESTADO', 'Chamado já atendido.');
    db.prepare(`UPDATE chamados_garcom SET status = 'atendido', atendido_em = ?, atendido_por = ? WHERE id = ?`)
      .run(agoraISO(), usuario.id, chamadoId);
    registrar(db, { usuarioId: usuario.id, acao: 'garcom_chamado_atendido', entidade: 'chamado', entidadeId: chamadoId, ip });
    setImmediate(() => hub?.publicar('garcom.atendido', { chamado_id: chamadoId, mesa_id: c.mesa_id }));
    return { ok: true };
  });
}


// ---------- Exportação / importação de cardápio (JSON) ----------
export function exportarCardapio(db) {
  const categorias = db.prepare('SELECT id, nome, ordem, ativo FROM categorias ORDER BY ordem, nome').all();
  const produtos = db.prepare(
    `SELECT p.*, c.nome AS categoria_nome FROM produtos p JOIN categorias c ON c.id = p.categoria_id ORDER BY c.ordem, p.nome`
  ).all();
  for (const p of produtos) {
    p.variacoes = db.prepare('SELECT grupo, nome, delta_centavos, ativo FROM produto_variacoes WHERE produto_id = ? ORDER BY grupo, nome').all(p.id);
    p.ficha = db.prepare('SELECT ingrediente_id, quantidade_mil, perda_pct FROM produto_ingredientes WHERE produto_id = ?').all(p.id);
    p.periodo_ids = db.prepare('SELECT periodo_id FROM produto_periodos WHERE produto_id = ?').all(p.id).map((r) => r.periodo_id);
    p.adicional_ids = db.prepare('SELECT adicional_id FROM produto_adicionais WHERE produto_id = ?').all(p.id).map((r) => r.adicional_id);
  }
  const adicionais = db.prepare('SELECT id, nome, preco_centavos, ativo FROM adicionais ORDER BY nome').all();
  const combosRows = db.prepare(`SELECT * FROM combos ORDER BY nome`).all();
  for (const c of combosRows) {
    c.itens = db.prepare(
      `SELECT ci.produto_id, ci.quantidade, ci.obrigatorio, ci.grupo_escolha, ci.max_escolhas, p.nome AS produto_nome
       FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id WHERE ci.combo_id = ?`
    ).all(c.id);
  }
  const combos = combosRows;
  const periodos = db.prepare('SELECT * FROM periodos_cardapio ORDER BY nome').all();
  return {
    formato: 'lanchonete-pro-cardapio',
    versao: 1,
    exportado_em: agoraISO(),
    categorias, produtos, adicionais, combos, periodos,
  };
}

function exigirLista(v, campo, max = 5000) {
  if (!Array.isArray(v)) throw erro.validacao(`"${campo}" deve ser uma lista.`);
  if (v.length > max) throw erro.validacao(`"${campo}" excede ${max} itens.`);
  return v;
}

// Importa cardápio por chaves naturais (nomes). Cria o que não existe, atualiza o que existe.
// Faz backup automático do banco antes (motivo antes-importar-cardapio).
export function importarCardapio(db, usuario, dados, ip, backupFn = null) {
  const d = dados ?? {};
  if (d.formato !== 'lanchonete-pro-cardapio' || d.versao !== 1) {
    throw erro.validacao('Arquivo de cardápio inválido (formato/versão).');
  }
  const resumo = { categorias: 0, produtos_criados: 0, produtos_atualizados: 0, adicionais: 0, combos: 0, periodos: 0 };
  if (backupFn) {
    try { backupFn(db, { usuarioId: usuario.id, motivo: 'antes-importar-cardapio' }); } catch { /* backup não bloqueia */ }
  }
  return transacao(db, () => {
    const mapaCategorias = new Map(); // nome -> id
    for (const c of exigirLista(d.categorias, 'categorias', 200)) {
      const nome = texto(c?.nome, 'categoria.nome', { minimo: 1, maximo: 60 });
      let row = db.prepare('SELECT id FROM categorias WHERE nome = ?').get(nome);
      if (!row) {
        const info = db.prepare('INSERT INTO categorias (nome, ordem, ativo) VALUES (?, ?, ?)').run(nome, 0, 1);
        row = { id: Number(info.lastInsertRowid) };
        resumo.categorias++;
      }
      mapaCategorias.set(nome, row.id);
    }
    const mapaAdicionais = new Map();
    for (const a of exigirLista(d.adicionais ?? [], 'adicionais', 500)) {
      const nome = texto(a?.nome, 'adicional.nome', { minimo: 1, maximo: 60 });
      const preco = assertCentavos(a?.preco_centavos ?? 0, 'adicional.preco_centavos');
      let row = db.prepare('SELECT id FROM adicionais WHERE nome = ?').get(nome);
      if (!row) {
        const info = db.prepare('INSERT INTO adicionais (nome, preco_centavos, ativo) VALUES (?, ?, 1)').run(nome, preco);
        row = { id: Number(info.lastInsertRowid) };
        resumo.adicionais++;
      } else {
        db.prepare('UPDATE adicionais SET preco_centavos = ? WHERE id = ?').run(preco, row.id);
      }
      mapaAdicionais.set(nome, row.id);
    }
    const mapaPeriodos = new Map(); // id antigo -> id novo (por nome)
    for (const p of exigirLista(d.periodos ?? [], 'periodos', 100)) {
      const nome = texto(p?.nome, 'periodo.nome', { minimo: 1, maximo: 60 });
      let row = db.prepare('SELECT id FROM periodos_cardapio WHERE nome = ?').get(nome);
      if (!row) {
        const info = db.prepare('INSERT INTO periodos_cardapio (nome, dias, hora_ini, hora_fim, ativo) VALUES (?, ?, ?, ?, 1)')
          .run(nome, '0,1,2,3,4,5,6', '00:00', '23:59');
        row = { id: Number(info.lastInsertRowid) };
        resumo.periodos++;
      }
      if (p?.id !== undefined) mapaPeriodos.set(Number(p.id), row.id);
    }
    const mapaProdutos = new Map(); // id antigo -> id novo
    for (const p of exigirLista(d.produtos ?? [], 'produtos', 5000)) {
      const nome = texto(p?.nome, 'produto.nome', { minimo: 1, maximo: 80 });
      const catId = mapaCategorias.get(p?.categoria_nome) ?? null;
      if (!catId) throw erro.validacao(`Produto "${nome}": categoria "${p?.categoria_nome}" não está no arquivo.`);
      const preco = assertCentavos(p?.preco_centavos ?? 0, 'produto.preco_centavos');
      const tipo_item = TIPOS_ITEM.includes(p?.tipo_item) ? p.tipo_item : 'lanche';
      const existente = db.prepare('SELECT id FROM produtos WHERE nome = ? AND categoria_id = ?').get(nome, catId);
      let pid;
      if (existente) {
        pid = existente.id;
        db.prepare(`UPDATE produtos SET preco_centavos = ?, tipo_item = ?, area = ?, tempo_preparo_min = ?, ativo = ? WHERE id = ?`)
          .run(preco, tipo_item, ['cozinha', 'bar'].includes(p?.area) ? p.area : 'cozinha',
            p?.tempo_preparo_min ?? 10, p?.ativo === 0 ? 0 : 1, pid);
        resumo.produtos_atualizados++;
      } else {
        const info = db.prepare(
          `INSERT INTO produtos (nome, categoria_id, preco_centavos, custo_centavos, area, tempo_preparo_min, ativo,
            tipo_item, codigo_barras, apelidos, indisponivel_motivo, rendimento_porcoes, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(nome, catId, preco, p?.custo_centavos ?? null,
          ['cozinha', 'bar'].includes(p?.area) ? p.area : 'cozinha', p?.tempo_preparo_min ?? 10, p?.ativo === 0 ? 0 : 1,
          tipo_item, p?.codigo_barras ?? null, p?.apelidos ?? null, p?.indisponivel_motivo ?? null,
          p?.rendimento_porcoes ?? 1, agoraISO());
        pid = Number(info.lastInsertRowid);
        resumo.produtos_criados++;
      }
      if (p?.id !== undefined) mapaProdutos.set(Number(p.id), pid);
      // variações (substitui)
      db.prepare('DELETE FROM produto_variacoes WHERE produto_id = ?').run(pid);
      for (const v of (Array.isArray(p?.variacoes) ? p.variacoes.slice(0, 30) : [])) {
        db.prepare('INSERT INTO produto_variacoes (produto_id, grupo, nome, delta_centavos, ativo) VALUES (?, ?, ?, ?, ?)')
          .run(pid, String(v?.grupo ?? 'opcao').slice(0, 40), texto(v?.nome, 'variacao.nome', { minimo: 1, maximo: 60 }),
            assertInt(v?.delta_centavos ?? 0, 'variacao.delta', { minimo: -999999, maximo: 999999 }), v?.ativo === 0 ? 0 : 1);
      }
      // ficha (substitui; ignora ingredientes inexistentes? não — exige, para não corromper)
      if (Array.isArray(p?.ficha)) {
        db.prepare('DELETE FROM produto_ingredientes WHERE produto_id = ?').run(pid);
        for (const f of p.ficha.slice(0, 50)) {
          const ing = db.prepare('SELECT id FROM ingredientes WHERE id = ? AND ativo = 1').get(Number(f?.ingrediente_id));
          if (!ing) throw erro.validacao(`Ficha de "${nome}": ingrediente ${f?.ingrediente_id} inexistente. Importe o estoque antes ou ajuste o arquivo.`);
          db.prepare('INSERT INTO produto_ingredientes (produto_id, ingrediente_id, quantidade_mil, perda_pct) VALUES (?, ?, ?, ?)')
            .run(pid, ing.id, assertInt(f?.quantidade_mil, 'ficha.qtd', { minimo: 1 }), Number(f?.perda_pct ?? 0));
        }
      }
      // períodos (remapeia ids antigos)
      if (Array.isArray(p?.periodo_ids)) {
        db.prepare('DELETE FROM produto_periodos WHERE produto_id = ?').run(pid);
        for (const antigo of p.periodo_ids.slice(0, 20)) {
          const novoId = mapaPeriodos.get(Number(antigo)) ?? Number(antigo);
          const per = db.prepare('SELECT id FROM periodos_cardapio WHERE id = ?').get(novoId);
          if (per) db.prepare('INSERT OR IGNORE INTO produto_periodos (produto_id, periodo_id) VALUES (?, ?)').run(pid, novoId);
        }
      }
      // adicionais vinculados por id antigo→ disparam aviso se ausente; resolve por nome? usa ids do arquivo
      if (Array.isArray(p?.adicional_ids)) {
        db.prepare('DELETE FROM produto_adicionais WHERE produto_id = ?').run(pid);
        for (const aid of p.adicional_ids.slice(0, 50)) {
          const ad = db.prepare('SELECT id FROM adicionais WHERE id = ?').get(Number(aid));
          if (ad) db.prepare('INSERT OR IGNORE INTO produto_adicionais (produto_id, adicional_id) VALUES (?, ?)').run(pid, ad.id);
        }
      }
    }
    // combos (por nome; itens remapeados produto antigo->novo)
    for (const c of exigirLista(d.combos ?? [], 'combos', 500)) {
      const nome = texto(c?.nome, 'combo.nome', { minimo: 1, maximo: 80 });
      const existente = db.prepare('SELECT id FROM combos WHERE nome = ?').get(nome);
      const itens = (Array.isArray(c?.itens) ? c.itens : []).map((it) => ({
        produto_id: mapaProdutos.get(Number(it?.produto_id)) ?? Number(it?.produto_id),
        quantidade: it?.quantidade ?? 1, obrigatorio: it?.obrigatorio ?? 1,
        grupo_escolha: it?.grupo_escolha ?? null, max_escolhas: it?.max_escolhas ?? null,
      }));
      // valida produtos
      for (const it of itens) {
        if (!db.prepare('SELECT id FROM produtos WHERE id = ?').get(it.produto_id)) {
          throw erro.validacao(`Combo "${nome}": produto ${it.produto_id} inexistente.`);
        }
      }
      if (existente) {
        db.prepare('UPDATE combos SET ativo = ? WHERE id = ?').run(c?.ativo === 0 ? 0 : 1, existente.id);
        db.prepare('DELETE FROM combo_itens WHERE combo_id = ?').run(existente.id);
        for (const it of itens) {
          db.prepare('INSERT INTO combo_itens (combo_id, produto_id, quantidade, obrigatorio, grupo_escolha, max_escolhas) VALUES (?, ?, ?, ?, ?, ?)')
            .run(existente.id, it.produto_id, it.quantidade, it.obrigatorio, it.grupo_escolha, it.max_escolhas);
        }
      } else {
        const info = db.prepare(
          `INSERT INTO combos (nome, descricao, tipo, preco_fixo_centavos, desconto_percentual, leve_quantidade, pague_quantidade,
            brinde_produto_id, valido_de, valido_ate, ativo, exige_estoque, dias_semana, hora_ini, hora_fim, limite_usos, criado_em, criado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(nome, c?.descricao ?? null, c?.tipo ?? 'preco_fixo', c?.preco_fixo_centavos ?? null,
          c?.desconto_percentual ?? null, c?.leve_quantidade ?? null, c?.pague_quantidade ?? null,
          c?.brinde_produto_id ?? null, c?.valido_de ?? null, c?.valido_ate ?? null, c?.ativo === 0 ? 0 : 1,
          c?.exige_estoque === 0 ? 0 : 1, c?.dias_semana ?? '0,1,2,3,4,5,6', c?.hora_ini ?? null, c?.hora_fim ?? null,
          c?.limite_usos ?? null, agoraISO(), usuario.id);
        const cid = Number(info.lastInsertRowid);
        for (const it of itens) {
          db.prepare('INSERT INTO combo_itens (combo_id, produto_id, quantidade, obrigatorio, grupo_escolha, max_escolhas) VALUES (?, ?, ?, ?, ?, ?)')
            .run(cid, it.produto_id, it.quantidade, it.obrigatorio, it.grupo_escolha, it.max_escolhas);
        }
        resumo.combos++;
      }
    }
    registrar(db, { usuarioId: usuario.id, acao: 'cardapio_importado', detalhes: resumo, ip });
    return resumo;
  });
}
