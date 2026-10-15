// Testes do Cardápio Inteligente (A1 — itens 1.1 a 1.10)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

test('A1-001: tipos, código de barras único e apelidos normalizados', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const cat = sv.db.prepare('SELECT id FROM categorias LIMIT 1').get().id;
    const p = await s.adminCli.post('/produtos', {
      nome: 'Açaí 500ml', categoria_id: cat, preco_centavos: 1800, tipo_item: 'sobremesa',
      codigo_barras: '789123456', apelidos: 'Acai, AÇAÍ COPO ; acai 500',
    });
    assert.equal(p.status, 201);
    assert.equal(p.corpo.tipo_item, 'sobremesa');
    assert.equal(p.corpo.codigo_barras, '789123456');
    assert.equal(p.corpo.apelidos, 'acai, açaí copo, acai 500');
    const dup = await s.adminCli.post('/produtos', {
      nome: 'Outro', categoria_id: cat, preco_centavos: 100, codigo_barras: '789123456',
    });
    assert.equal(dup.status, 409);
    const ruim = await s.adminCli.post('/produtos', {
      nome: 'Ruim', categoria_id: cat, preco_centavos: 100, codigo_barras: '!!',
    });
    assert.equal(ruim.status, 422);
    const negado = await s.caixaCli.post('/produtos', { nome: 'X', categoria_id: cat, preco_centavos: 100 });
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('A1-002: variações com delta aplicadas no preço da venda', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const vG = await s.adminCli.post(`/produtos/${s.produtos.xburger.id}/variacoes`, {
      grupo: 'tamanho', nome: 'G', delta_centavos: 500,
    });
    assert.equal(vG.status, 201);
    const vPonto = await s.adminCli.post(`/produtos/${s.produtos.xburger.id}/variacoes`, {
      grupo: 'ponto', nome: 'Mal passado', delta_centavos: 0,
    });
    assert.equal(vPonto.status, 201);
    // venda com variação G: 2500 + 500 = 3000
    const pedido = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1, variacao_id: vG.corpo.id }] }, { idem: 'a1-var-1' });
    assert.equal(pedido.status, 201);
    assert.equal(pedido.corpo.totais.total_centavos, 3000);
    const item = sv.db.prepare('SELECT variacao_nome, variacao_delta_centavos, preco_unit_centavos FROM pedido_itens WHERE pedido_id = ?').get(pedido.corpo.id);
    assert.equal(item.variacao_delta_centavos, 500);
    assert.match(item.variacao_nome, /tamanho: G/);
    // variação inexistente/outro produto → 422
    const ruim = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1, variacao_id: 99999 }] }, { idem: 'a1-var-2' });
    assert.equal(ruim.status, 422);
    // variação de outro produto não serve
    const cruzada = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, variacao_id: vG.corpo.id }] }, { idem: 'a1-var-3' });
    assert.equal(cruzada.status, 422);
  } finally { await sv.fechar(); }
});

test('A1-003: indisponível com motivo bloqueia a venda; liberar volta a vender', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const upd = await s.adminCli.put(`/produtos/${s.produtos.xburger.id}`, {
      nome: 'X-Burger', categoria_id: s.produtos.xburger.categoria_id, preco_centavos: 2500,
      indisponivel_motivo: 'Acabou o pão',
    });
    assert.equal(upd.status, 200);
    const bloqueada = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a1-ind-1' });
    assert.equal(bloqueada.status, 422);
    assert.match(bloqueada.corpo.erro, /Acabou o pão/);
    // catálogo informa indisponibilidade
    const cat = await s.caixaCli.get('/catalogo');
    const item = cat.corpo.produtos.find((p) => p.id === s.produtos.xburger.id);
    assert.equal(item.disponivel, 0);
    // libera e vende
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}`, {
      nome: 'X-Burger', categoria_id: s.produtos.xburger.categoria_id, preco_centavos: 2500, indisponivel_motivo: '',
    });
    const ok = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a1-ind-2' });
    assert.equal(ok.status, 201);
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao IN ('produto_indisponivel','produto_disponivel')`).get().n;
    assert.equal(aud, 2);
  } finally { await sv.fechar(); }
});

test('A1-004: período de cardápio restringe a venda fora do horário', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // período válido só amanhã (dia diferente de hoje)
    const amanha = (new Date().getDay() + 1) % 7;
    const per = await s.adminCli.post('/periodos', { nome: 'Almoço Teste', dias: String(amanha), hora_ini: '00:00', hora_fim: '23:59' });
    assert.equal(per.status, 201);
    const ruim = await s.adminCli.post('/periodos', { nome: 'X', dias: '7', hora_ini: '10:00', hora_fim: '12:00' });
    assert.equal(ruim.status, 422);
    const ruim2 = await s.adminCli.post('/periodos', { nome: 'Y', dias: '1', hora_ini: '18:00', hora_fim: '12:00' });
    assert.equal(ruim2.status, 422);
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}/periodos`, { periodo_ids: [per.corpo.id] });
    const fora = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a1-per-1' });
    assert.equal(fora.status, 422);
    assert.match(fora.corpo.erro, /Fora do período/);
    // outro produto sem vínculo continua vendendo
    const livre = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a1-per-2' });
    assert.equal(livre.status, 201);
    // desvincula e volta a vender
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}/periodos`, { periodo_ids: [] });
    const ok = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'a1-per-3' });
    assert.equal(ok.status, 201);
  } finally { await sv.fechar(); }
});

test('A1-005: preço programado aplica na vigência; histórico registra tudo', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // programa aumento futuro (+1h): não aplica agora
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const prog = await s.adminCli.post(`/produtos/${s.produtos.refri.id}/preco-programado`, {
      preco_centavos: 800, valido_de: futuro,
    });
    assert.equal(prog.status, 201);
    assert.equal(prog.corpo.aplicado, 0);
    const vendaAntes = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a1-pr-1' });
    assert.equal(vendaAntes.corpo.totais.total_centavos, 600);
    // simula chegada da vigência e vende: novo preço aplicado automaticamente
    sv.db.prepare('UPDATE preco_historico SET valido_de = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), prog.corpo.id);
    const vendaDepois = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a1-pr-2' });
    assert.equal(vendaDepois.corpo.totais.total_centavos, 800);
    const hist = await s.adminCli.get(`/produtos/${s.produtos.refri.id}/precos`);
    assert.ok(hist.corpo.length >= 2, 'histórico com criação + programado');
    const auto = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao='preco_vigencia_aplicada'`).get().n;
    assert.equal(auto, 1);
  } finally { await sv.fechar(); }
});

test('A1-006: mais vendidos reflete vendas fechadas', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', {
      itens: [
        { produto_id: s.produtos.xburger.id, quantidade: 2 },
        { produto_id: s.produtos.refri.id, quantidade: 1 },
      ],
    }, { idem: 'a1-top-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: v.corpo.totais.total_centavos }, { idem: 'a1-top-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    const top = await s.caixaCli.get('/catalogo/mais-vendidos?dias=30&limite=8');
    assert.equal(top.status, 200);
    assert.equal(top.corpo[0].nome, 'X-Burger');
    assert.equal(top.corpo[0].quantidade, 2);
  } finally { await sv.fechar(); }
});
