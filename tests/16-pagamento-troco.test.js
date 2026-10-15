// Regressão do troco seguro: misto Pix + dinheiro, troco não é receita, sem duplicidade
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear } from './helpers.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cenário do usuário: T = R$ 186,75; Pix R$ 50,00; dinheiro entregue R$ 200,00
// Esperado: saldo antes do dinheiro R$ 136,75; aplicado R$ 136,75; troco R$ 63,25;
// pago total R$ 186,75; saldo final R$ 0,00; caixa recebe R$ 136,75 em dinheiro (não R$ 200,00).
test('TROCO-001: misto Pix + dinheiro com troco — aplicado, troco e caixa corretos', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 10000 });
    const cesta = await s.adminCli.post('/produtos', {
      nome: 'Cesta Especial', categoria_id: (await s.adminCli.get('/catalogo')).corpo.categorias[0].id,
      preco_centavos: 18675, custo_centavos: 9000, area: 'cozinha', tempo_preparo_min: 15,
    });
    assert.equal(cesta.status, 201);

    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: cesta.corpo.id, quantidade: 1 }] }, { idem: 'tr1-v' });
    assert.equal(v.corpo.totais.total_centavos, 18675, 'T = R$ 186,75');

    // 1º pagamento: Pix R$ 50,00
    const pix = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 5000 }, { idem: 'tr1-pix' });
    assert.equal(pix.status, 201);
    assert.equal(pix.corpo.saldo_centavos, 13675, 'saldo antes do dinheiro = R$ 136,75');
    assert.equal(pix.corpo.pagamento.troco_centavos, 0, 'Pix nunca gera troco');

    // 2º pagamento: dinheiro entregue R$ 200,00 → aplicado R$ 136,75, troco R$ 63,25
    const din = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 13675, recebido_centavos: 20000 }, { idem: 'tr1-din' });
    assert.equal(din.status, 201);
    assert.equal(din.corpo.pagamento.valor_centavos, 13675, 'aplicado à venda = R$ 136,75');
    assert.equal(din.corpo.pagamento.recebido_centavos, 20000, 'entregue registrado à parte = R$ 200,00');
    assert.equal(din.corpo.pagamento.troco_centavos, 6325, 'troco = R$ 63,25');
    assert.equal(din.corpo.pago_centavos, 18675, 'P = R$ 186,75 (troco não é pagamento)');
    assert.equal(din.corpo.saldo_centavos, 0, 'saldo final = R$ 0,00 → quitada');

    // duplicidade: retransmissão da mesma Idempotency-Key não cria 2º pagamento
    const dup = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 13675, recebido_centavos: 20000 }, { idem: 'tr1-din' });
    assert.equal(dup.status, 201);
    assert.equal(dup.corpo.idempotente, true, 'retransmissão é idempotente');
    const n = sv.db.prepare('SELECT COUNT(*) AS n FROM pagamentos WHERE pedido_id = ?').get(v.corpo.id).n;
    assert.equal(n, 2, 'exatamente 2 pagamentos (pix + dinheiro), sem duplicar');

    const val = await s.caixaCli.get(`/pedidos/${v.corpo.id}/validacao`);
    assert.deepEqual(val.corpo.problemas, [], 'validação final sem problemas');
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200, 'venda quitada fecha');

    // conferência do caixa: troco NÃO é receita (esperado dinheiro = 10000 + 13675)
    const atual = await s.adminCli.get('/caixa/atual');
    assert.equal(atual.corpo.esperado.dinheiro, 23675, 'gaveta = fundo + aplicado (R$ 236,75), NÃO R$ 30.000');
    assert.equal(atual.corpo.esperado.pix, 5000, 'pix = R$ 50,00');
  } finally { await sv.fechar(); }
});

test('TROCO-002: pagamento acima do saldo pendente é bloqueado (saldo nunca negativo)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const cesta = await s.adminCli.post('/produtos', {
      nome: 'Cesta B', categoria_id: (await s.adminCli.get('/catalogo')).corpo.categorias[0].id,
      preco_centavos: 18675, custo_centavos: 9000,
    });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: cesta.corpo.id, quantidade: 1 }] }, { idem: 'tr2-v' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 5000 }, { idem: 'tr2-pix' });
    // tentativa de APLICAR R$ 136,76 (> saldo R$ 136,75) diretamente pela API
    const exc = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 13676, recebido_centavos: 20000 }, { idem: 'tr2-din' });
    assert.equal(exc.status, 409);
    assert.equal(exc.corpo.codigo, '409_VALOR_EXCEDIDO');
    const t = await s.caixaCli.get(`/pedidos/${v.corpo.id}`);
    assert.equal(t.corpo.totais.saldo_centavos, 13675, 'saldo intacto (R$ 136,75)');
    // quitado + tentativa de novo pagamento → bloqueado (sem cobrança duplicada)
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 13675, recebido_centavos: 13675 }, { idem: 'tr2-din2' });
    const depois = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 100 }, { idem: 'tr2-din3' });
    assert.equal(depois.status, 409, 'venda quitada não aceita pagamento adicional');
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
  } finally { await sv.fechar(); }
});

