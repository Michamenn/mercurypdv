// Testes do Salão Pro (migração 010): comanda individual, layout do salão,
// taxa de serviço, gorjeta/comissões, check-in, transferência e junção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

// Atalho: abre caixa e paga integralmente um pedido, fechando-o.
async function quitar(s, pedidoId, idem) {
  const p = await s.caixaCli.get(`/pedidos/${pedidoId}`);
  const saldo = p.corpo.totais.saldo_centavos;
  if (saldo > 0) {
    const r = await s.caixaCli.post(`/pedidos/${pedidoId}/pagamentos`,
      { forma: 'pix', valor_centavos: saldo }, { idem });
    assert.equal(r.status, 201, `pagamento deve ser aceito: ${JSON.stringify(r.corpo)}`);
  }
  const f = await s.caixaCli.post(`/pedidos/${pedidoId}/fechar`, {});
  assert.equal(f.status, 200, `fechamento deve ser aceito: ${JSON.stringify(f.corpo)}`);
  return f.corpo;
}

test('SP-001: comanda individual — várias contas coexistem na mesma mesa', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const mesa = s.mesas.m1.id;

    const c1 = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Ana' });
    assert.equal(c1.status, 201);

    // Sem `individual`, a segunda comanda na mesa ocupada é recusada.
    const bloqueio = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Bruno' });
    assert.equal(bloqueio.status, 409, 'mesa ocupada exige comanda individual explícita');

    // Com `individual`, coexistem duas contas independentes.
    const c2 = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Bruno', individual: true });
    assert.equal(c2.status, 201, `comanda individual deve abrir: ${JSON.stringify(c2.corpo)}`);
    assert.equal(c2.corpo.mesa_id, mesa);
    assert.equal(c2.corpo.individual, 1);
    assert.notEqual(c2.corpo.id, c1.corpo.id);

    // Ambas ficam abertas e visíveis no mapa.
    const mapa = await s.garcomCli.get('/salao/mapa');
    const m1 = mapa.corpo.mesas.find((m) => m.id === mesa);
    assert.equal(m1.comandas_abertas, 2, 'mesa deve reportar 2 comandas abertas');
    assert.equal(m1.status, 'ocupada');
  } finally { await sv.fechar(); }
});

test('SP-002: fechar UMA comanda individual NÃO libera a mesa; fechar todas libera', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const mesa = s.mesas.m1.id;
    const c1 = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Ana' });
    const c2 = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Bruno', individual: true });

    await s.caixaCli.post(`/pedidos/${c1.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 });
    await s.caixaCli.post(`/pedidos/${c2.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 1 });

    // Fechamento parcial: Ana paga e sai, Bruno continua na mesa.
    await quitar(s, c1.corpo.id, 'sp2-p1');
    const detalhe = await s.garcomCli.get(`/salao/mesas/${mesa}`);
    assert.equal(detalhe.corpo.mesa.status, 'ocupada', 'mesa deve seguir ocupada com a comanda de Bruno');
    assert.equal(detalhe.corpo.comandas.length, 1);
    assert.equal(detalhe.corpo.comandas[0].comanda_nome, 'Bruno');

    // Fechando a última, a mesa é liberada e marcada ociosa.
    await quitar(s, c2.corpo.id, 'sp2-p2');
    const det2 = await s.garcomCli.get(`/salao/mesas/${mesa}`);
    assert.equal(det2.corpo.mesa.status, 'livre');
    assert.ok(det2.corpo.mesa.ociosa_desde, 'mesa liberada deve registrar ociosidade');
  } finally { await sv.fechar(); }
});

test('SP-003: taxa de serviço percentual entra no total e é cobrada no fechamento', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const cfg = await s.adminCli.put('/config', { taxa_servico_modo: 'percentual', taxa_servico_pct: '10' });
    assert.equal(cfg.corpo.taxa_servico_modo, 'percentual');

    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 2 }); // 2×2500 = 5000

    const p = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(p.corpo.totais.bruto_centavos, 5000);
    assert.equal(p.corpo.totais.subtotal_centavos, 5000);
    assert.equal(p.corpo.totais.taxa_servico_centavos, 500, '10% de 5000 = 500');
    assert.equal(p.corpo.totais.total_centavos, 5500, 'total = subtotal + taxa');
    assert.equal(p.corpo.totais.saldo_centavos, 5500);

    // O caixa tem de pagar os 5500 — não os 5000 — para fechar.
    await quitar(s, c.corpo.id, 'sp3-p1');
  } finally { await sv.fechar(); }
});

