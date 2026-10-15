// Testes de Salão e Fechamento (A3 — itens 3.1, 3.2, 3.5, 3.7, 3.9, 3.13, 3.16, 3.17)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

test('A3-001: numeração da comanda, canal viagem e observação', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v1 = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }], canal: 'viagem', observacao: 'sem gelo' }, { idem: 'a3-n1' });
    assert.equal(v1.status, 201);
    assert.equal(v1.corpo.canal, 'viagem');
    assert.equal(v1.corpo.observacao, 'sem gelo');
    assert.equal(v1.corpo.numero_dia, 1);
    const v2 = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a3-n2' });
    assert.equal(v2.corpo.numero_dia, 2);
    assert.equal(v2.corpo.canal, 'salao');
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'A', observacao: 'aniversário' });
    assert.equal(c.corpo.numero_dia, 3);
    assert.equal(c.corpo.observacao, 'aniversário');
  } finally { await sv.fechar(); }
});

test('A3-002: guardar e retomar pedido', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a3-g1' });
    const g = await s.caixaCli.post(`/pedidos/${v.corpo.id}/guardar`, { guardado: true });
    assert.equal(g.status, 200);
    assert.equal(g.corpo.guardado, 1);
    const r = await s.caixaCli.post(`/pedidos/${v.corpo.id}/guardar`, { guardado: false });
    assert.equal(r.corpo.guardado, 0);
    // guardado ainda pode ser pago e fechado normalmente
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'a3-g1p' });
    const f = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(f.status, 200);
    const gf = await s.caixaCli.post(`/pedidos/${v.corpo.id}/guardar`, { guardado: true });
    assert.equal(gf.status, 409, 'fechado não guarda');
  } finally { await sv.fechar(); }
});

test('A3-003: cortesia exige permissão e motivo; item sai a zero', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a3-c1' });
    const semPerm = await s.caixaCli.post(`/pedidos/${v.corpo.id}/cortesia`, { produto_id: s.produtos.batata.id, motivo: 'teste' });
    assert.equal(semPerm.status, 403);
    const semMotivo = await s.adminCli.post(`/pedidos/${v.corpo.id}/cortesia`, { produto_id: s.produtos.batata.id, motivo: 'x' });
    assert.equal(semMotivo.status, 422);
    const ok = await s.adminCli.post(`/pedidos/${v.corpo.id}/cortesia`, { produto_id: s.produtos.batata.id, quantidade: 1, motivo: 'cliente aniversariante' });
    assert.equal(ok.status, 201);
    assert.equal(ok.corpo.totais.total_centavos, 600, 'cortesia não altera o total');
    const item = sv.db.prepare(`SELECT * FROM pedido_itens WHERE pedido_id = ? AND preco_unit_centavos = 0`).get(v.corpo.id);
    assert.ok(item);
    assert.match(item.observacoes, /CORTESIA/);
  } finally { await sv.fechar(); }
});

test('A3-004: divisão por pessoas com totais no servidor', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', {
      itens: [
        { produto_id: s.produtos.xburger.id, quantidade: 2 },
        { produto_id: s.produtos.refri.id, quantidade: 2 },
      ],
    }, { idem: 'a3-d1' });
    const pid = v.corpo.id;
    const itens = sv.db.prepare('SELECT id, produto_id, quantidade FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(pid);
    const xb = itens.find((i) => i.produto_id === s.produtos.xburger.id);
    const rf = itens.find((i) => i.produto_id === s.produtos.refri.id);
    const gA = await s.caixaCli.post(`/pedidos/${pid}/grupos`, { nome: 'Pessoa A' });
    const gB = await s.caixaCli.post(`/pedidos/${pid}/grupos`, { nome: 'Pessoa B' });
    assert.equal(gA.status, 201);
    const dup = await s.caixaCli.post(`/pedidos/${pid}/grupos`, { nome: 'Pessoa A' });
    assert.equal(dup.status, 409);
    // A: 1 X-Burger (2500) + 1 refri (600) = 3100; B: 1 X-Burger + 1 refri = 3100
    await s.caixaCli.put(`/pedidos/${pid}/grupos/${gA.corpo.id}`, { itens: [{ item_id: xb.id, quantidade: 1 }, { item_id: rf.id, quantidade: 1 }] });
    const div = await s.caixaCli.put(`/pedidos/${pid}/grupos/${gB.corpo.id}`, { itens: [{ item_id: xb.id, quantidade: 1 }, { item_id: rf.id, quantidade: 1 }] });
    assert.equal(div.status, 200);
    const a = div.corpo.grupos.find((g) => g.nome === 'Pessoa A');
    const b = div.corpo.grupos.find((g) => g.nome === 'Pessoa B');
    assert.equal(a.subtotal_centavos, 3100);
    assert.equal(b.subtotal_centavos, 3100);
    assert.equal(div.corpo.sem_grupo_centavos, 0);
    // excesso: atribuir 2 do mesmo item ao B (já tem 1+1) → 422
    const exc = await s.caixaCli.put(`/pedidos/${pid}/grupos/${gB.corpo.id}`, { itens: [{ item_id: xb.id, quantidade: 2 }] });
    assert.equal(exc.status, 422);
    const garcom = await s.garcomCli.get(`/pedidos/${pid}/divisao`);
    assert.equal(garcom.status, 403, 'garçom sem pode_dividir_pagar não vê divisão');
  } finally { await sv.fechar(); }
});

