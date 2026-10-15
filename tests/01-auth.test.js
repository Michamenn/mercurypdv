// Testes de autenticação, sessão e segurança (requisitos AUTH-*, RBAC-*)
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, cliente, semear, tokenDe } from './helpers.js';

test('AUTH-001: setup cria 1º admin e fecha para sempre; credenciais nunca em texto puro', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const c = cliente(sv.porta);
    const r = await c.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123', pin: '1234' });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.usuario.cargo, 'admin');

    const r2 = await c.post('/auth/setup', { nome: 'Outro', senha: 'SenhaForte456' });
    assert.equal(r2.status, 403); // setup fechado após 1º usuário (AUTH-005)

    // sem credencial em texto puro no banco
    const linhas = sv.db.prepare('SELECT nome, pin_hash, senha_hash FROM usuarios').all();
    for (const u of linhas) {
      assert.ok(!u.senha_hash || u.senha_hash.startsWith('scrypt$'), 'senha hasheada');
      assert.ok(!u.pin_hash || u.pin_hash.startsWith('scrypt$'), 'pin hasheado');
      const bruto = JSON.stringify(u);
      assert.ok(!bruto.includes('SenhaForte123'), 'senha não aparece em claro');
      assert.ok(!bruto.includes('1234"'), 'pin não aparece em claro');
    }
  } finally { await sv.fechar(); }
});

test('AUTH-002: login válido/inválido; rate limit progressivo bloqueia força bruta', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const c = cliente(sv.porta);
    await c.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123', pin: '1234' });

    const ok = await c.post('/auth/login', { usuario: 'Dono', pin: '1234' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.usuario.cargo, 'admin');
    assert.ok(ok.corpo.permissoes.pode_vender_balcao === 1);

    c.trocarUsuario();
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/auth/login', { usuario: 'Dono', pin: '9999' });
      assert.equal(r.status, 401);
      c.trocarUsuario();
    }
    const bloqueado = await c.post('/auth/login', { usuario: 'Dono', pin: '1234' });
    assert.equal(bloqueado.status, 429); // PIN correto, mas usuário bloqueado (AUTH-003)
    assert.ok(bloqueado.corpo.bloqueado_ate);
  } finally { await sv.fechar(); }
});

test('AUTH-003: CSRF — mutação sem X-Requested-With é rejeitada', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const c = cliente(sv.porta);
    await c.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123' });
    await c.post('/auth/login', { usuario: 'Dono', senha: 'SenhaForte123' });
    c.trocarUsuario();
    const c2 = cliente(sv.porta);
    await c2.post('/auth/login', { usuario: 'Dono', senha: 'SenhaForte123' });
    const r = await c2.post('/categorias', { nome: 'SemCSRF' }, { semCsrf: true });
    assert.equal(r.status, 403);
  } finally { await sv.fechar(); }
});

test('AUTH-004: logout revoga a sessão no servidor (cookie não serve mais)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const c = cliente(sv.porta);
    await c.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123' });
    await c.post('/auth/login', { usuario: 'Dono', senha: 'SenhaForte123' });
    const antes = await c.get('/auth/me');
    assert.equal(antes.status, 200);
    await c.post('/auth/logout', {});
    const depois = await c.get('/auth/me');
    assert.equal(depois.status, 401);
  } finally { await sv.fechar(); }
});

test('AUTH-005: sessão inexistente/manipulada → 401; token não é armazenado em claro', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const c = cliente(sv.porta);
    await c.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123' });
    await c.post('/auth/login', { usuario: 'Dono', senha: 'SenhaForte123' });
    const hashes = sv.db.prepare('SELECT token_hash FROM sessoes').all();
    assert.ok(hashes.length >= 1);
    const token = tokenDe(c);
    assert.ok(token);
    for (const h of hashes) assert.ok(!h.token_hash.includes(token), 'token só existe hasheado (sha256)');
    const r = await fetch(`http://127.0.0.1:${sv.porta}/api/auth/me`, { headers: { Cookie: 'lp_session=TOKENFALSO' } });
    assert.equal(r.status, 401);
  } finally { await sv.fechar(); }
});

