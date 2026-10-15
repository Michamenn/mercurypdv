// Testes de integridade financeira do PDV (PDV-*, CAX-*)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, cliente, semear } from './helpers.js';

test('PDV-002/004: cálculo no servidor, pagamento dividido exato e troco', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 20000 });

    // 2 X-Burger (5000) + 1 X-Burger com bacon (3000) + 1 batata (1500) + 2 refri (1200) = 10700
    const pedido = await s.caixaCli.post('/pedidos/balcao', {
      itens: [
        { produto_id: s.produtos.xburger.id, quantidade: 2 },
        { produto_id: s.produtos.xburger.id, quantidade: 1, adicionais: [{ adicional_id: s.adicionalBacon.id, quantidade: 1 }], observacoes: 'sem cebola' },
        { produto_id: s.produtos.batata.id, quantidade: 1 },
        { produto_id: s.produtos.refri.id, quantidade: 2 },
      ],
    }, { idem: 'pdv-001' });
    assert.equal(pedido.status, 201);
    assert.equal(pedido.corpo.totais.bruto_centavos, 10700, 'soma exata em centavos');
    assert.equal(pedido.corpo.totais.total_centavos, 10700);
    assert.equal(pedido.corpo.totais.saldo_centavos, 10700);

    // fechamento com saldo pendente → 409 (BR-003)
    const cedo = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});
    assert.equal(cedo.status, 409);
    assert.equal(cedo.corpo.codigo, '409_SALDO_PENDENTE');

    // pagamento excedido → 409
    const exced = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 10800, recebido_centavos: 10800 }, { idem: 'pdv-p1' });
    assert.equal(exced.status, 409);

    // dividido: dinheiro 5000 (recebido 6000 → troco 1000) + PIX 2500 + crédito 3200 = 10700
    const p1 = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 5000, recebido_centavos: 6000 }, { idem: 'pdv-a1' });
    assert.equal(p1.status, 201);
    assert.equal(p1.corpo.pagamento.troco_centavos, 1000);
    const p2 = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 2500 }, { idem: 'pdv-a2' });
    const p3 = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`,
      { forma: 'cartao_credito', valor_centavos: 3200 }, { idem: 'pdv-a3' });
    assert.equal(p2.status, 201);
    assert.equal(p3.status, 201);
    assert.equal(p3.corpo.saldo_centavos, 0);

    // fechamento agora passa e persiste total
    const fecho = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 200);
    assert.equal(fecho.corpo.status, 'fechado');
    assert.equal(fecho.corpo.total_fechado_centavos, 10700);

    // recibo não fiscal (BR-002) — sem taxa de serviço (BR-001)
    const rec = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/recibo`, { largura_mm: 80 });
    assert.equal(rec.status, 201);
    assert.match(rec.corpo.conteudo.documento, /NAO FISCAL/);
    assert.equal(rec.corpo.conteudo.sem_taxa_servico, true);
    assert.equal(rec.corpo.conteudo.totais.total, 10700);
    assert.ok(!JSON.stringify(rec.corpo.conteudo).toLowerCase().includes('taxa de serviço'));

    // reimpressão registrada
    const re = await s.caixaCli.post(`/recibos/${rec.corpo.id}/reimprimir`, {});
    assert.equal(re.status, 200);
    const auditoria = sv.db.prepare(`SELECT acao FROM auditoria WHERE acao = 'recibo_reimpresso'`).all();
    assert.equal(auditoria.length, 1);
  } finally { await sv.fechar(); }
});

