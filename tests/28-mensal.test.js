// Compra Mensal (conta de clientes) — débitos, assinatura, quitação e parcelas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

// PNG 1x1 válido (magic bytes corretos) para os testes de assinatura.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataUrlPng = `data:image/png;base64,${PNG_1X1}`;

test('MENSAL-001: cadastrar cliente, campos opcionais, busca e RBAC', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const { adminCli, caixaCli, garcomCli } = await semear(sv);
    // Nome é o único obrigatório — o resto é opcional (pedido do dono).
    const c1 = await adminCli.post('/mensal/clientes', { nome: 'João da Silva' });
    assert.equal(c1.status, 201);
    assert.ok(/^CM-\d{4}$/.test(c1.corpo.codigo), 'código CM-NNNN gerado');
    assert.equal(c1.corpo.saldo_centavos, 0);
    const c2 = await adminCli.post('/mensal/clientes', {
      nome: 'Maria Souza', telefone: '11 91234-5678', email: 'maria@exemplo.com',
      endereco: 'Rua das Flores, 10', limite_centavos: 50000,
    });
    assert.equal(c2.status, 201);
    assert.equal(c2.corpo.limite_centavos, 50000);
    // Sem nome → 422
    const semNome = await adminCli.post('/mensal/clientes', { telefone: '123' });
    assert.equal(semNome.status, 422);
    // Busca por telefone e por código
    const buscaTel = await adminCli.get('/mensal/clientes?busca=91234');
    assert.equal(buscaTel.corpo.clientes.length, 1);
    const buscaCod = await adminCli.get(`/mensal/clientes?busca=${c1.corpo.codigo}`);
    assert.equal(buscaCod.corpo.clientes.length, 1);
    // RBAC: garçom NÃO vê o módulo (403); caixa opera (200)
    assert.equal((await garcomCli.get('/mensal/clientes')).status, 403);
    assert.equal((await caixaCli.get('/mensal/clientes')).status, 200);
  } finally { await sv.fechar(); }
});

test('MENSAL-002: lançar débito com assinatura, limite e bloqueio', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const { adminCli, caixaCli } = await semear(sv);
    const c = (await adminCli.post('/mensal/clientes', { nome: 'Carlos', limite_centavos: 10000 })).corpo;
    // Débito com assinatura PNG válida
    const l1 = await caixaCli.post(`/mensal/clientes/${c.id}/lancamentos`, {
      quantidade: 2, consumo: 'Almoço — prato feito', valor_centavos: 6000,
      data_hora: '2026-10-23T12:30', assinatura_data_url: dataUrlPng,
    });
    assert.equal(l1.status, 201);
    assert.ok(l1.corpo.lancamentos[0].assinatura_path.startsWith('uploads/assinatura-'));
    assert.equal(l1.corpo.cliente.saldo_centavos, 6000);
    // Assinatura inválida (JPEG declarado PNG / conteúdo falso) → 422, lançamento não criado
    const ruim = await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, {
      quantidade: 1, consumo: 'Teste', valor_centavos: 100, assinatura_data_url: 'data:image/png;base64,AAAA',
    });
    assert.equal(ruim.status, 422);
    // Limite: saldo 6000 + 5000 > 10000 → 409
    const estoura = await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, {
      quantidade: 1, consumo: 'Jantar', valor_centavos: 5000, data_hora: '2026-10-23T20:00',
    });
    assert.equal(estoura.status, 409);
    // Dentro do limite passa (6000 + 4000 = 10000, igual ao limite)
    const cabe = await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, {
      quantidade: 1, consumo: 'Jantar', valor_centavos: 4000,
    });
    assert.equal(cabe.status, 201);
    // Bloqueio impede novos débitos
    await adminCli.post(`/mensal/clientes/${c.id}/bloquear`, { bloquear: true });
    const bloqueado = await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, {
      quantidade: 1, consumo: 'Tentativa', valor_centavos: 100,
    });
    assert.equal(bloqueado.status, 409);
    assert.ok(bloqueado.corpo.erro.includes('bloqueado'), 'mensagem fala de bloqueio');
    await adminCli.post(`/mensal/clientes/${c.id}/bloquear`, { bloquear: false });
    // Consumo vazio → 422
    const semConsumo = await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, { quantidade: 1, consumo: '', valor_centavos: 100 });
    assert.equal(semConsumo.status, 422);
  } finally { await sv.fechar(); }
});

