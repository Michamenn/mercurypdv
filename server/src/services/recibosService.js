import { erro } from '../core/errors.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';
import { obterTodas as obterConfig } from './configService.js';

// Recibos NÃO FISCAIS de conferência (BR-002). Nada aqui tem valor fiscal.
export function emitirReciboCliente(db, usuario, pedidoId, larguraMm, ip) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  if (pedido.status !== 'fechado') throw erro.conflito('409_CONFLITO_ESTADO', 'Recibo de cliente só é emitido para pedido fechado (pago).');
  const largura = [58, 80].includes(Number(larguraMm)) ? Number(larguraMm) : null;
  if (!largura) throw erro.validacao('Largura deve ser 58 ou 80 mm.');

  const config = obterConfig(db);
  const proximo = (db.prepare('SELECT COALESCE(MAX(numero), 1000) AS n FROM recibos WHERE tipo = ?').get('cliente').n) + 1;
  const itens = db.prepare(
    `SELECT i.nome_produto, i.quantidade, i.preco_unit_centavos, i.status,
            COALESCE((SELECT SUM(a.preco_centavos*a.quantidade) FROM pedido_item_adicionais a WHERE a.item_id = i.id),0) AS adicionais_centavos,
            COALESCE((SELECT GROUP_CONCAT(a.nome, ', ') FROM pedido_item_adicionais a WHERE a.item_id = i.id), '') AS adicionais_nomes
     FROM pedido_itens i WHERE i.pedido_id = ? ORDER BY i.id`
  ).all(pedidoId);
  const pagamentos = db.prepare(
    'SELECT forma, valor_centavos, troco_centavos FROM pagamentos WHERE pedido_id = ? AND estornado = 0 ORDER BY id'
  ).all(pedidoId);
  const gorjeta = db.prepare(
    'SELECT COALESCE(SUM(valor_centavos),0) AS g FROM gorjetas WHERE pedido_id = ? AND estornado = 0'
  ).get(pedidoId).g;
  const totais = {
    bruto: itens.filter((i) => i.status === 'ativo')
      .reduce((s, i) => s + (i.preco_unit_centavos + i.adicionais_centavos) * i.quantidade, 0),
    desconto: pedido.desconto_centavos,
    taxa_servico_centavos: pedido.taxa_servico_centavos ?? 0,
    total: pedido.total_fechado_centavos,
    // Gorjeta é extra pago pelo cliente sobre a conta: entra como informação,
    // nunca como parte do total da venda.
    gorjeta_centavos: gorjeta,
    troco: pagamentos.reduce((s, p) => s + p.troco_centavos, 0),
  };
  const conteudo = {
    documento: 'RECIBO NAO FISCAL DE CONFERENCIA',
    empresa: {
      nome: config.empresa_nome, cnpj: config.empresa_cnpj,
      telefone: config.empresa_telefone, endereco: config.empresa_endereco,
    },
    pedido_id: pedidoId,
    numero: proximo,
    data_hora: agoraISO(),
    largura_mm: largura,
    nomenclatura: config.nomenclatura_pedido === 'comanda' ? 'comanda' : 'mesa',
    comanda_nome: pedido.comanda_nome,
    itens: itens.filter((i) => i.status === 'ativo').map((i) => ({
      nome: i.nome_produto + (i.adicionais_nomes ? ` (+ ${i.adicionais_nomes})` : ''),
      quantidade: i.quantidade,
      unitario_centavos: i.preco_unit_centavos + i.adicionais_centavos,
      total_centavos: (i.preco_unit_centavos + i.adicionais_centavos) * i.quantidade,
    })),
    totais,
    // BR-001 (regra original): o recibo declara ausência de taxa de serviço.
    // Com a taxa agora configurável (migração 010), o campo reflete a REALIDADE:
    // verdadeiro quando não há taxa cobrada, falso quando há valor na conta.
    sem_taxa_servico: (pedido.taxa_servico_centavos ?? 0) === 0,
    pagamentos,
    cabecalho: config.recibo_cabecalho,
    rodape: config.recibo_rodape,
    // Padrão de impressão gravado NO momento da emissão (reimpressão fiel).
    logo_path: config.logo_path || '',
    impressao: {
      margem_sup_mm: Number(config.recibo_margem_sup_mm) || 0,
      margem_inf_mm: Number(config.recibo_margem_inf_mm) || 0,
      extensao_mm: Number(config.recibo_extensao_mm) || 0,
      logo_imprimir: config.recibo_logo_imprimir ?? '0',
      logo_modo: config.recibo_logo_modo ?? 'mono',
      logo_brilho: Number(config.recibo_logo_brilho) || 0,
      logo_contraste: Number(config.recibo_logo_contraste) || 0,
      logo_bordas: config.recibo_logo_bordas ?? '0',
    },
  };

  return transacao(db, () => {
    const info = db.prepare(
      `INSERT INTO recibos (pedido_id, numero, tipo, largura_mm, conteudo_json, emitido_por, emitido_em)
       VALUES (?, ?, 'cliente', ?, ?, ?, ?)`
    ).run(pedidoId, proximo, largura, JSON.stringify(conteudo), usuario.id, agoraISO());
    registrar(db, {
      usuarioId: usuario.id, acao: 'recibo_emitido', entidade: 'recibo', entidadeId: Number(info.lastInsertRowid),
      detalhes: { pedido_id: pedidoId, numero: proximo, largura_mm: largura }, ip,
    });
    return { id: Number(info.lastInsertRowid), numero: proximo, conteudo };
  });
}

