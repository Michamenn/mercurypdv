// Testes de fechamento íntegro: validação final, divisão exata, troco exato
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear } from './helpers.js';

test('PDV-010: fechar bloqueia pagamento adulterado mesmo com saldo zero', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'hz-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 600 }, { idem: 'hz-1p' });
    // adultera o troco direto no banco (simula corrupção/edição externa)
    sv.db.prepare(`UPDATE pagamentos SET troco_centavos = 100 WHERE pedido_id = ?`).run(v.corpo.id);
    const val = await s.caixaCli.get(`/pedidos/${v.corpo.id}/validacao`);
    assert.equal(val.status, 200);
    assert.ok(val.corpo.problemas.length > 0, 'validação aponta a inconsistência');
    assert.match(val.corpo.problemas.join(';'), /troco/);
    const fecho = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 409);
    assert.equal(fecho.corpo.codigo, '409_VALORES_INCONSISTENTES');
    // corrige e fecha normalmente
    sv.db.prepare(`UPDATE pagamentos SET troco_centavos = 0 WHERE pedido_id = ?`).run(v.corpo.id);
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
  } finally { await sv.fechar(); }
});

test('PDV-011: divisão por pessoas só fecha com soma exata', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // total 1000 em 3 partes: 334 + 333 + 333
    const v = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }, { produto_id: s.produtos.refri.id, quantidade: 1 }] },
      { idem: 'hz-2' });
    // 1500 + 600 = 2100; partes: 700 + 700 + 700
    assert.equal(v.corpo.totais.total_centavos, 2100);
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 700, recebido_centavos: 700 }, { idem: 'hz-2a' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 700 }, { idem: 'hz-2b' });
    const antes = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(antes.status, 409, 'falta 700: não fecha');
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'cartao_credito', valor_centavos: 700 }, { idem: 'hz-2c' });
    const ok = await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});
    assert.equal(ok.status, 200);
    // troco exato: dinheiro recebido == valor → troco 0
    const pg = sv.db.prepare(`SELECT troco_centavos FROM pagamentos WHERE idempotency_key = 'hz-2a'`).get();
    assert.equal(pg.troco_centavos, 0);
  } finally { await sv.fechar(); }
});

test('PDV-012: UI com Finalizar, Dividir e Troco exato', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pdv = fs.readFileSync(path.join(raiz, 'public/js/views/pdv.js'), 'utf8');
  assert.ok(pdv.includes('Finalizar'), 'botão Vender virou Finalizar');
  assert.ok(!pdv.includes('>Vender<') && !pdv.includes('F2 vender'), 'sem restos do rótulo antigo');
  assert.ok(pdv.includes('data-a="dividir"'), 'botão Dividir por pessoas');
  assert.ok(pdv.includes('Math.floor(total / n)'), 'rateio em centavos exatos');
  assert.ok(pdv.includes('Troco exato'), 'atalho de troco exato no recebido');
  assert.ok(pdv.includes('res-falta') && pdv.includes('res-pago') && pdv.includes('res-estado'), 'resumo Total/Pago/Falta');
  assert.ok(pdv.includes('/validacao'), 'conferência final antes de fechar');
  const caixa = fs.readFileSync(path.join(raiz, 'public/js/views/caixa.js'), 'utf8');
  assert.ok(caixa.includes('FALTAM') && caixa.includes('a venda NÃO fecha'), 'caixa exibe faltante e trava botão');
  const ui = fs.readFileSync(path.join(raiz, 'public/js/ui.js'), 'utf8');
  assert.ok(ui.includes('acaoExtra'), 'numpad suporta botão de atalho');
});
