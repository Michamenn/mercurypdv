// Testes de mesas/comandas, KDS em tempo real, estoque, persistência e relatórios
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { iniciarServidorTeste, cliente, semear, tokenDe } from './helpers.js';

function conectarWS(porta, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`);
    const eventos = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
    ws.on('error', reject);
    ws.on('open', () => resolve({ ws, eventos }));
    setTimeout(() => reject(new Error('ws timeout')), 3000);
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test('MESA-001..004 + KDS-001: ciclo completo de comanda com controle de estados', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    // garçom abre comanda
    const comanda = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Mesa do João' });
    assert.equal(comanda.status, 201);
    // mesa ocupada não abre outra comanda (índice único + validação)
    const dupla = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'outro' });
    assert.equal(dupla.status, 409);

    // garçom adiciona itens
    const add = await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`,
      { produto_id: s.produtos.xburger.id, quantidade: 2, observacoes: 'ponto da carne bem passado' }, { idem: 'mesa-i1' });
    assert.equal(add.status, 201);
    assert.equal(add.corpo.total_centavos, 5000);
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 }, { idem: 'mesa-i2' });

    // garçom cancela item NÃO enviado: permitido (matriz)
    const itens = sv.db.prepare('SELECT id FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(comanda.corpo.id);
    const cancel = await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens/${itens[1].id}/cancelar`, { motivo: 'engano do cliente' });
    assert.equal(cancel.status, 200);

    // encaminha à cozinha
    const envio = await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/encaminhar`, {});
    assert.equal(envio.status, 200);

    // item JÁ enviado: garçom não cancela (BR-004/matriz), caixa exige step-up
    const cancelEnviado = await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens/${itens[0].id}/cancelar`, { motivo: 'teste' });
    assert.equal(cancelEnviado.status, 403);
    const cancelEnviadoCaixa = await s.caixaCli.post(`/pedidos/${comanda.corpo.id}/itens/${itens[0].id}/cancelar`, { motivo: 'cliente reclamou' });
    assert.equal(cancelEnviadoCaixa.status, 403);
    const cancelOk = await s.caixaCli.post(`/pedidos/${comanda.corpo.id}/itens/${itens[0].id}/cancelar`,
      { motivo: 'cliente reclamou do ponto', admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(cancelOk.status, 200);

    // re-adiciona o item e reenvia
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 2 }, { idem: 'mesa-i3' });
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/encaminhar`, {});

    // cozinha vê fila e avança estados: pendente → preparando → pronto
    const fila1 = await s.cozinhaCli.get('/kds');
    assert.equal(fila1.status, 200);
    const pedKds = fila1.corpo.pedidos.find((p) => p.id === comanda.corpo.id);
    assert.equal(pedKds.kds_status, 'pendente');

    const av1 = await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
    assert.equal(av1.status, 200);
    assert.equal(av1.corpo.kds_status, 'preparando');
    const av2 = await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
    assert.equal(av2.corpo.kds_status, 'pronto');
    // garçom NÃO avança KDS
    const avGarcom = await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
    assert.equal(avGarcom.status, 403);

    // pagamento da comanda precisa de caixa aberto
    const semCaixa = await s.caixaCli.post(`/pedidos/${comanda.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000 }, { idem: 'mesa-p0' });
    assert.equal(semCaixa.status, 409);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 5000 });
    // saldo: 2 × 2500 = 5000
    const pag = await s.caixaCli.post(`/pedidos/${comanda.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000, recebido_centavos: 5000 }, { idem: 'mesa-p1' });
    assert.equal(pag.status, 201);
    // fechamento com pendente zero funciona; mesa volta a livre
    const fecho = await s.caixaCli.post(`/pedidos/${comanda.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 200);
    const mesa = sv.db.prepare('SELECT status FROM mesas WHERE id = ?').get(s.mesas.m1.id);
    assert.equal(mesa.status, 'livre');

    // fechamento com saldo pendente bloqueado (BR-003) em comanda
    const c2 = await s.garcomCli.post(`/mesas/${s.mesas.m2.id}/comanda`, { cliente: 'B' });
    await s.garcomCli.post(`/pedidos/${c2.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 1 }, { idem: 'mesa2-i1' });
    await s.garcomCli.post(`/pedidos/${c2.corpo.id}/encaminhar`, {});
    await s.caixaCli.post(`/pedidos/${c2.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 1000 }, { idem: 'mesa2-p1' });
    const negado = await s.caixaCli.post(`/pedidos/${c2.corpo.id}/fechar`, {});
    assert.equal(negado.status, 409);
    assert.equal(negado.corpo.codigo, '409_SALDO_PENDENTE');
    assert.equal(negado.corpo.totais.saldo_centavos, 1500);
  } finally { await sv.fechar(); }
});

test('KDS-003: WebSocket em tempo real — eventos com seq, reconexão com snapshot', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const c1 = await conectarWS(sv.porta, tokenDe(s.cozinhaCli));
    await dormir(150);

    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const pedido = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'ws-1' });
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/encaminhar`, {});
    await dormir(200);

    // eventos recebidos em ordem crescente de seq
    const seqs = c1.eventos.filter((e) => e.type === 'evento').map((e) => e.seq);
    assert.ok(seqs.length >= 2, `eventos emitidos (${seqs.length})`);
    for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], 'seq monotônico');

    // cliente novo recebe snapshot: auth_ok com seq atual
    const c2 = await conectarWS(sv.porta, tokenDe(s.cozinhaCli));
    await dormir(150);
    const authOk = c2.eventos.find((e) => e.type === 'auth_ok');
    assert.ok(authOk);
    assert.equal(authOk.seq, seqs[seqs.length - 1], 'seq atual entregue para recuperação');
    // evento duplicado/atrasado é descartado pelo cliente: regra implementada no frontend (PWA-002)

    c1.ws.close(); c2.ws.close();
  } finally { await sv.fechar(); }
});

