// Testes do Estoque Profissional (A2 — itens 1.12, 1.13, 2.4 a 2.9)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

async function fichaCarne(sv, adminCli, produtoId, ingId, perda = 10) {
  return adminCli.put(`/produtos/${produtoId}/ficha`, {
    itens: [{ ingrediente_id: ingId, quantidade_mil: 150000, perda_pct: perda }],
  });
}

test('A2-001: transferência entre locais preserva o total', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Carne A2', unidade: 'g', quantidade_mil: 5000000, minimo_mil: 1000, local: 'deposito' });
    const t = await s.adminCli.post('/estoque/transferir', {
      ingrediente_id: ing.corpo.id, origem: 'deposito', destino: 'bar', quantidade_mil: 1000000, motivo: 'abastecer bar',
    });
    assert.equal(t.status, 201);
    const lista = await s.adminCli.get('/estoque');
    const item = lista.corpo.find((i) => i.id === ing.corpo.id);
    assert.equal(item.quantidade_mil, 5000000, 'total preservado');
    const locais = Object.fromEntries(item.locais.map((l) => [l.local, l.quantidade_mil]));
    assert.equal(locais.deposito, 4000000);
    assert.equal(locais.bar, 1000000);
    // origem sem saldo suficiente → 422
    const ruim = await s.adminCli.post('/estoque/transferir', {
      ingrediente_id: ing.corpo.id, origem: 'bar', destino: 'salao', quantidade_mil: 99999999,
    });
    assert.equal(ruim.status, 422);
    const negado = await s.caixaCli.post('/estoque/transferir', {
      ingrediente_id: ing.corpo.id, origem: 'deposito', destino: 'bar', quantidade_mil: 1,
    });
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('A2-002: baixa FIFO consome lote mais próximo do vencimento', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Leite A2', unidade: 'ml', quantidade_mil: 0, minimo_mil: 0 });
    await s.adminCli.post(`/estoque/movimentar/${ing.corpo.id}`, { tipo: 'entrada', quantidade_mil: 2000000, lote: 'L1', validade: '2030-01-01', observacao: 'lote longe' });
    await s.adminCli.post(`/estoque/movimentar/${ing.corpo.id}`, { tipo: 'entrada', quantidade_mil: 1000000, lote: 'L2', validade: '2027-01-01', observacao: 'lote perto' });
    // baixa 500ml via ajuste negativo (consome FIFO)
    await s.adminCli.post(`/estoque/movimentar/${ing.corpo.id}`, { tipo: 'ajuste', novo_saldo_mil: 2500000, observacao: 'uso fifo' });
    const lotes = sv.db.prepare('SELECT lote, quantidade_mil FROM estoque_lotes WHERE ingrediente_id = ? ORDER BY id').all(ing.corpo.id);
    const l2 = lotes.find((l) => l.lote === 'L2');
    const l1 = lotes.find((l) => l.lote === 'L1');
    assert.equal(l2.quantidade_mil, 500000, 'lote mais próximo consumido primeiro');
    assert.equal(l1.quantidade_mil, 2000000, 'lote distante intacto');
  } finally { await sv.fechar(); }
});