test('A3-005: bloqueio de mesa impede comanda; desbloqueio libera', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const negado = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/bloqueio`, { bloqueada: true });
    assert.equal(negado.status, 403);
    const b = await s.adminCli.post(`/mesas/${s.mesas.m1.id}/bloqueio`, { bloqueada: true, motivo: 'reserva 20h' });
    assert.equal(b.status, 200);
    assert.equal(b.corpo.bloqueada, 1);
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'X' });
    assert.equal(c.status, 409);
    assert.match(c.corpo.erro, /bloqueada/);
    const d = await s.adminCli.post(`/mesas/${s.mesas.m1.id}/bloqueio`, { bloqueada: false });
    assert.equal(d.corpo.bloqueada, 0);
    const c2 = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'X' });
    assert.equal(c2.status, 201);
    // mesa ocupada não bloqueia
    const b2 = await s.adminCli.post(`/mesas/${s.mesas.m1.id}/bloqueio`, { bloqueada: true, motivo: 'x' });
    assert.equal(b2.status, 409);
  } finally { await sv.fechar(); }
});

test('A3-006: chamado de garçom com dedup e atendimento', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const c1 = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/chamar`, { tipo: 'chamar' });
    assert.equal(c1.status, 201);
    const dup = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/chamar`, { tipo: 'chamar' });
    assert.equal(dup.status, 409);
    const outro = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/chamar`, { tipo: 'conta' });
    assert.equal(outro.status, 201);
    const lista = await s.garcomCli.get('/chamados');
    assert.equal(lista.corpo.length, 2);
    const at = await s.garcomCli.post(`/chamados/${c1.corpo.id}/atender`, {});
    assert.equal(at.status, 200);
    const lista2 = await s.garcomCli.get('/chamados');
    assert.equal(lista2.corpo.length, 1);
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao LIKE 'garcom_chamado%'`).get().n;
    assert.ok(aud >= 3);
  } finally { await sv.fechar(); }
});

test('A3-007: fechamento de salão por garçom + assinatura', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'F' });
    await s.garcomCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 1 }, { idem: 'a3-f1' });
    await s.garcomCli.post(`/pedidos/${c.corpo.id}/encaminhar`, {});
    // cozinha entrega
    await s.cozinhaCli.post(`/pedidos/${c.corpo.id}/kds-avancar`, {});
    await s.cozinhaCli.post(`/pedidos/${c.corpo.id}/kds-avancar`, {});
    await s.cozinhaCli.post(`/pedidos/${c.corpo.id}/kds-avancar`, {});
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 2500 }, { idem: 'a3-f1p' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/fechar`, {});
    const hoje = new Date().toISOString().slice(0, 10);
    const rel = await s.adminCli.get(`/relatorios/fechamento-salao?de=${hoje}&ate=${hoje}`);
    assert.equal(rel.status, 200);
    const joana = rel.corpo.por_garcom.find((g) => g.garcom_nome === 'Joana');
    assert.ok(joana);
    assert.equal(joana.comandas, 1);
    assert.equal(joana.itens_entregues, 1);
    const negado = await s.caixaCli.get(`/relatorios/fechamento-salao?de=${hoje}&ate=${hoje}`);
    assert.equal(negado.status, 403);
    const fake = await s.adminCli.post('/relatorios/fechamento-salao', { periodo_de: hoje, periodo_ate: hoje, assinatura_png: 'rabisco' });
    assert.equal(fake.status, 422);
    const ok = await s.adminCli.post('/relatorios/fechamento-salao', {
      periodo_de: hoje, periodo_ate: hoje, assinatura_png: 'data:image/png;base64,' + 'A'.repeat(200),
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.corpo.por_garcom.length, 1);
  } finally { await sv.fechar(); }
});

test('A3-008: detalhe da sessão para PDF de fechamento', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ab = await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 10000 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a3-s1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 600 }, { idem: 'a3-s1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    const det = await s.caixaCli.get(`/caixa/sessoes/${ab.corpo.id}`);
    assert.equal(det.status, 200);
    assert.equal(det.corpo.sessao.saldo_inicial_centavos, 10000);
    assert.equal(det.corpo.vendas.length, 1);
    assert.equal(det.corpo.esperado.dinheiro, 10600);
    const negado = await s.garcomCli.get(`/caixa/sessoes/${ab.corpo.id}`);
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('A3-009: numero_dia reinicia a cada dia (virada não quebra UNIQUE)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // Simula banco real na virada do dia: pedido "de ontem" já usou numero_dia 1.
    // (Bug reproduzido em produção: 500 UNIQUE constraint failed: pedidos.numero_dia)
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    sv.db.prepare(
      `INSERT INTO pedidos (tipo, status, aberto_em, criado_em, canal, numero_dia)
       VALUES ('balcao', 'fechado', ?, ?, 'salao', 1)`
    ).run(ontem, ontem);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // Hoje a sequência começa de novo: comanda recebe numero_dia 1 sem 500.
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Hoje' });
    assert.equal(c.status, 201);
    assert.equal(c.corpo.numero_dia, 1, 'numero_dia reinicia por dia');
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'a3-nd1' });
    assert.equal(v.corpo.numero_dia, 2, 'sequência do dia continua');
  } finally { await sv.fechar(); }
});