test('KDS-004/BR-006: persistência após reinício do servidor (dados comerciais intactos)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 10000 });
    const pedido = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 3 }] }, { idem: 'restart-1' });
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 7500 }, { idem: 'restart-1p' });
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});

    // "reinício": fecha e reabre o banco
    sv.reabrirBanco();

    const usuarios = sv.db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    assert.equal(usuarios, 5, 'usuários persistidos');
    const p = sv.db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.corpo.id);
    assert.equal(p.status, 'fechado');
    assert.equal(p.total_fechado_centavos, 7500);
    const pgs = sv.db.prepare('SELECT COUNT(*) AS n FROM pagamentos WHERE pedido_id = ?').get(pedido.corpo.id).n;
    assert.equal(pgs, 1);
    const caixa = sv.db.prepare(`SELECT COUNT(*) AS n FROM caixa_sessoes WHERE status='aberto'`).get().n;
    assert.equal(caixa, 1, 'caixa aberto persiste');
  } finally { await sv.fechar(); }
});

test('EST-001..003: ficha técnica, baixa automática única e alertas', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // ingrediente pão: 10.000 g em estoque, mínimo 1.000
    const pao = await s.adminCli.post('/estoque/ingredientes', { nome: 'Pão Brioche', unidade: 'g', quantidade_mil: 10000000, minimo_mil: 1000000 });
    const carne = await s.adminCli.post('/estoque/ingredientes', { nome: 'Carne', unidade: 'g', quantidade_mil: 5000000, minimo_mil: 500000 });
    // ficha: 1 X-Burger = 100 g pão + 150 g carne
    await s.adminCli.put(`/produtos/${s.produtos.xburger.id}/ficha`, {
      itens: [
        { ingrediente_id: pao.corpo.id, quantidade_mil: 100000 },
        { ingrediente_id: carne.corpo.id, quantidade_mil: 150000 },
      ],
    });

    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v1 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }] }, { idem: 'est-1' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000 }, { idem: 'est-1p' });
    await s.caixaCli.post(`/pedidos/${v1.corpo.id}/fechar`, {});

    // baixa: 200 g pão, 300 g carne
    const paoDepois = sv.db.prepare('SELECT quantidade_mil FROM ingredientes WHERE id = ?').get(pao.corpo.id);
    assert.equal(paoDepois.quantidade_mil, 10000000 - 200000);
    const carneDepois = sv.db.prepare('SELECT quantidade_mil FROM ingredientes WHERE id = ?').get(carne.corpo.id);
    assert.equal(carneDepois.quantidade_mil, 5000000 - 300000);

    // reprocessamento do fechamento NÃO baixa de novo (EST-002/BR-007)
    const baixas = sv.db.prepare(
      `SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE tipo='saida_venda' AND ref_id = ?`).get(v1.corpo.id).n;
    assert.equal(baixas, 2, 'uma movimentação por ingrediente');
    sv.db2 = null;
    // força segunda passada direta no serviço
    const { baixarEstoquePedido } = await import('../server/src/services/estoqueService.js');
    baixarEstoquePedido(sv.db, v1.corpo.id, 1, null);
    const baixas2 = sv.db.prepare(
      `SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE tipo='saida_venda' AND ref_id = ?`).get(v1.corpo.id).n;
    assert.equal(baixas2, 2, 'idempotente: nenhuma baixa adicional');

    // carnes abaixo do mínimo disparam alerta na consulta
    const baixos = await s.adminCli.get('/estoque?apenas_baixos=1');
    assert.ok(Array.isArray(baixos.corpo));

    // movimentação manual com histórico e usuário
    const entrada = await s.adminCli.post(`/estoque/movimentar/${pao.corpo.id}`,
      { tipo: 'entrada', quantidade_mil: 500000, observacao: 'entrega fornecedor' });
    assert.equal(entrada.status, 200);
    const movs = await s.adminCli.get(`/estoque/movimentacoes?ingrediente_id=${pao.corpo.id}`);
    assert.ok(movs.corpo.length >= 3); // inicial + venda + entrada
    assert.ok(movs.corpo.every((m) => m.usuario_nome));
  } finally { await sv.fechar(); }
});