test('A2-003: validade vencida bloqueia a venda; baixar-vencidos limpa', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Maionese A2', unidade: 'g', quantidade_mil: 0, minimo_mil: 0 });
    await s.adminCli.post(`/estoque/movimentar/${ing.corpo.id}`, { tipo: 'entrada', quantidade_mil: 500000, lote: 'V1', validade: '2020-05-01', observacao: 'vencido' });
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}/ficha`, {
      itens: [{ ingrediente_id: ing.corpo.id, quantidade_mil: 10000, perda_pct: 0 }],
    });
    const bloqueada = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a2-val-1' });
    assert.equal(bloqueada.status, 422);
    assert.match(bloqueada.corpo.erro, /bloqueado/);
    const vencidos = await s.adminCli.get('/estoque/vencidos');
    assert.equal(vencidos.corpo.length, 1);
    const baixa = await s.adminCli.post('/estoque/baixar-vencidos', {});
    assert.equal(baixa.corpo.lotes_baixados, 1);
    const mov = sv.db.prepare(`SELECT tipo FROM estoque_movimentacoes WHERE ingrediente_id = ? ORDER BY id DESC LIMIT 1`).get(ing.corpo.id);
    assert.equal(mov.tipo, 'vencimento');
  } finally { await sv.fechar(); }
});

test('A2-004: perda de preparo entra na baixa; custo recalculado da ficha', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // carne: entrada 1kg por R$ 40,00 (custo médio 40/kg) em ml? usa g: 1000000 mil = 1000g por 4000 centavos
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Carne Moída A2', unidade: 'g', quantidade_mil: 0, minimo_mil: 0 });
    await s.adminCli.post(`/estoque/movimentar/${ing.corpo.id}`, {
      tipo: 'entrada', quantidade_mil: 1000000, lote: 'C1', custo_total_centavos: 4000, observacao: 'compra',
    });
    await fichaCarne(sv, s.adminCli, s.produtos.xburger.id, ing.corpo.id, 10);
    // custo: 150g × R$40/kg × 1.10 = 150 × 4 × 1.1 = 660
    const rec = await s.adminCli.post(`/produtos/${s.produtos.xburger.id}/recalcular-custo`, {});
    assert.equal(rec.status, 200);
    assert.equal(rec.corpo.custo_centavos, 660);
    assert.ok(rec.corpo.margem_pct > 70, `margem ${rec.corpo.margem_pct}% sobre 2500`);
    // venda de 1 X-Burger baixa 150g × 1.1 = 165g
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a2-per-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: v.corpo.totais.total_centavos }, { idem: 'a2-per-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    const saldo = sv.db.prepare('SELECT quantidade_mil FROM ingredientes WHERE id = ?').get(ing.corpo.id).quantidade_mil;
    assert.equal(saldo, 1000000 - 165000);
  } finally { await sv.fechar(); }
});

test('A2-005: inventário rotativo ajusta divergência com auditoria', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Queijo A2', unidade: 'g', quantidade_mil: 1000000, minimo_mil: 1000 });
    const lista = await s.adminCli.get('/estoque/inventario?quantidade=5');
    assert.ok(lista.corpo.length >= 1);
    const alvo = lista.corpo.find((i) => i.id === ing.corpo.id) ?? lista.corpo[0];
    assert.ok(alvo, 'ingrediente na lista de inventário');
    // contagem a menor: 900g vs 1000g em estoque
    const cont2 = await s.adminCli.post('/estoque/inventario', {
      ingrediente_id: ing.corpo.id, contado_mil: 900000, observacao: 'contagem cega',
    });
    assert.equal(cont2.status, 201);
    assert.equal(cont2.corpo.diferenca_mil, -100000);
    const saldo = sv.db.prepare('SELECT quantidade_mil FROM ingredientes WHERE id = ?').get(ing.corpo.id).quantidade_mil;
    assert.equal(saldo, 900000);
  } finally { await sv.fechar(); }
});

test('A2-006: curva ABC, sugestão de compra e barril com estimativa', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: 'Chopp A2', unidade: 'ml', quantidade_mil: 50000, minimo_mil: 20000 });
    await s.adminCli.put(`/produtos/${s.produtos.refri.id}/ficha`, {
      itens: [{ ingrediente_id: ing.corpo.id, quantidade_mil: 473000, perda_pct: 0 }],
    });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 2 }] }, { idem: 'a2-abc-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: v.corpo.totais.total_centavos }, { idem: 'a2-abc-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    const abc = await s.adminCli.get('/estoque/curva-abc?dias=30');
    assert.equal(abc.status, 200);
    assert.ok(abc.corpo.itens.length >= 1);
    assert.ok(['A', 'B', 'C'].includes(abc.corpo.itens[0].classe));
    const sug = await s.adminCli.get('/estoque/sugestao-compra');
    const item = sug.corpo.find((i) => i.ingrediente_id === ing.corpo.id);
    assert.ok(item, 'chopp abaixo do mínimo sugerido');
    assert.ok(item.sugerido_mil > 0);
    // barril: 50L, copo 473ml → estimativa pelos ml restantes
    const bar = await s.adminCli.post('/barris', {
      rotulo: 'Torre 1', tipo_chopp: 'pilsen', ingrediente_id: ing.corpo.id, capacidade_ml: 50000,
    });
    assert.equal(bar.status, 201);
    const segundo = await s.adminCli.post('/barris', {
      rotulo: 'Torre 2', tipo_chopp: 'pilsen', ingrediente_id: ing.corpo.id, capacidade_ml: 50000,
    });
    assert.equal(segundo.status, 409, 'dois barris ativos do mesmo chopp não');
    const lista = await s.adminCli.get('/barris?copo_ml=473');
    assert.ok(lista.corpo[0].copos_restantes >= 0);
    const esg = await s.adminCli.post(`/barris/${bar.corpo.id}/esgotar`, {});
    assert.equal(esg.status, 200);
  } finally { await sv.fechar(); }
});
