import fs from 'node:fs';
import path from 'node:path';
import nodeCrypto from 'node:crypto';
import { ROOT } from '../config.js';
import { transacao, agoraISO } from '../db/connection.js';
import { registrar } from '../core/audit.js';
import { erro } from '../core/errors.js';

// Compra Mensal: conta corrente de clientes da casa (débito de consumo no local).
// - Cliente: código CM-NNNN automático; só o NOME é obrigatório (telefone,
//   e-mail, endereço e limite são opcionais, como pedido).
// - Lançamento: quantidade, consumo, data/hora, valor e assinatura digital
//   (PNG colhido no celular, validado por magic bytes, servido em /uploads).
// - Pagamento: quitação total ou parcial; parcelamento cria acordo com N
//   parcelas programadas (status 'pendente') que viram 'pago' ao dar baixa.
// - Saldo devedor = débitos − pagamentos efetuados.

const FORMAS = new Set(['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao']);
const LIMITE_ASSINATURA_BYTES = 200 * 1024;
const REGEX_DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function clientePorId(db, id) {
  const c = db.prepare('SELECT * FROM clientes_mensal WHERE id = ?').get(Number(id));
  if (!c) throw erro.naoEncontrado('Cliente não encontrado.');
  return c;
}

function resumo(db, cliente) {
  const debito = db.prepare('SELECT COALESCE(SUM(valor_centavos),0) AS v FROM mensal_lancamentos WHERE cliente_id = ?').get(cliente.id).v;
  const pago = db.prepare("SELECT COALESCE(SUM(valor_centavos),0) AS v FROM mensal_pagamentos WHERE cliente_id = ? AND status = 'pago'").get(cliente.id).v;
  const aReceber = db.prepare("SELECT COALESCE(SUM(valor_centavos),0) AS v FROM mensal_pagamentos WHERE cliente_id = ? AND status = 'pendente'").get(cliente.id).v;
  return { debito_centavos: debito, pago_centavos: pago, saldo_centavos: debito - pago, a_receber_centavos: aReceber };
}

function limiteComoCentavos(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw erro.validacao('Limite inválido (em centavos).');
  return n;
}

// Assinatura em data URL -> arquivo em public/uploads (padrão do upload de logo:
// valida magic bytes, nunca confia na extensão).
function salvarAssinatura(dataUrl) {
  if (!dataUrl) return '';
  const m = String(dataUrl).match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw erro.validacao('Assinatura deve ser um PNG em data URL base64.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length === 0 || buf.length > LIMITE_ASSINATURA_BYTES) throw erro.validacao('Assinatura deve ter até 200 KB.');
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)) {
    throw erro.validacao('Conteúdo da assinatura não é um PNG válido.');
  }
  const dir = path.join(ROOT, 'public', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const nome = `uploads/assinatura-${nodeCrypto.randomBytes(8).toString('hex')}.png`;
  fs.writeFileSync(path.join(ROOT, 'public', nome), buf);
  return nome;
}

function normalizarDataHora(valor) {
  if (!valor) return agoraISO();
  const s = String(valor).trim();
  if (!REGEX_DATA_HORA.test(s)) throw erro.validacao('Data/hora deve vir como AAAA-MM-DDTHH:MM (local).');
  return s.length === 16 ? `${s}:00` : s;
}

