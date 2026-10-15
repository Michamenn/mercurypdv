// Testes de Combos/Promoções (item 3) e Renumerar/Excluir Mesa (item 6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

async function comboBase(adminCli, produtos, extra = {}) {
  return adminCli.post('/combos', {
    nome: `Combo Teste ${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    tipo: 'preco_fixo',
    preco_fixo_centavos: 3990,
    exige_estoque: 0,
    itens: [
      { produto_id: produtos.xburger.id, quantidade: 1, obrigatorio: 1 },
      { produto_id: produtos.batata.id, quantidade: 1, obrigatorio: 1 },
      { produto_id: produtos.refri.id, quantidade: 1, obrigatorio: 1 },
    ],
    ...extra,
  });
}

test('CMB-001: CRUD de combos com permissão (admin ok, caixa barrado)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const negado = await s.caixaCli.post('/combos', { nome: 'X', tipo: 'preco_fixo', preco_fixo_centavos: 100, itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] });
    assert.equal(negado.status, 403);
    const r = await comboBase(s.adminCli, s.produtos);
    assert.equal(r.status, 201);
    assert.equal(r.corpo.itens.length, 3);
    const lista = await s.adminCli.get('/combos');
    assert.ok(Array.isArray(lista.corpo));
    const toggle = await s.adminCli.post(`/combos/${r.corpo.id}/toggle`, {});
    assert.equal(toggle.corpo.ativo, 0);
    const reativar = await s.adminCli.post(`/combos/${r.corpo.id}/toggle`, {});
    assert.equal(reativar.corpo.ativo, 1);
  } finally { await sv.fechar(); }
});

test('CMB-002: preco_fixo aplica desconto exato e fecha a conta', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const combo = await comboBase(s.adminCli, s.produtos);
    // pedido com 1 batata avulsa + combo: bruto = 1500 + 4600 = 6100; desconto 610 → total 5490
    const pedido = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: 'cmb-2b' });
    const ap = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/aplicar-combo`, { combo_id: combo.corpo.id }, { idem: 'cmb-2a' });
    assert.equal(ap.status, 201);
    assert.equal(ap.corpo.desconto_centavos, 610);
    // bruto = 1500 (batata avulsa) + 4600 (combo) = 6100; total = 6100-610 = 5490
    assert.equal(ap.corpo.bruto_centavos, 6100);
    assert.equal(ap.corpo.total_centavos, 5490);
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 5490 }, { idem: 'cmb-2p' });
    const fecho = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 200);
    // auditoria registra a aplicação
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao='combo_aplicado'`).get().n;
    assert.equal(aud, 1);
  } finally { await sv.fechar(); }
});

test('CMB-003: idempotência — mesma key não duplica itens nem desconto (BR-007)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const combo = await comboBase(s.adminCli, s.produtos);
    const pedido = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: 'cmb-3v' });
    const a1 = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/aplicar-combo`, { combo_id: combo.corpo.id }, { idem: 'cmb-3a' });
    const a2 = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/aplicar-combo`, { combo_id: combo.corpo.id }, { idem: 'cmb-3a' });
    assert.equal(a1.status, 201);
    assert.equal(a2.status, 200);
    assert.equal(a2.corpo.idempotente, true);
    const nItens = sv.db.prepare('SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ?').get(pedido.corpo.id).n;
    assert.equal(nItens, 4, '1 avulso + 3 do combo, sem duplicação');
    assert.equal(sv.db.prepare('SELECT COUNT(*) AS n FROM pedido_combos').get().n, 1);
  } finally { await sv.fechar(); }
});

test('CMB-004: leve_pague, percentual, brinde e grupos de escolha', async (t) => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });

    await t.test('leve 3 pague 2 em 3 refris (600) → desconto 600', async () => {
      const c = await s.adminCli.post('/combos', {
        nome: `LevePague ${Date.now()}`, tipo: 'leve_pague', leve_quantidade: 3, pague_quantidade: 2, exige_estoque: 0,
        itens: [{ produto_id: s.produtos.refri.id, quantidade: 3, obrigatorio: 1 }],
      });
      assert.equal(c.status, 201);
      const p = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: `lp-v${c.corpo.id}` });
      const ap = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: c.corpo.id }, { idem: `lp-a${c.corpo.id}` });
      assert.equal(ap.corpo.desconto_centavos, 600);
      assert.equal(ap.corpo.total_centavos, 1500 + 1800 - 600);
    });

    await t.test('20% sobre X-Burger 2500 → desconto 500', async () => {
      const c = await s.adminCli.post('/combos', {
        nome: `Pct ${Date.now()}`, tipo: 'desconto_percentual', desconto_percentual: 20, exige_estoque: 0,
        itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1, obrigatorio: 1 }],
      });
      const p = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: `pc-v${c.corpo.id}` });
      const ap = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: c.corpo.id }, { idem: `pc-a${c.corpo.id}` });
      assert.equal(ap.corpo.desconto_centavos, 500);
    });

    await t.test('brinde insere item a preço zero', async () => {
      const c = await s.adminCli.post('/combos', {
        nome: `Brinde ${Date.now()}`, tipo: 'brinde', brinde_produto_id: s.produtos.refri.id, exige_estoque: 0,
        itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1, obrigatorio: 1 }],
      });
      const p = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: `br-v${c.corpo.id}` });
      const ap = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: c.corpo.id }, { idem: `br-a${c.corpo.id}` });
      assert.equal(ap.status, 201);
      const brinde = sv.db.prepare(
        `SELECT * FROM pedido_itens WHERE pedido_id = ? AND preco_unit_centavos = 0`).get(p.corpo.id);
      assert.ok(brinde, 'item brinde a preço zero existe');
      assert.match(brinde.observacoes, /BRINDE/);
    });

    await t.test('grupo de escolha: respeita max e rejeita excesso', async () => {
      const c = await s.adminCli.post('/combos', {
        nome: `Escolha ${Date.now()}`, tipo: 'preco_fixo', preco_fixo_centavos: 3000, exige_estoque: 0,
        itens: [
          { produto_id: s.produtos.xburger.id, quantidade: 1, obrigatorio: 1 },
          { produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 0, grupo_escolha: 1, max_escolhas: 1 },
          { produto_id: s.produtos.batata.id, quantidade: 1, obrigatorio: 0, grupo_escolha: 1, max_escolhas: 1 },
        ],
      });
      assert.equal(c.status, 201);
      const p = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: `es-v${c.corpo.id}` });
      const excesso = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`,
        { combo_id: c.corpo.id, escolhas: [{ produto_id: s.produtos.refri.id }, { produto_id: s.produtos.batata.id }] }, { idem: `es-e${c.corpo.id}` });
      assert.equal(excesso.status, 422);
      const ok = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`,
        { combo_id: c.corpo.id, escolhas: [{ produto_id: s.produtos.refri.id }] }, { idem: `es-o${c.corpo.id}` });
      assert.equal(ok.status, 201);
    });
  } finally { await sv.fechar(); }
});

test('CMB-005: vigência e estoque bloqueiam aplicação inválida', async () => {  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });

    const expirado = await s.adminCli.post('/combos', {
      nome: `Exp ${Date.now()}`, tipo: 'preco_fixo', preco_fixo_centavos: 100, exige_estoque: 0,
      valido_de: '2020-01-01T00:00:00.000Z', valido_ate: '2020-02-01T00:00:00.000Z',
      itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 1 }],
    });
    const p = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: 'cmb-5v' });
    const rExp = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: expirado.corpo.id }, { idem: 'cmb-5e' });
    assert.equal(rExp.status, 422);

    // estoque: ficha exige 1kg de ingrediente com 0 em estoque
    const ing = await s.adminCli.post('/estoque/ingredientes', { nome: `Ingred ${Date.now()}`, unidade: 'g', quantidade_mil: 0, minimo_mil: 1000 });
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}/ficha`, { itens: [{ ingrediente_id: ing.corpo.id, quantidade_mil: 1000000 }] });
    const cEst = await comboBase(s.adminCli, s.produtos, { exige_estoque: 1 });
    const rEst = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: cEst.corpo.id }, { idem: 'cmb-5s' });
    assert.equal(rEst.status, 422);
    assert.match(rEst.corpo.erro, /Estoque insuficiente/);
  } finally { await sv.fechar(); }
});