test('SP-004: taxa fixa e "desativada" alternam corretamente', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 10 }); // 6000

    await s.adminCli.put('/config', { taxa_servico_modo: 'fixa', taxa_servico_fixo_centavos: '700' });
    let p = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(p.corpo.totais.taxa_servico_centavos, 700, 'taxa fixa independe do subtotal');

    await s.adminCli.put('/config', { taxa_servico_modo: 'desativada' });
    p = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(p.corpo.totais.taxa_servico_centavos, 0, 'taxa desativada zera');
    assert.equal(p.corpo.totais.total_centavos, 6000);
  } finally { await sv.fechar(); }
});

test('SP-005: taxa NÃO pode empurrar o total abaixo do já pago', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 }); // 600

    // Cliente paga a conta inteira ANTES de a taxa existir.
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'sp5-p1' });

    // Liga-se uma taxa de 50%: o total sobe, não vira saldo negativo.
    await s.adminCli.put('/config', { taxa_servico_modo: 'percentual', taxa_servico_pct: '50' });
    const p = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(p.corpo.totais.taxa_servico_centavos, 300);
    assert.equal(p.corpo.totais.saldo_centavos, 300, 'saldo deve refletir a taxa, nunca ser negativo');
    assert.ok(p.corpo.totais.saldo_centavos >= 0);

    await s.caixaCli.post(`/pedidos/${c.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 300 }, { idem: 'sp5-p2' });
    const f = await s.caixaCli.post(`/pedidos/${c.corpo.id}/fechar`, {});
    assert.equal(f.status, 200);
  } finally { await sv.fechar(); }
});

test('SP-006: taxa fixa sobrevive ao desconto; percentual zera com o subtotal', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });

    // --- Taxa FIXA: não é "perdoada" junto com o desconto ---
    await s.adminCli.put('/config', { taxa_servico_modo: 'fixa', taxa_servico_fixo_centavos: '800' });
    const c1 = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c1.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 2 }); // 5000

    const r1 = await s.adminCli.post(`/pedidos/${c1.corpo.id}/desconto`, { valor_centavos: 99999, motivo: 'cortesia' });
    assert.equal(r1.status, 200, `desconto deve ser limitado ao bruto: ${JSON.stringify(r1.corpo)}`);
    assert.equal(r1.corpo.desconto_centavos, 5000, 'desconto limitado ao bruto');
    assert.equal(r1.corpo.totais.subtotal_centavos, 0);
    assert.equal(r1.corpo.totais.taxa_servico_centavos, 800, 'taxa fixa continua devendo');
    assert.equal(r1.corpo.totais.total_centavos, 800);

    await s.caixaCli.post(`/pedidos/${c1.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 800 }, { idem: 'sp6-p1' });
    const f1 = await s.caixaCli.post(`/pedidos/${c1.corpo.id}/fechar`, {});
    assert.equal(f1.status, 200);
    assert.equal(f1.corpo.total_fechado_centavos, 800);

    // --- Taxa PERCENTUAL: incide sobre o subtotal, então zera junto ---
    await s.adminCli.put('/config', { taxa_servico_modo: 'percentual', taxa_servico_pct: '10' });
    const c2 = await s.garcomCli.post(`/mesas/${s.mesas.m2.id}/comanda`, { cliente: 'Bruno' });
    await s.caixaCli.post(`/pedidos/${c2.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 2 });
    const r2 = await s.adminCli.post(`/pedidos/${c2.corpo.id}/desconto`, { valor_centavos: 99999, motivo: 'cortesia' });
    assert.equal(r2.corpo.totais.subtotal_centavos, 0);
    assert.equal(r2.corpo.totais.taxa_servico_centavos, 0, '10% de R$ 0,00 é R$ 0,00');
    assert.equal(r2.corpo.totais.total_centavos, 0);
    // Comanda zerada fecha sem pagamento nenhum.
    const f2 = await s.caixaCli.post(`/pedidos/${c2.corpo.id}/fechar`, {});
    assert.equal(f2.status, 200);
  } finally { await sv.fechar(); }
});

test('SP-007: gorjeta NÃO altera o total da venda (só a comissão)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 }); // 600

    const antes = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(antes.corpo.totais.total_centavos, 600);

    const g = await s.caixaCli.post(`/pedidos/${c.corpo.id}/gorjeta`, { valor_centavos: 100, forma: 'dinheiro' });
    assert.equal(g.status, 201, `gorjeta deve ser registrada: ${JSON.stringify(g.corpo)}`);
    assert.equal(g.corpo.garcom_id, c.corpo.garcom_id, 'gorjeta credita ao garçom da comanda');

    const depois = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(depois.corpo.totais.total_centavos, 600, 'gorjeta NÃO entra no total da venda');
    assert.equal(depois.corpo.totais.saldo_centavos, 600, 'saldo continua exatamente a conta');
    assert.equal(depois.corpo.totais.gorjeta_centavos, 100, 'gorjeta fica registrada à parte');

    // A conta fecha pagando só os 600 da venda.
    await quitar(s, c.corpo.id, 'sp7-p1');
  } finally { await sv.fechar(); }
});

test('SP-008: comissões por garçom sobre gorjeta', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    await s.adminCli.put('/config', { comissao_pct: '10' });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/gorjeta`, { valor_centavos: 500, forma: 'dinheiro' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/gorjeta`, { valor_centavos: 300, forma: 'pix' });
    // Fecha a venda para que o "vendido" apareça no relatório.
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'sp8-p1' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/fechar`, {});

    const rel = await s.adminCli.get('/salao/comissoes');
    assert.equal(rel.status, 200);
    assert.equal(rel.corpo.comissao_pct, 10);
    const linha = rel.corpo.por_garcom.find((g) => g.garcom_nome === 'Joana');
    assert.ok(linha, 'garçom deve aparecer no relatório');
    assert.equal(linha.gorjeta_centavos, 800);
    assert.equal(linha.gorjeta_ocorrencias, 2);
    assert.equal(linha.comissao_centavos, 80, '10% de 800 = 80');
    assert.equal(linha.vendido_centavos, 600);
  } finally { await sv.fechar(); }
});