test('MENSAL-003: pagar parcial e total (com validações)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const { adminCli } = await semear(sv);
    const c = (await adminCli.post('/mensal/clientes', { nome: 'Débora' })).corpo;
    await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, { quantidade: 1, consumo: 'Conta do dia', valor_centavos: 15000 });
    // Sem dívida não deixa pagar
    const zero = (await adminCli.post('/mensal/clientes/9999/pagamentos', { valor_centavos: 100, forma: 'pix' }));
    assert.equal(zero.status, 404, 'cliente inexistente');
    // Parcial
    const p1 = await adminCli.post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: 5000, forma: 'pix' });
    assert.equal(p1.status, 201);
    assert.equal(p1.corpo.cliente.saldo_centavos, 10000);
    // Overpay → 422
    const over = await adminCli.post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: 99999, forma: 'dinheiro' });
    assert.equal(over.status, 422);
    // Forma inválida → 422
    const formaRuim = await adminCli.post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: 100, forma: 'cripto' });
    assert.equal(formaRuim.status, 422);
    // Quita o resto
    const p2 = await adminCli.post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: 10000, forma: 'dinheiro' });
    assert.equal(p2.corpo.cliente.saldo_centavos, 0);
    const deNovo = await adminCli.post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: 100, forma: 'pix' });
    assert.equal(deNovo.status, 409, 'sem saldo devedor');
  } finally { await sv.fechar(); }
});

test('MENSAL-004: parcelar o saldo e dar baixa parcela a parcela', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const { adminCli } = await semear(sv);
    const c = (await adminCli.post('/mensal/clientes', { nome: 'Eduardo' })).corpo;
    await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, { quantidade: 1, consumo: 'Festa', valor_centavos: 30000 });
    const par = await adminCli.post(`/mensal/clientes/${c.id}/parcelar`, { n: 3, primeira_vencimento: '2026-11-15' });
    assert.equal(par.status, 201);
    const pendentes = par.corpo.pagamentos.filter((p) => p.status === 'pendente');
    assert.equal(pendentes.length, 3);
    assert.equal(pendentes.reduce((s, p) => s + p.valor_centavos, 0), 30000, 'soma das parcelas = saldo');
    // Vencimentos mensais (30 dias entre cada) — a API devolve em ordem desc,
    // então a checagem é pelo conjunto ordenado, não pela posição.
    assert.deepEqual(pendentes.map((p) => p.vencimento).sort(), ['2026-11-15', '2026-12-15', '2027-01-14']);
    const acordoId = pendentes[0].parcela_de;
    assert.ok(pendentes.every((p) => p.parcela_de === acordoId), 'todas as parcelas pertencem ao mesmo acordo');
    // Saldo NÃO muda com o parcelamento (só com a baixa)
    assert.equal(par.corpo.cliente.saldo_centavos, 30000);
    assert.equal(par.corpo.cliente.a_receber_centavos, 30000);
    // Baixa a PRIMEIRA parcela do acordo (menor vencimento — ela carrega o id do acordo)
    const primeiraParcela = pendentes.find((p) => p.vencimento === '2026-11-15');
    assert.equal(primeiraParcela.parcela_de, primeiraParcela.id, 'acordo aponta para o primeiro registro');
    const baixa = await adminCli.post(`/mensal/pagamentos/${primeiraParcela.id}/confirmar`, {});
    assert.equal(baixa.status, 200);
    assert.equal(baixa.corpo.cliente.saldo_centavos, 20000);
    assert.equal(baixa.corpo.cliente.a_receber_centavos, 20000);
    // Baixa duplicada → 409
    const dupla = await adminCli.post(`/mensal/pagamentos/${primeiraParcela.id}/confirmar`, {});
    assert.equal(dupla.status, 409);
    // n fora da faixa → 422
    const nRuim = await adminCli.post(`/mensal/clientes/${c.id}/parcelar`, { n: 99 });
    assert.equal(nRuim.status, 422);
  } finally { await sv.fechar(); }
});

test('MENSAL-005: editar, bloquear via PUT/PATCH-semântica e excluir com histórico', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const { adminCli } = await semear(sv);
    const c = (await adminCli.post('/mensal/clientes', { nome: 'Felipa' })).corpo;
    await adminCli.post(`/mensal/clientes/${c.id}/lancamentos`, { quantidade: 1, consumo: 'Lanche', valor_centavos: 2000 });
    // Editar (PUT)
    const edit = await adminCli.put(`/mensal/clientes/${c.id}`, { nome: 'Felipa Ribeiro', telefone: '11 90000-0000' });
    assert.equal(edit.status, 200);
    assert.equal(edit.corpo.cliente.nome, 'Felipa Ribeiro');
    assert.equal(edit.corpo.cliente.telefone, '11 90000-0000');
    // Detalhe traz lançamentos e resumo
    const det = await adminCli.get(`/mensal/clientes/${c.id}`);
    assert.equal(det.corpo.lancamentos.length, 1);
    assert.equal(det.corpo.cliente.saldo_centavos, 2000);
    assert.equal((await adminCli.get('/mensal/clientes/9999')).status, 404);
    // Excluir remove tudo
    const del = await adminCli.delete(`/mensal/clientes/${c.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.corpo.lancamentos, 1);
    assert.equal((await adminCli.get('/mensal/clientes')).corpo.clientes.length, 0);
    assert.equal((await adminCli.get(`/mensal/clientes/${c.id}`)).status, 404);
  } finally { await sv.fechar(); }
});