test('MESA-EDIT: renumerar e excluir com validações (item 6)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    // garçom não gerencia mesas
    const negado = await s.garcomCli.put(`/mesas/${s.mesas.m1.id}`, { numero: 10 });
    assert.equal(negado.status, 403);

    // renumerar livre ok
    const ren = await s.adminCli.put(`/mesas/${s.mesas.m1.id}`, { numero: 10, setor: 'varanda' });
    assert.equal(ren.status, 200);
    assert.equal(ren.corpo.numero, 10);

    // número duplicado → 409
    const dup = await s.adminCli.put(`/mesas/${s.mesas.m2.id}`, { numero: 10 });
    assert.equal(dup.status, 409);

    // mesa ocupada não renumera
    await s.garcomCli.post(`/mesas/${s.mesas.m2.id}/comanda`, { cliente: 'T' });
    const ocup = await s.adminCli.put(`/mesas/${s.mesas.m2.id}`, { numero: 20 });
    assert.equal(ocup.status, 409);

    // excluir: mesa com histórico (m1 foi renumerada mas nunca teve comanda? m1 livre sem pedidos → pode excluir)
    const delLivre = await s.adminCli.delete(`/mesas/${s.mesas.m1.id}`);
    assert.equal(delLivre.status, 200);

    // mesa ocupada não exclui
    const delOcup = await s.adminCli.delete(`/mesas/${s.mesas.m2.id}`);
    assert.equal(delOcup.status, 409);

    // mesa livre COM histórico não exclui (abre e fecha comanda na m3)
    const m3 = await s.adminCli.post('/mesas', { numero: 30 });
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c3 = await s.garcomCli.post(`/mesas/${m3.corpo.id}/comanda`, { cliente: 'H' });
    await s.garcomCli.post(`/pedidos/${c3.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 }, { idem: 'hist-1' });
    await s.garcomCli.post(`/pedidos/${c3.corpo.id}/encaminhar`, {});
    await s.caixaCli.post(`/pedidos/${c3.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'hist-1p' });
    await s.caixaCli.post(`/pedidos/${c3.corpo.id}/fechar`, {});
    const delHist = await s.adminCli.delete(`/mesas/${m3.corpo.id}`);
    assert.equal(delHist.status, 409);
    assert.match(delHist.corpo.erro, /histórico/);
  } finally { await sv.fechar(); }
});