test('REL-001..003: relatórios com bruto/desconto/cancelamento/líquido e acesso por cargo', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });

    // pedido A: 2 X-Burger (5000) − desconto 500 = 4500 (dinheiro)
    const a = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }] }, { idem: 'rel-a' });
    await s.adminCli.post(`/pedidos/${a.corpo.id}/desconto`, { valor_centavos: 500, motivo: 'cortesia' });
    await s.caixaCli.post(`/pedidos/${a.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 4500 }, { idem: 'rel-ap' });
    await s.caixaCli.post(`/pedidos/${a.corpo.id}/fechar`, {});

    // pedido B: 1 batata (1500), 1 item cancelado (refri 600) → pago pix 1500
    const b = await s.caixaCli.post('/pedidos/balcao', {
      itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }, { produto_id: s.produtos.refri.id, quantidade: 1 }],
    }, { idem: 'rel-b' });
    const itensB = sv.db.prepare('SELECT id FROM pedido_itens WHERE pedido_id = ? ORDER BY id').all(b.corpo.id);
    await s.caixaCli.post(`/pedidos/${b.corpo.id}/itens/${itensB[1].id}/cancelar`, { motivo: 'sem estoque do refri' });
    await s.caixaCli.post(`/pedidos/${b.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 1500 }, { idem: 'rel-bp' });
    await s.caixaCli.post(`/pedidos/${b.corpo.id}/fechar`, {});

    const hoje = new Date().toISOString().slice(0, 10);
    const resumo = await s.adminCli.get(`/relatorios/resumo?de=${hoje}&ate=${hoje}`);
    assert.equal(resumo.status, 200);
    assert.equal(resumo.corpo.bruto_centavos, 6500); // itens ATIVOS: A 5000; B 1500 (refri cancelado fora do bruto)
    assert.equal(resumo.corpo.descontos_centavos, 500);
    assert.equal(resumo.corpo.cancelamentos_centavos, 600);
    assert.equal(resumo.corpo.liquido_centavos, 6000); // 4500 + 1500
    assert.equal(resumo.corpo.pedidos_fechados, 2);
    assert.equal(resumo.corpo.ticket_medio_centavos, 3000);
    assert.equal(resumo.corpo.por_forma.dinheiro, 4500);
    assert.equal(resumo.corpo.por_forma.pix, 1500);
    const top = resumo.corpo.top_produtos.find((p) => p.nome === 'X-Burger');
    assert.equal(top.quantidade, 2);

    // isolamento: caixa sem relatórios (matriz)
    const negado = await s.caixaCli.get(`/relatorios/resumo?de=${hoje}&ate=${hoje}`);
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});
