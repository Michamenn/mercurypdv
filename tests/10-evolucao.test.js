// Testes da evolução PDV (navegação, logo, janela promocional, matriz, desbloqueio)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear } from './helpers.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('EV-001: posição padrão da navegação é configurável (admin)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ruim = await s.adminCli.put('/config', { nav_posicao_padrao: 'inferior' });
    assert.equal(ruim.status, 422);
    const ok = await s.adminCli.put('/config', { nav_posicao_padrao: 'superior' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.nav_posicao_padrao, 'superior');
    const me = await s.caixaCli.get('/auth/me');
    assert.equal(me.corpo.config_publica.nav_posicao_padrao, 'superior');
    const negado = await s.caixaCli.put('/config', { nav_posicao_padrao: 'lateral' });
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('EV-002: upload de logo com validação real de conteúdo', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const negado = await s.caixaCli.post('/config/logo', { imagem_data_url: PNG_1PX });
    assert.equal(negado.status, 403);
    const falso = await s.adminCli.post('/config/logo', { imagem_data_url: 'data:image/png;base64,aGVsbG8=' });
    assert.equal(falso.status, 422, 'texto dizendo ser PNG é rejeitado (magic bytes)');
    const gif = await s.adminCli.post('/config/logo', { imagem_data_url: 'data:image/gif;base64,R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=' });
    assert.equal(gif.status, 422, 'GIF não permitido');
    const ok = await s.adminCli.post('/config/logo', { imagem_data_url: PNG_1PX });
    assert.equal(ok.status, 201);
    assert.match(ok.corpo.logo_path, /^uploads\/logo-[a-f0-9]{16}\.png$/);
    const st = await s.adminCli.get('/auth/status');
    assert.equal(st.corpo.logo_path, ok.corpo.logo_path);
    const del = await s.adminCli.delete('/config/logo');
    assert.equal(del.status, 200);
    assert.equal(del.corpo.logo_path, '');
  } finally { await sv.fechar(); }
});

test('EV-003: promoção respeita janela dia/horário e limite de usos', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    // só amanhã
    const amanha = (new Date().getDay() + 1) % 7;
    const cDia = await s.adminCli.post('/combos', {
      nome: `Janela dia ${Date.now()}`, tipo: 'desconto_percentual', desconto_percentual: 10,
      exige_estoque: 0, dias_semana: String(amanha),
      itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 1 }],
    });
    assert.equal(cDia.status, 201);
    const p = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: 'ev-w1' });
    const fora = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: cDia.corpo.id }, { idem: 'ev-w1a' });
    assert.equal(fora.status, 422);
    const vig = await s.caixaCli.get('/combos/vigentes');
    assert.ok(!vig.corpo.combos.some((c) => c.id === cDia.corpo.id), 'fora da janela não aparece');
    // janela horária fora do agora (+2h/+3h, sem wrap)
    const agoraH = new Date().getHours();
    let ini = agoraH + 2, fim = agoraH + 3;
    if (fim >= 24) { ini = agoraH - 3; fim = agoraH - 2; }
    const pad = (h) => `${String(h).padStart(2, '0')}:00`;
    const cHora = await s.adminCli.post('/combos', {
      nome: `Janela hora ${Date.now()}`, tipo: 'desconto_percentual', desconto_percentual: 10,
      exige_estoque: 0, hora_ini: pad(ini), hora_fim: pad(fim),
      itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 1 }],
    });
    const fora2 = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: cHora.corpo.id }, { idem: 'ev-w1b' });
    assert.equal(fora2.status, 422);
    // limite de usos = 1
    const cLim = await s.adminCli.post('/combos', {
      nome: `Limite ${Date.now()}`, tipo: 'desconto_percentual', desconto_percentual: 10,
      exige_estoque: 0, limite_usos: 1,
      itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 1 }],
    });
    const a1 = await s.caixaCli.post(`/pedidos/${p.corpo.id}/aplicar-combo`, { combo_id: cLim.corpo.id }, { idem: 'ev-w1c' });
    assert.equal(a1.status, 201);
    const p2 = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.batata.id, quantidade: 1 }] }, { idem: 'ev-w2' });
    const a2 = await s.caixaCli.post(`/pedidos/${p2.corpo.id}/aplicar-combo`, { combo_id: cLim.corpo.id }, { idem: 'ev-w2a' });
    assert.equal(a2.status, 422, 'limite esgotado bloqueia');
    assert.match(a2.corpo.erro, /Limite/);
    // inválidos
    const ruim = await s.adminCli.post('/combos', {
      nome: `Ruim ${Date.now()}`, tipo: 'desconto_percentual', desconto_percentual: 10,
      exige_estoque: 0, dias_semana: '7',
      itens: [{ produto_id: s.produtos.refri.id, quantidade: 1, obrigatorio: 1 }],
    });
    assert.equal(ruim.status, 422);
  } finally { await sv.fechar(); }
});

