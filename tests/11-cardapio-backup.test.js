// Testes de backup/upload de cardápio e export/import de backup do sistema
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, cliente, semear } from './helpers.js';

test('CB-001: exportação de cardápio com estrutura completa', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.post(`/produtos/${s.produtos.xburger.id}/variacoes`, { grupo: 'tamanho', nome: 'G', delta_centavos: 100 });
    const exp = await s.adminCli.get('/cardapio/exportar');
    assert.equal(exp.status, 200);
    assert.equal(exp.corpo.formato, 'lanchonete-pro-cardapio');
    assert.equal(exp.corpo.versao, 1);
    assert.ok(exp.corpo.categorias.length >= 2);
    assert.ok(exp.corpo.produtos.length >= 3);
    const xb = exp.corpo.produtos.find((p) => p.nome === 'X-Burger');
    assert.equal(xb.variacoes.length, 1);
    assert.ok(Array.isArray(xb.ficha));
    const negado = await s.caixaCli.get('/cardapio/exportar');
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('CB-002: importação restaura cardápio em banco limpo (round-trip)', async () => {
  const sv1 = await iniciarServidorTeste();
  const sv2 = await iniciarServidorTeste();
  try {
    const s1 = await semear(sv1);
    await s1.adminCli.post(`/produtos/${s1.produtos.xburger.id}/variacoes`, { grupo: 'tamanho', nome: 'G', delta_centavos: 100 });
    await s1.adminCli.post('/combos', {
      nome: 'Combo CB', tipo: 'preco_fixo', preco_fixo_centavos: 3000, exige_estoque: 0,
      itens: [{ produto_id: s1.produtos.xburger.id, quantidade: 1, obrigatorio: 1 }],
    });
    const exp = await s1.adminCli.get('/cardapio/exportar');
    const s2 = await semear(sv2);
    const imp = await s2.adminCli.post('/cardapio/importar', { cardapio: exp.corpo });
    assert.equal(imp.status, 200);
    assert.ok(imp.corpo.produtos_criados + imp.corpo.produtos_atualizados >= 3, JSON.stringify(imp.corpo));
    assert.equal(imp.corpo.combos, 1);
    // confere preços e variação no destino
    const cat2 = await s2.adminCli.get('/catalogo');
    const xb2 = cat2.corpo.produtos.find((p) => p.nome === 'X-Burger');
    assert.equal(xb2.preco_centavos, 2500);
    assert.equal(xb2.variacoes.length, 1);
    assert.equal(xb2.variacoes[0].nome, 'G');
    // combo importado funciona de verdade
    const combo2 = (await s2.adminCli.get('/combos')).corpo.find((c) => c.nome === 'Combo CB');
    assert.ok(combo2);
    await s2.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s2.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: xb2.id, quantidade: 1 }] }, { idem: 'cb-rt-1' });
    const ap = await s2.caixaCli.post(`/pedidos/${v.corpo.id}/aplicar-combo`, { combo_id: combo2.id }, { idem: 'cb-rt-1a' });
    assert.equal(ap.status, 201);
    // backup automático foi feito antes da importação
    const lista = await s2.adminCli.get('/backups');
    assert.ok(lista.corpo.historico.some((h) => h.motivo === 'antes-importar-cardapio'), 'backup pré-importação registrado');
    // inválidos
    const ruim1 = await s2.adminCli.post('/cardapio/importar', { cardapio: { formato: 'outro', versao: 1 } });
    assert.equal(ruim1.status, 422);
    const ruim2 = await s2.adminCli.post('/cardapio/importar', { cardapio: { formato: 'lanchonete-pro-cardapio', versao: 1, categorias: [], produtos: [{ nome: 'X' }] } });
    assert.equal(ruim2.status, 422);
    const negado = await s2.caixaCli.post('/cardapio/importar', { cardapio: exp.corpo });
    assert.equal(negado.status, 403);
  } finally { await sv1.fechar(); await sv2.fechar(); }
});

test('CB-003: download de backup com anti-traversal; upload validado', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const bk = await s.adminCli.post('/backups', {});
    assert.equal(bk.status, 201);
    // download: usa fetch cru (não é JSON)
    const dl = await fetch(`http://127.0.0.1:${sv.porta}/api/backups/download/${bk.corpo.arquivo}`, {
      headers: { Cookie: `lp_session=${encodeURIComponent(s.adminCli._cookie().replace(/^lp_session=/, ''))}`, 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.equal(dl.status, 200);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(buf.subarray(0, 6).toString('ascii'), 'SQLite');
    // traversal bloqueado
    const trav = await s.adminCli.get('/backups/download/..%2Fpackage.json');
    assert.ok([404, 422].includes(trav.status));
    const trav2 = await s.adminCli.get('/backups/download/lanchonete-fake.sqlite');
    assert.ok([404, 422].includes(trav2.status), 'inexistente bloqueado');
    const negado = await s.caixaCli.get(`/backups/download/${bk.corpo.arquivo}`);
    assert.equal(negado.status, 403);
    // upload: lixo rejeitado
    const lixo = await s.adminCli.post('/backups/upload', { nome: 'lanchonete-x.sqlite', conteudo_base64: Buffer.from('nao-e-sqlite').toString('base64') });
    assert.equal(lixo.status, 422);
    const travUp = await s.adminCli.post('/backups/upload', { nome: '../evil.sqlite', conteudo_base64: buf.toString('base64') });
    assert.equal(travUp.status, 422);
    // upload válido (round-trip do próprio download)
    const up = await s.adminCli.post('/backups/upload', { nome: bk.corpo.arquivo.replace('.sqlite', '-copia.sqlite'), conteudo_base64: buf.toString('base64') });
    assert.equal(up.status, 201);
    assert.equal(up.corpo.integrity, 'ok');
    const lista = await s.adminCli.get('/backups');
    assert.ok(lista.corpo.backups.some((b) => b.arquivo.includes('copia')));
  } finally { await sv.fechar(); }
});