export function criarCliente(db, usuario, dados, ip) {
  const nome = String(dados?.nome ?? '').trim();
  if (!nome) throw erro.validacao('Informe ao menos o nome do cliente.');
  if (nome.length > 120) throw erro.validacao('Nome muito longo (máx. 120 caracteres).');
  const telefone = String(dados?.telefone ?? '').slice(0, 40);
  const email = String(dados?.email ?? '').slice(0, 120);
  const endereco = String(dados?.endereco ?? '').slice(0, 200);
  const limite = limiteComoCentavos(dados?.limite_centavos);
  return transacao(db, () => {
    const proximo = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM clientes_mensal').get().n + 1;
    const codigo = `CM-${String(proximo).padStart(4, '0')}`;
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO clientes_mensal (codigo, nome, telefone, email, endereco, limite_centavos, bloqueado, criado_por, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(codigo, nome, telefone, email, endereco, limite, usuario.id, agora);
    const c = db.prepare('SELECT * FROM clientes_mensal WHERE id = ?').get(Number(info.lastInsertRowid));
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_cliente_criado', entidade: 'clientes_mensal', entidadeId: c.id, detalhes: { codigo, nome }, ip });
    return { ...c, ...resumo(db, c) };
  });
}

export function listarClientes(db, busca) {
  const termo = String(busca ?? '').trim().slice(0, 60);
  const like = `%${termo}%`;
  const rows = termo
    ? db.prepare('SELECT * FROM clientes_mensal WHERE nome LIKE ? OR telefone LIKE ? OR codigo LIKE ? ORDER BY nome LIMIT 100').all(like, like, like)
    : db.prepare('SELECT * FROM clientes_mensal ORDER BY nome LIMIT 100').all();
  return { clientes: rows.map((c) => ({ ...c, ...resumo(db, c) })) };
}

export function obterCliente(db, id) {
  const c = clientePorId(db, id);
  const lancamentos = db.prepare('SELECT * FROM mensal_lancamentos WHERE cliente_id = ? ORDER BY id DESC LIMIT 200').all(c.id);
  const pagamentos = db.prepare('SELECT * FROM mensal_pagamentos WHERE cliente_id = ? ORDER BY id DESC LIMIT 200').all(c.id);
  return { cliente: { ...c, ...resumo(db, c) }, lancamentos, pagamentos };
}

export function atualizarCliente(db, usuario, id, dados, ip) {
  const c = clientePorId(db, id);
  const nome = String(dados?.nome ?? c.nome).trim();
  if (!nome) throw erro.validacao('Nome não pode ficar vazio.');
  const limite = dados?.limite_centavos === undefined ? c.limite_centavos : limiteComoCentavos(dados?.limite_centavos);
  return transacao(db, () => {
    db.prepare(
      'UPDATE clientes_mensal SET nome = ?, telefone = ?, email = ?, endereco = ?, limite_centavos = ?, atualizado_em = ? WHERE id = ?'
    ).run(
      nome.slice(0, 120),
      String(dados?.telefone ?? c.telefone ?? '').slice(0, 40),
      String(dados?.email ?? c.email ?? '').slice(0, 120),
      String(dados?.endereco ?? c.endereco ?? '').slice(0, 200),
      limite, agoraISO(), c.id
    );
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_cliente_editado', entidade: 'clientes_mensal', entidadeId: c.id, detalhes: { nome }, ip });
    return obterCliente(db, c.id);
  });
}

export function definirBloqueio(db, usuario, id, bloquear, ip) {
  const c = clientePorId(db, id);
  const alvo = bloquear ? 1 : 0;
  return transacao(db, () => {
    db.prepare('UPDATE clientes_mensal SET bloqueado = ?, atualizado_em = ? WHERE id = ?').run(alvo, agoraISO(), c.id);
    registrar(db, { usuarioId: usuario.id, acao: alvo ? 'mensal_cliente_bloqueado' : 'mensal_cliente_desbloqueado', entidade: 'clientes_mensal', entidadeId: c.id, detalhes: { nome: c.nome }, ip });
    return obterCliente(db, c.id);
  });
}

export function lancarDebito(db, usuario, id, dados, ip) {
  const c = clientePorId(db, id);
  if (c.bloqueado) throw erro.conflito('409_CLIENTE_BLOQUEADO', 'Cliente bloqueado — não aceita novos débitos. Desbloqueie para lançar.');
  const quantidade = Number(dados?.quantidade ?? 1);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 999) throw erro.validacao('Quantidade deve ser entre 1 e 999.');
  const consumo = String(dados?.consumo ?? '').trim();
  if (!consumo) throw erro.validacao('Descreva o consumo (ex.: "Almoço — prato feito").');
  const valor = Number(dados?.valor_centavos);
  if (!Number.isInteger(valor) || valor < 0 || valor > 100_000_000) throw erro.validacao('Valor do lançamento inválido.');
  const dataHora = normalizarDataHora(dados?.data_hora);
  const limite = c.limite_centavos;
  const assinaturaPath = salvarAssinatura(dados?.assinatura_data_url);
  return transacao(db, () => {
    const r = resumo(db, c);
    if (limite !== null && r.saldo_centavos + valor > limite) {
      throw erro.conflito('409_LIMITE_ESTOURADO', `Lançamento recusado: ultrapassa o limite do cliente (saldo ${r.saldo_centavos} + ${valor} > limite ${limite} centavos).`);
    }
    const info = db.prepare(
      `INSERT INTO mensal_lancamentos (cliente_id, quantidade, consumo, data_hora, valor_centavos, assinatura_path, criado_por, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.id, quantidade, consumo.slice(0, 200), dataHora, valor, assinaturaPath, usuario.id, agoraISO());
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_debito_lancado', entidade: 'mensal_lancamentos', entidadeId: Number(info.lastInsertRowid), detalhes: { cliente: c.codigo, consumo: consumo.slice(0, 100), valor_centavos: valor, assinado: Boolean(assinaturaPath) }, ip });
    return obterCliente(db, c.id);
  });
}

export function registrarPagamento(db, usuario, id, dados, ip) {
  const c = clientePorId(db, id);
  const valor = Number(dados?.valor_centavos);
  if (!Number.isInteger(valor) || valor <= 0 || valor > 100_000_000) throw erro.validacao('Valor do pagamento inválido.');
  const forma = String(dados?.forma ?? '');
  if (!FORMAS.has(forma)) throw erro.validacao('Forma de pagamento inválida.');
  return transacao(db, () => {
    const r = resumo(db, c);
    if (r.saldo_centavos <= 0) throw erro.conflito('409_SEM_SALDO', 'Cliente sem saldo devedor — nada a quitar.');
    if (valor > r.saldo_centavos) throw erro.validacao(`Valor maior que a dívida (saldo: ${(r.saldo_centavos / 100).toFixed(2).replace('.', ',')}).`);
    const info = db.prepare(
      `INSERT INTO mensal_pagamentos (cliente_id, valor_centavos, forma, status, pago_em, criado_por, criado_em)
       VALUES (?, ?, ?, 'pago', ?, ?, ?)`
    ).run(c.id, valor, forma, agoraISO(), usuario.id, agoraISO());
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_pagamento', entidade: 'mensal_pagamentos', entidadeId: Number(info.lastInsertRowid), detalhes: { cliente: c.codigo, forma, valor_centavos: valor }, ip });
    return obterCliente(db, c.id);
  });
}

export function parcelarSaldo(db, usuario, id, dados, ip) {
  const c = clientePorId(db, id);
  const n = Number(dados?.n);
  if (!Number.isInteger(n) || n < 2 || n > 24) throw erro.validacao('Número de parcelas deve ser entre 2 e 24.');
  const hoje = new Date();
  const base = String(dados?.primeira_vencimento ?? '').trim() || hoje.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) throw erro.validacao('Primeiro vencimento deve ser AAAA-MM-DD.');
  return transacao(db, () => {
    const r = resumo(db, c);
    if (r.saldo_centavos <= 0) throw erro.conflito('409_SEM_SALDO', 'Cliente sem saldo devedor para parcelar.');
    const valorBase = Math.floor(r.saldo_centavos / n);
    let primeira = null;
    const dt = new Date(`${base}T12:00:00`);
    for (let i = 0; i < n; i++) {
      const venc = new Date(dt.getTime() + i * 30 * 24 * 3600_000).toISOString().slice(0, 10);
      const valor = i === n - 1 ? r.saldo_centavos - valorBase * (n - 1) : valorBase;
      const info = db.prepare(
        `INSERT INTO mensal_pagamentos (cliente_id, valor_centavos, forma, status, vencimento, parcela_de, criado_por, criado_em)
         VALUES (?, ?, 'dinheiro', 'pendente', ?, ?, ?, ?)`
      ).run(c.id, valor, venc, primeira, usuario.id, agoraISO());
      if (i === 0) primeira = Number(info.lastInsertRowid);
    }
    if (primeira) db.prepare('UPDATE mensal_pagamentos SET parcela_de = ? WHERE id = ?').run(primeira, primeira);
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_parcelado', entidade: 'mensal_pagamentos', entidadeId: primeira, detalhes: { cliente: c.codigo, parcelas: n, saldo_centavos: r.saldo_centavos, primeira_vencimento: base }, ip });
    return obterCliente(db, c.id);
  });
}

export function confirmarParcela(db, usuario, pagamentoId, ip) {
  const p = db.prepare('SELECT * FROM mensal_pagamentos WHERE id = ?').get(Number(pagamentoId));
  if (!p) throw erro.naoEncontrado('Parcela não encontrada.');
  if (p.status !== 'pendente') throw erro.conflito('409_PARCELA_PAGA', 'Parcela já foi quitada.');
  return transacao(db, () => {
    db.prepare("UPDATE mensal_pagamentos SET status = 'pago', pago_em = ? WHERE id = ?").run(agoraISO(), p.id);
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_parcela_paga', entidade: 'mensal_pagamentos', entidadeId: p.id, detalhes: { cliente_id: p.cliente_id, valor_centavos: p.valor_centavos, vencimento: p.vencimento }, ip });
    return obterCliente(db, p.cliente_id);
  });
}

export function excluirCliente(db, usuario, id, ip) {
  const c = clientePorId(db, id);
  return transacao(db, () => {
    const assinaturas = db.prepare("SELECT assinatura_path FROM mensal_lancamentos WHERE cliente_id = ? AND assinatura_path != ''").all(c.id);
    const totais = {
      lancamentos: db.prepare('SELECT COUNT(*) AS n FROM mensal_lancamentos WHERE cliente_id = ?').get(c.id).n,
      pagamentos: db.prepare('SELECT COUNT(*) AS n FROM mensal_pagamentos WHERE cliente_id = ?').get(c.id).n,
    };
    registrar(db, { usuarioId: usuario.id, acao: 'mensal_cliente_excluido', entidade: 'clientes_mensal', entidadeId: c.id, detalhes: { codigo: c.codigo, nome: c.nome, ...totais }, ip });
    db.prepare('DELETE FROM mensal_pagamentos WHERE cliente_id = ?').run(c.id);
    db.prepare('DELETE FROM mensal_lancamentos WHERE cliente_id = ?').run(c.id);
    db.prepare('DELETE FROM clientes_mensal WHERE id = ?').run(c.id);
    for (const a of assinaturas) {
      try { fs.rmSync(path.join(ROOT, 'public', a.assinatura_path), { force: true }); } catch { /* arquivo já foi */ }
    }
    return { id: c.id, codigo: c.codigo, nome: c.nome, ...totais };
  });
}