test(`CMB-006: somente_desconto — pedido montado no carrinho recebe só o benefício`, async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post(`/caixa/abrir`, { saldo_inicial_centavos: 0 });
    const combo = await comboBase(s.adminCli, s.produtos);
    // pedido já contém exatamente os itens do combo (fluxo carrinho vazio do PDV)
    const p = await s.caixaCli.post(`/pedidos/balcao`, { itens: [
      { produto_id: s.produtos.xburger.id, quantidade: 1 },
      { produto_id: s.produtos.batata.id, quantidade: 1 },
      { produto_id: s.produtos.refri.id, quantidade: 1 },
    ] }, { idem: `cmb-6v` });
    const ap = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`,
      { combo_id: combo.corpo.id, somente_desconto: true }, { idem: `cmb-6a` });
    assert.equal(ap.status, 201);
    assert.equal(ap.corpo.desconto_centavos, 610);
    assert.equal(ap.corpo.total_centavos, 3990);
    const nItens = sv.db.prepare(`SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ?`).get(p.corpo.id).n;
    assert.equal(nItens, 3, `nenhum item duplicado no modo somente-desconto`);
    // sem os itens no pedido → 422
    const p2 = await s.caixaCli.post(`/pedidos/balcao`, { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: `cmb-6v2` });
    const ruim = await s.caixaCli.post(`/pedidos/${p2.corpo.id}/aplicar-combo`,
      { combo_id: combo.corpo.id, somente_desconto: true }, { idem: `cmb-6b` });
    assert.equal(ruim.status, 422);
  } finally { await sv.fechar(); }
});