test('SP-009: layout do salão persiste e o mapa ordena/mede as mesas', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const r = await s.adminCli.put('/salao/layout', {
      mesas: [
        { id: s.mesas.m1.id, pos_x: 10, pos_y: 20, largura: 150, altura: 150, formato: 'redonda', assentos: 6 },
        { id: s.mesas.m2.id, pos_x: 300, pos_y: 20, largura: 100, altura: 100, formato: 'retangular', assentos: 2 },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.salvas, 2);

    const mapa = await s.garcomCli.get('/salao/mapa');
    assert.ok(mapa.corpo.largura > 0 && mapa.corpo.altura > 0, 'mapa informa dimensões do salão');
    const m1 = mapa.corpo.mesas.find((m) => m.id === s.mesas.m1.id);
    assert.equal(m1.pos_x, 10);
    assert.equal(m1.pos_y, 20);
    assert.equal(m1.formato, 'redonda');
    assert.equal(m1.assentos, 6);
    assert.equal(m1.ociosa, false, 'mesa livre recém-criada não é ociosa');
    assert.equal(m1.rotulo, 'Mesa 1');
  } finally { await sv.fechar(); }
});

test('SP-010: nomenclatura "comanda" renomeia os rótulos do mapa', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    let mapa = await s.garcomCli.get('/salao/mapa');
    assert.equal(mapa.corpo.nomenclatura, 'mesa');
    assert.equal(mapa.corpo.mesas[0].rotulo, 'Mesa 1');

    await s.adminCli.put('/config', { nomenclatura_pedido: 'comanda' });
    mapa = await s.garcomCli.get('/salao/mapa');
    assert.equal(mapa.corpo.nomenclatura, 'comanda');
    assert.equal(mapa.corpo.mesas[0].rotulo, 'Comanda 1');
  } finally { await sv.fechar(); }
});