test('TROCO-003: recebido < aplicado e troco em forma eletrônica são rejeitados', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'tr3-v' });
    const menor = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 2500, recebido_centavos: 2000 }, { idem: 'tr3-a' });
    assert.equal(menor.status, 422, 'recebido menor que o aplicado é inválido');
    const trocoPix = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 2500, recebido_centavos: 3000 }, { idem: 'tr3-b' });
    assert.equal(trocoPix.status, 422, 'formas eletrônicas não aceitam recebido/troco');
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 2500 }, { idem: 'tr3-c' });
    assert.equal(ok.status, 201, 'pix normal sem recebido segue aceito');
  } finally { await sv.fechar(); }
});

test('TROCO-004: parcial em dinheiro sem troco + complemento quita a venda', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const cesta = await s.adminCli.post('/produtos', {
      nome: 'Cesta C', categoria_id: (await s.adminCli.get('/catalogo')).corpo.categorias[0].id,
      preco_centavos: 18675, custo_centavos: 9000,
    });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: cesta.corpo.id, quantidade: 1 }] }, { idem: 'tr4-v' });
    const parc = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 10000, recebido_centavos: 10000 }, { idem: 'tr4-a' });
    assert.equal(parc.status, 201);
    assert.equal(parc.corpo.pagamento.troco_centavos, 0, 'entregue = aplicado → sem troco');
    assert.equal(parc.corpo.saldo_centavos, 8675, 'restam R$ 86,75 (parcialmente paga)');
    const comp = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 8675 }, { idem: 'tr4-b' });
    assert.equal(comp.corpo.saldo_centavos, 0, 'complemento quita');
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
  } finally { await sv.fechar(); }
});

test('TROCO-005: três formas (pix + débito + dinheiro com troco) somam exatamente T', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const cesta = await s.adminCli.post('/produtos', {
      nome: 'Cesta D', categoria_id: (await s.adminCli.get('/catalogo')).corpo.categorias[0].id,
      preco_centavos: 18675, custo_centavos: 9000,
    });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: cesta.corpo.id, quantidade: 1 }] }, { idem: 'tr5-v' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 5000 }, { idem: 'tr5-a' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'cartao_debito', valor_centavos: 8675 }, { idem: 'tr5-b' });
    const din = await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 5000, recebido_centavos: 6000 }, { idem: 'tr5-c' });
    assert.equal(din.corpo.pagamento.troco_centavos, 1000, 'troco R$ 10,00');
    assert.equal(din.corpo.saldo_centavos, 0);
    assert.equal(din.corpo.pago_centavos, 18675, '5000 + 8675 + 5000 = T');
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
    const atual = await s.adminCli.get('/caixa/atual');
    assert.equal(atual.corpo.esperado.dinheiro, 5000, 'caixa conta só o aplicado');
    assert.equal(atual.corpo.esperado.pix, 5000);
    assert.equal(atual.corpo.esperado.cartao_debito, 8675);
  } finally { await sv.fechar(); }
});

test('TROCO-006: frontend usa fluxo de troco seguro (entregue → aplicado = min)', () => {
  const pdv = fs.readFileSync(path.join(raiz, 'public/js/views/pdv.js'), 'utf8');
  assert.ok(pdv.includes('Dinheiro entregue pelo cliente'), 'PDV pergunta o valor entregue');
  assert.ok(pdv.includes('Math.min(entregue, pendente)'), 'aplicado = min(entregue, saldo)');
  assert.ok(pdv.includes('Troco devido:'), 'confirmação exibe o troco antes de lançar');
  assert.ok(pdv.includes("formaPag === 'dinheiro'\n          ? { forma: formaPag, valor_centavos: valor, recebido_centavos: recebido }"), 'recebido só vai no corpo p/ dinheiro');
  const mesas = fs.readFileSync(path.join(raiz, 'public/js/views/mesas.js'), 'utf8');
  assert.ok(mesas.includes('Dinheiro entregue'), 'Mesas usa o campo como entregue');
  assert.ok(mesas.includes('Math.min(digitado, t.saldo_centavos)'), 'Mesas limita o aplicado ao saldo');
  const server = fs.readFileSync(path.join(raiz, 'server/src/services/pedidosService.js'), 'utf8');
  assert.ok(server.includes("recebido_centavos só é aceito em pagamentos em dinheiro"), 'servidor rejeita recebido em forma eletrônica');
});
