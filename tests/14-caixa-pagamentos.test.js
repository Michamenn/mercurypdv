// Regressão de caixa/pagamentos: integridade do saldo, sangria e fechamento
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear } from './helpers.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PGT-001: desconto não pode derrubar o total abaixo do já pago', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // 2 batatas + 1 refri = 1500 + 600 = 2100
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }, { produto_id: s.produtos.refri.id, quantidade: 1 }] },
      { idem: 'pgt1-v' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 2000 }, { idem: 'pgt1-p1' });
    // desconto 1500 → total 600 < pago 2000: deve bloquear
    const ruim = await s.adminCli.post(`/pedidos/${v.corpo.id}/desconto`, { valor_centavos: 1500, motivo: 'queixa do cliente' });
    assert.equal(ruim.status, 409);
    assert.equal(ruim.corpo.codigo, '409_SALDO_PENDENTE');
    // desconto 100 → total 2000 = pago: permitido e fecha
    const bom = await s.adminCli.post(`/pedidos/${v.corpo.id}/desconto`, { valor_centavos: 100, motivo: 'cortesia' });
    assert.equal(bom.status, 200);
    assert.equal(bom.corpo.totais.total_centavos, 2000);
    assert.equal(bom.corpo.totais.saldo_centavos, 0);
    const fechar = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(fechar.status, 200);
  } finally { await sv.fechar(); }
});

test('PGT-002: combo não pode derrubar o total abaixo do já pago (rollback atômico)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }, { produto_id: s.produtos.refri.id, quantidade: 1 }] },
      { idem: 'pgt2-v' });
    const combo = await s.adminCli.post('/combos', {
      nome: 'Combo 50', tipo: 'desconto_percentual', desconto_percentual: 50, exige_estoque: 0,
      itens: [{ produto_id: s.produtos.batata.id, quantidade: 1, obrigatorio: 1 }],
    });
    assert.equal(combo.status, 201);
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 2000 }, { idem: 'pgt2-p1' });
    // 50% de 1500 = 750 → total 1350 < pago 2000: bloqueia e desfaz tudo
    const antes = sv.db.prepare('SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ?').get(v.corpo.id).n;
    const usosAntes = sv.db.prepare('SELECT usos FROM combos WHERE id = ?').get(combo.corpo.id).usos;
    const apl = await s.caixaCli.post(`/pedidos/${v.corpo.id}/aplicar-combo`,
      { combo_id: combo.corpo.id, escolhas: [], somente_desconto: true }, { idem: 'pgt2-c1' });
    assert.equal(apl.status, 409);
    assert.equal(apl.corpo.codigo, '409_SALDO_PENDENTE');
    const depois = sv.db.prepare('SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ?').get(v.corpo.id).n;
    assert.equal(depois, antes, 'nenhum item inserido (rollback)');
    assert.equal(sv.db.prepare('SELECT usos FROM combos WHERE id = ?').get(combo.corpo.id).usos, usosAntes, 'usos do combo não incrementados');
    const t = await s.caixaCli.get(`/pedidos/${v.corpo.id}`);
    assert.equal(t.corpo.totais.desconto_centavos, 0, 'desconto não alterado (rollback)');
    assert.equal(t.corpo.totais.saldo_centavos, 100, 'saldo preservado');
    // quita normalmente depois
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 100, recebido_centavos: 100 }, { idem: 'pgt2-p2' });
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
  } finally { await sv.fechar(); }
});

test('PGT-003: cancelamento de item não pode deixar o total abaixo do pago', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }, { produto_id: s.produtos.refri.id, quantidade: 1 }] },
      { idem: 'pgt3-v' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 2000 }, { idem: 'pgt3-p1' });
    const item = sv.db.prepare('SELECT id FROM pedido_itens WHERE pedido_id = ? AND produto_id = ?').get(v.corpo.id, s.produtos.batata.id);
    // cancelar batata (1500) → total 600 < pago 2000: bloqueia
    const ruim = await s.adminCli.post(`/pedidos/${v.corpo.id}/itens/${item.id}/cancelar`, { motivo: 'cliente desistiu' });
    assert.equal(ruim.status, 409);
    assert.equal(ruim.corpo.codigo, '409_SALDO_PENDENTE');
    const t = await s.caixaCli.get(`/pedidos/${v.corpo.id}`);
    assert.equal(t.corpo.totais.saldo_centavos, 100, 'saldo segue positivo');
    // pedido continua fechável
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 100 }, { idem: 'pgt3-p2' });
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
  } finally { await sv.fechar(); }
});