test('PDV-006: idempotência — retransmissão de venda e pagamento não duplica (BR-007)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });

    const corpo = { itens: [{ produto_id: s.produtos.refri.id, quantidade: 3 }] };
    const r1 = await s.caixaCli.post('/pedidos/balcao', corpo, { idem: 'venda-x1' });
    const r2 = await s.caixaCli.post('/pedidos/balcao', corpo, { idem: 'venda-x1' });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r2.corpo.idempotente, true);
    assert.equal(r2.corpo.id, r1.corpo.id, 'mesmo pedido retornado');
    assert.equal(sv.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n, 1);

    const pag1 = await s.caixaCli.post(`/pedidos/${r1.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 1800 }, { idem: 'pag-x1' });
    const pag2 = await s.caixaCli.post(`/pedidos/${r1.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 1800 }, { idem: 'pag-x1' });
    assert.equal(pag1.status, 201);
    assert.equal(pag2.status, 201);
    assert.equal(pag2.corpo.idempotente, true);
    assert.equal(sv.db.prepare('SELECT COUNT(*) AS n FROM pagamentos').get().n, 1, 'um único pagamento');
    assert.equal(pag2.corpo.saldo_centavos, 0);

    // mesma key em outro pedido → 409
    const outro = await s.caixaCli.post('/pedidos/balcao', corpo, { idem: 'venda-x2' });
    const conflito = await s.caixaCli.post(`/pedidos/${outro.corpo.id}/pagamentos`,
      { forma: 'pix', valor_centavos: 1800 }, { idem: 'pag-x1' });
    assert.equal(conflito.status, 409);
  } finally { await sv.fechar(); }
});