test('EV-004: matriz de permissões editável com trava anti-bloqueio', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const negado = await s.caixaCli.get('/permissoes');
    assert.equal(negado.status, 403);
    const m = await s.adminCli.get('/permissoes');
    assert.equal(m.status, 200);
    assert.equal(m.corpo.flags.length, 4);
    assert.ok(m.corpo.rotulos.pode_vender_balcao);
    // remove venda do caixa → venda bloqueia na hora (sem restart)
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const antes = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'ev-m1' });
    assert.equal(antes.status, 201);
    const salva = await s.adminCli.put('/permissoes', { matriz: { caixa: { pode_vender_balcao: 0 } } });
    assert.equal(salva.status, 200);
    assert.equal(salva.corpo.flags.find((f) => f.cargo === 'caixa').pode_vender_balcao, 0);
    const depois = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'ev-m2' });
    assert.equal(depois.status, 403, 'permissão revogada vale imediatamente');
    // restaura
    await s.adminCli.put('/permissoes', { matriz: { caixa: { pode_vender_balcao: 1 } } });
    // trava: admin não perde config nem usuários
    const trava1 = await s.adminCli.put('/permissoes', { matriz: { admin: { pode_config_sistema: 0 } } });
    assert.equal(trava1.status, 422);
    const trava2 = await s.adminCli.put('/permissoes', { matriz: { admin: { pode_gerenciar_usuarios: 0 } } });
    assert.equal(trava2.status, 422);
    const invalido = await s.adminCli.put('/permissoes', { matriz: { caixa: { pode_vender_balcao: 2 } } });
    assert.equal(invalido.status, 422);
  } finally { await sv.fechar(); }
});

test('EV-005: desbloquear funcionário zera bloqueio e libera login', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // cria vítima com PIN
    const novo = await s.adminCli.post('/usuarios', { nome: 'Vitima', cargo: 'caixa', pin: '5555' });
    for (let i = 0; i < 5; i++) {
      const c = (await import('./helpers.js')).cliente(sv.porta);
      await c.post('/auth/login', { usuario: 'Vitima', pin: '0000' });
    }
    const bloqueado = (await import('./helpers.js')).cliente(sv.porta);
    const tentativa = await bloqueado.post('/auth/login', { usuario: 'Vitima', pin: '5555' });
    assert.equal(tentativa.status, 429);
    const lista = await s.adminCli.get('/usuarios');
    const vit = lista.corpo.find((u) => u.nome === 'Vitima');
    assert.ok(vit.falhas_login >= 5);
    const negado = await s.caixaCli.post(`/usuarios/${novo.corpo.id}/desbloquear`, {});
    assert.equal(negado.status, 403);
    const ok = await s.adminCli.post(`/usuarios/${novo.corpo.id}/desbloquear`, {});
    assert.equal(ok.status, 200);
    const depois = (await import('./helpers.js')).cliente(sv.porta);
    const login = await depois.post('/auth/login', { usuario: 'Vitima', pin: '5555' });
    assert.equal(login.status, 200);
  } finally { await sv.fechar(); }
});

test('EV-006: fiação frontend (nav flutuante, mobile, logo)', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');
  const app = ler('public/js/app.js');
  assert.ok(app.includes('nav-flutuante'), 'nav flutuante renderizada');
  assert.ok(app.includes('data-nav='), 'posição aplicada via data-nav');
  assert.ok(app.includes('temAcesso'), 'visibilidade por permissão (permOu)');
  assert.ok(app.includes('autoOcultar'), 'opção de ocultar menu lateral');
  assert.ok(app.includes('data-auto='), 'modo auto aplicado no layout');
  assert.ok(app.includes("id: 'mobile'"), 'rota mobile registrada');
  const css = ler('public/css/app.css');
  assert.ok(css.includes('.nav-flutuante'), 'estilos da nav');
  assert.ok(css.includes('[data-auto="1"]'), 'estilos do auto-ocultar');
  assert.ok(css.includes('.card-produto'), 'cards mobile');
  const mobile = ler('public/js/views/mobile.js');
  assert.ok(mobile.includes('/pedidos/balcao'), 'mobile cria venda');
  assert.ok(mobile.includes('Idempotency') || mobile.includes('novaIdempotencia'), 'mobile idempotente');
  const login = ler('public/js/views/login.js');
  assert.ok(login.includes('logo_path'), 'login exibe logo');
  const sw = ler('public/sw.js');
  assert.ok(sw.includes('/js/views/mobile.js'), 'sw cacheia mobile.js');
  const admin = ler('public/js/views/admin.js');
  assert.ok(admin.includes('/config/logo'), 'config faz upload de logo');
  assert.ok(admin.includes('/permissoes'), 'admin edita matriz');
});