test('PGT-004: sangria considera o dinheiro de vendas (gaveta real)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 500 });
    // venda 1: refri 600 em dinheiro (recebido 1000, troco 400)
    const v1 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'pgt4-v1' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 600, recebido_centavos: 1000 }, { idem: 'pgt4-p1' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/fechar`, {});
    // venda 2 (aberta): refri 600 em dinheiro — também está na gaveta
    const v2 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'pgt4-v2' });
    await s.caixaCli.post(`/pedidos/${v2.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 600, recebido_centavos: 600 }, { idem: 'pgt4-p2' });
    // gaveta = 500 (fundo) + 600 + 600 = 1700
    const sangriaOk = await s.adminCli.post('/caixa/movimentar', { tipo: 'sangria', forma: 'dinheiro', valor_centavos: 1200, motivo: 'depósito no banco' });
    assert.equal(sangriaOk.status, 201, 'sangria até o valor das vendas é permitida');
    const acima = await s.adminCli.post('/caixa/movimentar', { tipo: 'sangria', forma: 'dinheiro', valor_centavos: 600, motivo: 'passou do limite' });
    assert.equal(acima.status, 422, 'sangria acima do disponível bloqueada');
    // conferência fecha com o esperado correto: 500 + 1200 vendas − 1200 sangria = 500
    const atual = await s.adminCli.get('/caixa/atual');
    assert.equal(atual.corpo.esperado.dinheiro, 500);
  } finally { await sv.fechar(); }
});

test('PGT-005: pedido 100% cortesia (total zero) fecha sem pagamento', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'pgt5-v' });
    const cortesia = await s.adminCli.post(`/pedidos/${v.corpo.id}/cortesia`, { produto_id: s.produtos.refri.id, quantidade: 1, motivo: 'cliente insatisfeito' });
    assert.equal(cortesia.status, 201);
    // cancela o item pago; sobra só a cortesia a preço zero → total 0, saldo 0
    const item = sv.db.prepare('SELECT id FROM pedido_itens WHERE pedido_id = ? AND produto_id = ? AND preco_unit_centavos > 0').get(v.corpo.id, s.produtos.refri.id);
    const canc = await s.adminCli.post(`/pedidos/${v.corpo.id}/itens/${item.id}/cancelar`, { motivo: 'cortesia total' });
    assert.equal(canc.status, 200);
    assert.equal(canc.corpo.total_centavos, 0);
    assert.equal(canc.corpo.saldo_centavos, 0);
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200, 'pedido total zero fecha (não fica preso em abertos)');
  } finally { await sv.fechar(); }
});

test('PGT-006: escapar() do frontend neutraliza HTML (XSS armazenado)', async () => {
  const ui = await import('../public/js/ui.js');
  const original = '<img src=x onerror="alert(1)"><script>alert(2)</script>&"\'';
  const seguro = ui.escapar(original);
  assert.ok(!seguro.includes('<img'), 'tag img neutralizada');
  assert.ok(!seguro.includes('<script'), 'tag script neutralizada');
  assert.ok(!seguro.includes('<'), 'nenhum < sobra no resultado');
  assert.ok(seguro.includes('&#60;'), 'usa entidade numérica');
});

test('PGT-007: reaisParaCentavos entende ponto e vírgula sem inflar 100×', async () => {
  const { reaisParaCentavos } = await import('../public/js/api.js');
  assert.equal(reaisParaCentavos('200.00'), 20000, '"200.00" é R$ 200,00 (não R$ 20.000,00)');
  assert.equal(reaisParaCentavos('12,34'), 1234);
  assert.equal(reaisParaCentavos('12.5'), 1250, 'decimal com 1 casa');
  assert.equal(reaisParaCentavos('1.234,56'), 123456);
  assert.equal(reaisParaCentavos('1,234.56'), 123456);
  assert.equal(reaisParaCentavos('1500'), 150000, 'inteiro é em reais');
  assert.equal(reaisParaCentavos('1.500'), 150000, 'grupo de 3 com ponto é milhar');
  assert.equal(reaisParaCentavos('200'), 20000);
  assert.equal(reaisParaCentavos('-50'), null, 'negativo é inválido');
  assert.equal(reaisParaCentavos('abc'), null);
});

test('PGT-008: frontend do PDV/caixa sem escapes no-op e com trava de duplo clique', () => {
  const ui = fs.readFileSync(path.join(raiz, 'public/js/ui.js'), 'utf8');
  assert.ok(!ui.includes("replace(/[&<>\"']/g, (c) => ({ '&': '&'"), 'escapar não é mais no-op');
  const pdv = fs.readFileSync(path.join(raiz, 'public/js/views/pdv.js'), 'utf8');
  assert.ok(pdv.includes('vendaEmAndamento'), 'PDV trava fluxo de venda contra duplo clique');
  assert.ok(pdv.includes('e.repeat'), 'atalhos ignoram auto-repeat de tecla');
  assert.ok(pdv.includes('aoCancelar'), 'recebido em dinheiro cancelável');
  assert.ok(!pdv.includes("resolve(valor); return; } resolve(r);"), 'recebido < valor não registra mais valor exato');
  const mesas = fs.readFileSync(path.join(raiz, 'public/js/views/mesas.js'), 'utf8');
  assert.ok(!mesas.includes("texto.replace(/</g, '<')"), 'conta da mesa escapa o texto');
  assert.ok(mesas.includes('recebido_centavos'), 'mesa registra troco em dinheiro');
  const recibo = fs.readFileSync(path.join(raiz, 'public/js/recibo.js'), 'utf8');
  assert.ok(!recibo.includes("texto.replace(/</g, '<')"), 'recibo escapa o texto');
  assert.ok(recibo.includes('aoFechar'), 'recibo suporta pós-fechamento (bloqueio pós-venda)');
});