test('PDV-007/008: cancelamento rastreável + estorno com step-up', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const pedido = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }, { produto_id: s.produtos.refri.id, quantidade: 1 }] },
      { idem: 'cancel-1' });

    // caixa cancela item NÃO enviado: permitido (matriz: caixa cancela sem step-up antes do envio no balcão)
    const itens = sv.db.prepare('SELECT id, nome_produto FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(pedido.corpo.id);
    const rCancel = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/itens/${itens[1].id}/cancelar`, { motivo: 'cliente desistiu' });
    assert.equal(rCancel.status, 200);
    assert.equal(rCancel.corpo.total_centavos, 5000); // 2 × 2500

    const item = sv.db.prepare('SELECT * FROM pedido_itens WHERE id = ?').get(itens[1].id);
    assert.equal(item.status, 'cancelado');
    assert.equal(item.cancelamento_motivo, 'cliente desistiu');
    assert.ok(item.cancelado_por, 'usuário registrado');

    // paga e tenta estornar sem step-up → 403; com step-up → ok
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000 }, { idem: 'cancel-p1' });
    const pg = sv.db.prepare('SELECT id FROM pagamentos WHERE pedido_id = ?').get(pedido.corpo.id);
    const semAuth = await s.caixaCli.post(`/pagamentos/${pg.id}/estornar`, { motivo: 'teste' });
    assert.equal(semAuth.status, 403);
    const comAuth = await s.caixaCli.post(`/pagamentos/${pg.id}/estornar`,
      { motivo: 'pagamento duplicado no cartão', admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(comAuth.status, 200);
    assert.equal(comAuth.corpo.saldo_centavos, 5000, 'saldo volta a ser devido');
    const pgDepois = sv.db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pg.id);
    assert.equal(pgDepois.estornado, 1);
    assert.ok(pgDepois.estorno_motivo);

    // pagamento novamente → fechamento
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 5000 }, { idem: 'cancel-p2' });
    const fecho = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 200);
  } finally { await sv.fechar(); }
});

test('CAX-001/002/003: caixa aberto/fechado, conferência e divergência', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    // venda exige caixa aberto (PDV-008)
    const semCaixa = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'cax-0' });
    assert.equal(semCaixa.status, 409);
    assert.equal(semCaixa.corpo.codigo, '409_CAIXA_FECHADO');

    const abertura = await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 15000 });
    assert.equal(abertura.status, 201);
    const dupla = await s.adminCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    assert.equal(dupla.status, 409); // 2 caixas simultâneos não

    // vendas: dinheiro 5000 (recebido 6000) e pix 3000 → dois pedidos
    const v1 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }] }, { idem: 'cax-1' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000, recebido_centavos: 6000 }, { idem: 'cax-1p' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/fechar`, {});
    const v2 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.batata.id, quantidade: 2 }] }, { idem: 'cax-2' });
    await s.caixaCli.post(`/pedidos/${v2.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 3000 }, { idem: 'cax-2p' });
    await s.caixaCli.post(`/pedidos/${v2.corpo.id}/fechar`, {});

    // suprimento (dinheiro) exige step-up para caixa; sangria também
    await s.caixaCli.post('/caixa/movimentar',
      { tipo: 'suprimento', forma: 'dinheiro', valor_centavos: 2000, motivo: 'troco adicional', admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    await s.caixaCli.post('/caixa/movimentar',
      { tipo: 'sangria', forma: 'dinheiro', valor_centavos: 7000, motivo: 'depósito bancário', admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });

    const atual = await s.caixaCli.get('/caixa/atual');
    assert.equal(atual.corpo.sessao.saldo_inicial_centavos, 15000);
    // esperado dinheiro = 15000 + 2000 + 5000 − 7000 = 15000
    assert.equal(atual.corpo.esperado.dinheiro, 15000);
    assert.equal(atual.corpo.esperado.pix, 3000);

    // conferência errada → fechar registra divergência (não bloqueia, registra)
    const fecho = await s.caixaCli.post('/caixa/fechar',
      { conferencia: { dinheiro: 14500, pix: 3000 }, observacoes: 'conferido' });
    assert.equal(fecho.status, 200);
    assert.equal(fecho.corpo.divergencia_dinheiro_centavos, -500);
    const conf = JSON.parse(fecho.corpo.conferencia_json);
    assert.equal(conf.dinheiro.esperado, 15000);
    assert.equal(conf.dinheiro.informado, 14500);
    assert.equal(conf.dinheiro.diferenca, -500);

    // histórico imutável: tentativa de UPDATE/DELETE em movimentação falha
    const mov = sv.db.prepare('SELECT id FROM caixa_movimentacoes LIMIT 1').get();
    assert.throws(() => sv.db.prepare('UPDATE caixa_movimentacoes SET valor_centavos = 1 WHERE id = ?').run(mov.id));
    assert.throws(() => sv.db.prepare('DELETE FROM caixa_movimentacoes WHERE id = ?').run(mov.id));
  } finally { await sv.fechar(); }
});

test('DB-004/DB-005: concorrência — 10 pagamentos paralelos: apenas os que cabem no saldo entram', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const pedido = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'conc-1' }); // total 600

    // 6 pagamentos de 200 em paralelo, keys distintas → soma 1200 > 600; apenas 3 podem passar
    const resultados = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((i) =>
        s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 200 }, { idem: `conc-p${i}` }))
    );
    const ok = resultados.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    const conflito = resultados.filter((r) => r.status === 'fulfilled' && r.value.status === 409);
    assert.equal(ok.length, 3, 'exatamente 3 × 200 = 600 aceitos');
    assert.equal(conflito.length, 3, 'os demais rejeitados por exceder saldo');
    const totalPago = sv.db.prepare('SELECT COALESCE(SUM(valor_centavos),0) AS t FROM pagamentos WHERE estornado = 0').get().t;
    assert.equal(totalPago, 600, 'soma paga exata — nenhum centavo a mais');
  } finally { await sv.fechar(); }
});

test('DB-006/BR-005: auditoria append-only registra operações financeiras', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'aud-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'aud-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    const acoes = sv.db.prepare('SELECT acao FROM auditoria').all().map((r) => r.acao);
    for (const esperada of ['caixa_abertura', 'pedido_criado', 'pagamento_registrado', 'pedido_fechado']) {
      assert.ok(acoes.includes(esperada), `auditoria contém ${esperada}`);
    }
    assert.throws(() => sv.db.prepare(`UPDATE auditoria SET acao = 'manipulado' WHERE id = 1`).run(), 'auditoria imutável');
  } finally { await sv.fechar(); }
});