test('RBAC-001/002: tentativas de contorno direto na API por cargo', async (t) => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    await t.test('garçom não acessa relatórios nem cria produto (URL não concede poder - BR-009)', async () => {
      const r1 = await s.garcomCli.get('/relatorios/resumo?de=2026-01-01&ate=2026-12-31');
      assert.equal(r1.status, 403);
      const r2 = await s.garcomCli.post('/produtos', { nome: 'Hack', categoria_id: 1, preco_centavos: 1 });
      assert.equal(r2.status, 403);
      const r3 = await s.garcomCli.get('/usuarios');
      assert.equal(r3.status, 403);
      const r4 = await s.garcomCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
      assert.equal(r4.status, 403);
    });

    await t.test('caixa não altera preço/produto nem vê auditoria', async () => {
      const r1 = await s.caixaCli.put(`/produtos/${s.produtos.xburger.id}`, { nome: 'X-Burger', categoria_id: 1, preco_centavos: 1 });
      assert.equal(r1.status, 403);
      const r2 = await s.caixaCli.get('/auditoria');
      assert.equal(r2.status, 403);
      const r3 = await s.caixaCli.post('/backups', {});
      assert.equal(r3.status, 403);
      const r4 = await s.caixaCli.post('/admin/dev', { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
      assert.equal(r4.status, 403); // mesmo com senha admin, cargo não tem pode_config_sistema
    });

    await t.test('cozinha não vende nem vê relatórios', async () => {
      const r1 = await s.cozinhaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] });
      assert.equal(r1.status, 403);
      const r2 = await s.cozinhaCli.get('/relatorios/resumo?de=2026-01-01&ate=2026-12-31');
      assert.equal(r2.status, 403);
      const r3 = await s.cozinhaCli.get('/kds');
      assert.equal(r3.status, 200); // cozinha vê o KDS
    });

    await t.test('desconto exige permissão (caixa bloqueado por padrão)', async () => {
      await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 10000 });
      const pedido = await s.caixaCli.post('/pedidos/balcao',
        { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'desconto-test-1' });
      assert.equal(pedido.status, 201);
      const r = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/desconto`, { valor_centavos: 100, motivo: 'teste' });
      assert.equal(r.status, 403);
      // admin pode
      const p2 = await s.adminCli.post(`/pedidos/${pedido.corpo.id}/desconto`, { valor_centavos: 100, motivo: 'cortesia' });
      assert.equal(p2.status, 200);
      assert.equal(p2.corpo.totais.desconto_centavos, 100);
      // admin não logado como admin também não: garçom
      const r3 = await s.garcomCli.post(`/pedidos/${pedido.corpo.id}/desconto`, { valor_centavos: 100, motivo: 'x' });
      assert.equal(r3.status, 403);
    });

    await t.test('step-up: sangria do caixa exige senha de admin válida', async () => {
      await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 50000 });
      const semAuth = await s.caixaCli.post('/caixa/movimentar', { tipo: 'sangria', forma: 'dinheiro', valor_centavos: 1000, motivo: 'reposição de troco' });
      assert.equal(semAuth.status, 403);
      const senhaErrada = await s.caixaCli.post('/caixa/movimentar', {
        tipo: 'sangria', forma: 'dinheiro', valor_centavos: 1000, motivo: 'reposição',
        admin_usuario: 'Dono', admin_senha: 'errada12345',
      });
      assert.equal(senhaErrada.status, 403);
      const comAuth = await s.caixaCli.post('/caixa/movimentar', {
        tipo: 'sangria', forma: 'dinheiro', valor_centavos: 1000, motivo: 'reposição de troco',
        admin_usuario: 'Dono', admin_senha: 'SenhaForte123',
      });
      assert.equal(comAuth.status, 201);
    });

    await t.test('admin dev painel exige step-up com senha correta (DIV-005)', async () => {
      const negado = await s.adminCli.post('/admin/dev', {});
      assert.equal(negado.status, 403);
      const ok = await s.adminCli.post('/admin/dev', { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
      assert.equal(ok.status, 200);
      assert.ok(ok.corpo.diagnostico.node.startsWith('v'));
    });

    await t.test('entrada malformada é validada (422) sem quebrar o servidor (TESTE 17)', async () => {
      const r1 = await s.adminCli.post('/produtos', { nome: '', categoria_id: 1, preco_centavos: -5 });
      assert.equal(r1.status, 422);
      const r2 = await s.caixaCli.post('/pedidos/balcao', { itens: 'não-sou-lista' });
      assert.equal(r2.status, 422);
      const r3 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: 99999, quantidade: 1 }] }, { idem: 'malform-1' });
      assert.equal(r3.status, 422);
      const r4 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 'MUITO' }] }, { idem: 'malform-2' });
      assert.equal(r4.status, 422);
      const r5 = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }], total_centavos: 1 }, { idem: 'malform-3' });
      assert.equal(r5.status, 201);
      assert.equal(r5.corpo.totais.total_centavos, 600); // total do cliente IGNORADO (RBAC-002)
    });
  } finally { await sv.fechar(); }
});