test('SP-011: mesa ociosa é destacada após o limite configurado', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.put('/config', { mesa_ociosa_minutos: '1' });
    const mesa = s.mesas.m1.id;
    const c = await s.garcomCli.post(`/mesas/${mesa}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 });
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    await quitar(s, c.corpo.id, 'sp11-p1');

    // Recua o início da ociosidade para simular mesa parada há 1 hora.
    const antigo = new Date(Date.now() - 3600_000).toISOString();
    sv.db.prepare('UPDATE mesas SET ociosa_desde = ? WHERE id = ?').run(antigo, mesa);

    const mapa = await s.garcomCli.get('/salao/mapa');
    const m1 = mapa.corpo.mesas.find((m) => m.id === mesa);
    assert.equal(m1.status, 'livre');
    assert.equal(m1.ociosa, true, 'mesa livre há mais de 1 min deve ser marcada ociosa');
    assert.ok(m1.minutos_parada >= 59);
  } finally { await sv.fechar(); }
});

test('SP-012: transferência move comandas e libera a mesa de origem', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const a = s.mesas.m1.id, b = s.mesas.m2.id;
    const c = await s.garcomCli.post(`/mesas/${a}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 2 });

    const r = await s.adminCli.post('/salao/transferir', { origem_id: a, destino_id: b, motivo: 'cliente mudou' });
    assert.equal(r.status, 200, `transferência deve funcionar: ${JSON.stringify(r.corpo)}`);
    assert.equal(r.corpo.comandas_movidas, 1);

    const mapa = await s.garcomCli.get('/salao/mapa');
    const ma = mapa.corpo.mesas.find((m) => m.id === a);
    const mb = mapa.corpo.mesas.find((m) => m.id === b);
    assert.equal(ma.status, 'livre', 'origem fica livre');
    assert.equal(ma.comandas_abertas, 0);
    assert.equal(mb.status, 'ocupada', 'destino fica ocupada');
    assert.equal(mb.comandas_abertas, 1);
    assert.equal(mb.total_aberto_centavos, 1200);

    const p = await s.caixaCli.get(`/pedidos/${c.corpo.id}`);
    assert.equal(p.corpo.mesa_id, b, 'comanda aponta para a mesa de destino');
  } finally { await sv.fechar(); }
});

test('SP-013: junção consolida comandas preservando cada conta', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // Terceira mesa para a operação.
    const m3 = await s.adminCli.post('/mesas', { numero: 3, setor: 'salao' });
    const a = s.mesas.m1.id, b = s.mesas.m2.id, c3 = m3.corpo.id;

    const cA = await s.garcomCli.post(`/mesas/${a}/comanda`, { cliente: 'Ana' });
    const cB = await s.garcomCli.post(`/mesas/${b}/comanda`, { cliente: 'Bruno' });
    await s.caixaCli.post(`/pedidos/${cA.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 2 }); // 1200
    await s.caixaCli.post(`/pedidos/${cB.corpo.id}/itens`, { produto_id: s.produtos.batata.id, quantidade: 1 }); // 1500

    const r = await s.adminCli.post('/salao/juntar', { mesa_ids: [a, b, c3], destino_id: a, motivo: 'juntaram as mesas' });
    assert.equal(r.status, 200, `junção deve funcionar: ${JSON.stringify(r.corpo)}`);
    assert.equal(r.corpo.comandas_movidas, 1, 'só as comandas das outras mesas são movidas');

    const mapa = await s.garcomCli.get('/salao/mapa');
    const ma = mapa.corpo.mesas.find((m) => m.id === a);
    assert.equal(ma.comandas_abertas, 2, 'destino fica com as 2 comandas');
    assert.equal(ma.total_abento ?? ma.total_aberto_centavos, 2700, 'soma 1200 + 1500');
    assert.equal(mapa.corpo.mesas.find((m) => m.id === b).status, 'livre');
    assert.equal(mapa.corpo.mesas.find((m) => m.id === c3).status, 'livre');

    // As contas continuam SEPARADAS (não fundidas): cada uma fecha sozinha.
    const d = await s.garcomCli.get(`/salao/mesas/${a}`);
    assert.equal(d.corpo.comandas.length, 2);
    assert.deepEqual(d.corpo.comandas.map((x) => x.comanda_nome).sort(), ['Ana', 'Bruno']);
  } finally { await sv.fechar(); }
});

test('SP-014: check-in cria cliente, bloqueia documento duplicado e vincula à comanda', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const cli = await s.caixaCli.post('/clientes', { nome: 'Maria Souza', documento: '12345678900', telefone: '99999' });
    assert.equal(cli.status, 201);
    assert.equal(cli.corpo.nome, 'Maria Souza');

    const dup = await s.caixaCli.post('/clientes', { nome: 'Outra', documento: '12345678900' });
    assert.equal(dup.status, 409, 'documento duplicado é barrado');

    const busca = await s.caixaCli.get('/clientes?q=mar');
    assert.equal(busca.corpo.length, 1);
    assert.equal(busca.corpo[0].nome, 'Maria Souza');

    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Maria', cliente_id: cli.corpo.id });
    assert.equal(c.corpo.cliente_id, cli.corpo.id, 'comanda guarda o vínculo do cliente');

    const det = await s.garcomCli.get(`/salao/mesas/${s.mesas.m1.id}`);
    assert.equal(det.corpo.comandas[0].cliente_nome, 'Maria Souza');
  } finally { await sv.fechar(); }
});

test('SP-015: atendente pode ser revinculado e é assumido automaticamente', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    // Sem atendente explícito, assume quem abriu a comanda.
    assert.equal(c.corpo.atendente_id, c.corpo.garcom_id, 'atendente padrão = garçom que abriu');

    const novo = await s.adminCli.post('/usuarios', { nome: 'Garcom2', cargo: 'garcom', pin: '5555' });
    const r = await s.garcomCli.post(`/pedidos/${c.corpo.id}/atendente`, { atendente_id: novo.corpo.id });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.atendente_nome, 'Garcom2');
  } finally { await sv.fechar(); }
});

test('SP-016: garçom sem permissão de check-in é bloqueado', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // Garante que a flag está desligada para o cargo garçom.
    const matriz = {
      garcom: { pode_fazer_checkin: 0 },
    };
    await s.adminCli.put('/permissoes', { matriz });
    const r = await s.garcomCli.post('/clientes', { nome: 'Nao Permitido' });
    assert.equal(r.status, 403);
  } finally { await sv.fechar(); }
});

test('SP-017: comanda fecha, a taxa some do histórico e a conciliação bate', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    await s.adminCli.put('/config', { taxa_servico_modo: 'percentual', taxa_servico_pct: '10' });
    const c = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    await s.caixaCli.post(`/pedidos/${c.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 3 }); // 7500 + 750

    const f = await quitar(s, c.corpo.id, 'sp17-p1');
    assert.equal(f.total_fechado_centavos, 8250, 'total fechado inclui a taxa');
    assert.equal(f.totais.taxa_servico_centavos, 750);

    // Validação de quitação: soma dos pagamentos === total.
    const v = await s.caixaCli.get(`/pedidos/${c.corpo.id}/validacao`);
    assert.deepEqual(v.corpo.problemas, [], `sem problemas: ${JSON.stringify(v.corpo.problemas)}`);
    assert.equal(v.corpo.soma_centavos, 8250);
  } finally { await sv.fechar(); }
});