// Reimpressão controlada: recupera conteúdo já emitido e registra o evento.
export function reimprimir(db, usuario, reciboId, ip) {
  const r = db.prepare('SELECT * FROM recibos WHERE id = ?').get(reciboId);
  if (!r) throw erro.naoEncontrado('Recibo não encontrado.');
  registrar(db, {
    usuarioId: usuario.id, acao: 'recibo_reimpresso', entidade: 'recibo', entidadeId: reciboId,
    detalhes: { pedido_id: r.pedido_id, numero: r.numero }, ip,
  });
  return { id: r.id, numero: r.numero, conteudo: JSON.parse(r.conteudo_json) };
}

export function listarRecibos(db, pedidoId) {
  return db.prepare(
    `SELECT id, numero, tipo, largura_mm, emitido_em FROM recibos WHERE pedido_id = ? ORDER BY id`
  ).all(pedidoId);
}

// Ticket operacional da cozinha (não fiscal, para expedição).
export function ticketCozinha(db, usuario, pedidoId, ip) {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) throw erro.naoEncontrado('Pedido não encontrado.');
  const itens = db.prepare(
    `SELECT nome_produto, quantidade, observacoes,
            COALESCE((SELECT GROUP_CONCAT(a.nome || ' x' || a.quantidade, ', ') FROM pedido_item_adicionais a WHERE a.item_id = i.id), '') AS adicionais
     FROM pedido_itens i WHERE i.pedido_id = ? AND i.status = 'ativo' AND enviado_cozinha_em IS NOT NULL ORDER BY i.id`
  ).all(pedidoId);
  const mesa = pedido.mesa_id ? db.prepare('SELECT numero FROM mesas WHERE id = ?').get(pedido.mesa_id)?.numero : null;
  const conteudo = {
    documento: 'TICKET OPERACIONAL - COZINHA',
    pedido_id: pedidoId,
    mesa: mesa,
    comanda: pedido.comanda_nome,
    data_hora: agoraISO(),
    itens,
    largura_mm: 80,
  };
  registrar(db, { usuarioId: usuario.id, acao: 'ticket_cozinha_emitido', entidade: 'pedido', entidadeId: pedidoId, ip });
  return { conteudo };
}