test('SP-018: criação em lote — quantidade de uma vez, numeradas em sequência e lado a lado', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // seed já criou mesas 1 e 2 (posição automática da grade)
    const lote = await s.adminCli.post('/mesas', { quantidade: 8, setor: 'salao', assentos: 2 });
    assert.equal(lote.status, 201);
    assert.equal(lote.corpo.criadas, 8);
    // numeração automática: continua do último (2) → 3..10
    const numeros = lote.corpo.mesas.map((x) => x.numero);
    assert.deepEqual(numeros, [3, 4, 5, 6, 7, 8, 9, 10]);
    // compatibilidade: campos da 1ª mesa na raiz da resposta
    assert.equal(lote.corpo.numero, 3);
    assert.ok(lote.corpo.id);

    // posições LADO A LADO: nenhuma dupla de mesas sobrepõe a outra
    const mapa = await s.adminCli.get('/salao/mapa');
    const todas = mapa.corpo.mesas.map((m) => ({
      x1: m.pos_x, y1: m.pos_y, x2: m.pos_x + m.largura, y2: m.pos_y + m.altura, numero: m.numero,
    }));
    assert.equal(todas.length, 10);
    const colide = (a, b) => a.x1 < b.x2 + 20 && a.x2 + 20 > b.x1 && a.y1 < b.y2 + 20 && a.y2 + 20 > b.y1;
    for (let i = 0; i < todas.length; i++) {
      for (let j = i + 1; j < todas.length; j++) {
        assert.ok(!colide(todas[i], todas[j]),
          `mesas ${todas[i].numero} e ${todas[j].numero} não podem ocupar o mesmo lugar`);
      }
    }
    // assentos aplicados ao lote
    const doLote = todas.filter((m) => m.numero >= 3 && m.numero <= 10);
    const linha = await sv.db.prepare('SELECT assentos FROM mesas WHERE numero = 3').get();
    assert.equal(linha.assentos, 2);

    // numeração explícita a partir do 50
    const lote2 = await s.adminCli.post('/mesas', { quantidade: 3, numero: 50 });
    assert.equal(lote2.status, 201);
    assert.deepEqual(lote2.corpo.mesas.map((x) => x.numero), [50, 51, 52]);

    // número existente no meio do lote → conflito e nada é criado (transação)
    const conflito = await s.adminCli.post('/mesas', { quantidade: 3, numero: 9 });
    assert.equal(conflito.status, 409);
    const totalApos = sv.db.prepare('SELECT COUNT(*) AS n FROM mesas').get().n;
    assert.equal(totalApos, 13, 'lote com conflito não cria mesa nenhuma');

    // garçom não cria mesa (permissão de gerenciar mesas)
    const negado = await s.garcomCli.post('/mesas', { quantidade: 1 });
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});