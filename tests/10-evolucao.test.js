// Testes da evolução PDV (navegação, logo, janela promocional, matriz, desbloqueio)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear, cliente } from './helpers.js';

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
    assert.equal(m.corpo.flags.length, 5);
    assert.ok(m.corpo.rotulos.pode_vender_balcao);
    // cargo novo "proprietario": todas as flags do admin, menos o painel dev
    const flagsAdmin = m.corpo.flags.find((f) => f.cargo === 'admin');
    const flagsProp = m.corpo.flags.find((f) => f.cargo === 'proprietario');
    assert.ok(flagsAdmin && flagsProp, 'admin e proprietário presentes na matriz');
    assert.equal(flagsAdmin.pode_painel_dev, 1);
    assert.equal(flagsProp.pode_painel_dev, 0);
    assert.equal(
      Object.keys(flagsProp).filter((k) => k.startsWith('pode_') && k !== 'pode_painel_dev')
        .every((k) => flagsProp[k] === 1),
      true, 'Proprietário tem todas as demais flags');
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
    // pode_painel_dev NÃO é editável pela matriz: Proprietário nunca escala, admin nunca perde
    const esc1 = await s.adminCli.put('/permissoes', { matriz: { proprietario: { pode_painel_dev: 1 } } });
    assert.equal(esc1.status, 200);
    assert.equal(esc1.corpo.flags.find((f) => f.cargo === 'proprietario').pode_painel_dev, 0,
      'Proprietário não escalou para o painel dev');
    const esc2 = await s.adminCli.put('/permissoes', { matriz: { admin: { pode_painel_dev: 0 } } });
    assert.equal(esc2.status, 200);
    assert.equal(esc2.corpo.flags.find((f) => f.cargo === 'admin').pode_painel_dev, 1,
      'admin manteve o painel dev');
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

test('EV-007: anti-escalada — só Administrador gerencia contas Administrador', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // admin cria o Proprietário e ele loga
    const prop = await s.adminCli.post('/usuarios', { nome: 'Chefe', cargo: 'proprietario', senha: 'ChefeSenha123' });
    assert.equal(prop.status, 201);
    const propCli = cliente(sv.porta);
    assert.equal((await propCli.post('/auth/login', { usuario: 'Chefe', senha: 'ChefeSenha123' })).status, 200);

    const lista = await s.adminCli.get('/usuarios');
    const adminAlvo = lista.corpo.find((u) => u.nome === 'Admin2');
    assert.ok(adminAlvo && adminAlvo.cargo === 'admin', 'alvo Administrador existe');

    // BLOQUEIOS: o Proprietário não cria admin nem mexe em conta admin
    const criaAdmin = await propCli.post('/usuarios', { nome: 'Pirata', cargo: 'admin', senha: 'PirataSenha123' });
    assert.equal(criaAdmin.status, 403);
    assert.match(criaAdmin.corpo.erro, /Administrador/i);
    assert.equal((await propCli.post(`/usuarios/${adminAlvo.id}/credenciais`, { senha: 'NovaSenhaAdmin1' })).status, 403,
      'resetar senha de admin');
    assert.equal((await propCli.post(`/usuarios/${adminAlvo.id}/credenciais`, { ativo: 0 })).status, 403,
      'desativar admin');
    assert.equal((await propCli.post(`/usuarios/${adminAlvo.id}/desbloquear`, {})).status, 403,
      'desbloquear admin');

    // PERMITIDOS: mantém os demais privilégios
    const criaCaixa = await propCli.post('/usuarios', { nome: 'Caixa9', cargo: 'caixa', pin: '9090' });
    assert.equal(criaCaixa.status, 201);
    assert.equal((await propCli.post('/usuarios', { nome: 'Garcom9', cargo: 'garcom', pin: '8080' })).status, 201);
    assert.equal((await propCli.post('/usuarios', { nome: 'Chefe2', cargo: 'proprietario', senha: 'ChefeDois123' })).status, 201);
    assert.equal((await propCli.post(`/usuarios/${criaCaixa.corpo.id}/credenciais`, { pin: '7070' })).status, 200,
      'resetar PIN de caixa');
    // elevar um caixa qualquer ao cargo admin também é bloqueado
    assert.equal((await propCli.post(`/usuarios/${criaCaixa.corpo.id}/credenciais`, { cargo: 'admin' })).status, 403,
      'elevar cargo existente a admin');

    // ADMIN continua gerenciando contas admin
    const adminCriaAdmin = await s.adminCli.post('/usuarios', { nome: 'Admin3', cargo: 'admin', senha: 'AdminTres123' });
    assert.equal(adminCriaAdmin.status, 201);
    assert.equal((await s.adminCli.post(`/usuarios/${adminCriaAdmin.corpo.id}/credenciais`, { ativo: 0 })).status, 200);
    assert.equal((await s.adminCli.post(`/usuarios/${adminCriaAdmin.corpo.id}/desbloquear`, {})).status, 200);
    assert.equal((await s.adminCli.post(`/usuarios/${adminAlvo.id}/credenciais`, { senha: 'NovaSenhaAdmin1' })).status, 200);

    // trava anti-bloqueio: admin não desativa a si mesmo
    const eu = lista.corpo.find((u) => u.nome === 'Dono');
    assert.equal((await s.adminCli.post(`/usuarios/${eu.id}/credenciais`, { ativo: 0 })).status, 422);
  } finally { await sv.fechar(); }
});

test('EV-008: anti-escalada — só Administrador derruba a sessão de um Administrador', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // admin cria o Proprietário e ele loga
    assert.equal((await s.adminCli.post('/usuarios', { nome: 'Chefe', cargo: 'proprietario', senha: 'ChefeSenha123' })).status, 201);
    const propCli = cliente(sv.porta);
    assert.equal((await propCli.post('/auth/login', { usuario: 'Chefe', senha: 'ChefeSenha123' })).status, 200);

    // sessões alvo: um Administrador e um Caixa
    const admin2 = cliente(sv.porta);
    assert.equal((await admin2.post('/auth/login', { usuario: 'Admin2', senha: 'OutraSenha999' })).status, 200);

    const lista = await propCli.get('/sessoes');
    assert.equal(lista.status, 200);
    const sessoes = lista.corpo.sessoes;
    const sAdmin = sessoes.find((x) => x.nome === 'Admin2');
    const sCaixa = sessoes.find((x) => x.nome === 'Carlao');
    assert.ok(sAdmin && sCaixa, 'sessões de Administrador e de Caixa visíveis');

    // BLOQUEADO: o Proprietário não "expulsa" um Administrador do sistema
    const derrubaAdmin = await propCli.post(`/sessoes/${sAdmin.id}/desconectar`, {});
    assert.equal(derrubaAdmin.status, 403);
    assert.match(derrubaAdmin.corpo.erro, /Administrador/i);
    assert.equal((await admin2.get('/auth/me')).status, 200, 'sessão do admin segue válida');

    // PERMITIDO: derruba sessões que não são de Administrador
    assert.equal((await propCli.post(`/sessoes/${sCaixa.id}/desconectar`, {})).status, 200);
    assert.equal((await s.caixaCli.get('/auth/me')).status, 401, 'sessão do caixa revogada de imediato');

    // ADMIN continua derrubando sessão de admin
    assert.equal((await s.adminCli.post(`/sessoes/${sAdmin.id}/desconectar`, {})).status, 200);
    assert.equal((await admin2.get('/auth/me')).status, 401);
  } finally { await sv.fechar(); }
});

test('EV-009: painel dev — exclusão lógica de usuário (nome liberado, histórico preservado)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    // Portão do painel dev: só o cargo Administrador (pode_painel_dev) entra
    assert.equal((await s.caixaCli.get('/admin/dev/usuarios')).status, 403, 'caixa não lista usuários do painel dev');
    assert.equal(
      (await s.garcomCli.post('/admin/dev/usuarios/1/excluir', { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' })).status,
      403, 'garçom não exclui usuário',
    );

    const lista = await s.adminCli.get('/admin/dev/usuarios');
    assert.equal(lista.status, 200);
    const carlao = lista.corpo.usuarios.find((u) => u.nome === 'Carlao');
    assert.ok(carlao && carlao.ativo === 1, 'caixa ativo aparece na lista');

    // Step-up obrigatório: sem credenciais de gestor (ou com senha errada) não exclui
    assert.equal((await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/excluir`, {})).status, 403, 'sem credenciais');
    assert.equal(
      (await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaErrada1' })).status,
      403, 'senha errada',
    );

    // Sessão aberta do alvo tem de cair junto com a exclusão
    const caixaCli = cliente(sv.porta);
    assert.equal((await caixaCli.post('/auth/login', { usuario: 'Carlao', pin: '2222' })).status, 200);

    const excl = await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(excl.status, 200);
    assert.equal(excl.corpo.nome, 'Carlao');
    assert.equal((await caixaCli.get('/auth/me')).status, 401, 'sessão revogada na hora');
    assert.equal((await cliente(sv.porta).post('/auth/login', { usuario: 'Carlao', pin: '2222' })).status, 401, 'usuário excluído não loga mais');

    // O nome fica livre para recadastro; o registro antigo permanece para o histórico
    assert.equal((await s.adminCli.post('/usuarios', { nome: 'Carlao', cargo: 'caixa', pin: '2222' })).status, 201, 'nome liberado');
    const lista2 = (await s.adminCli.get('/admin/dev/usuarios')).corpo.usuarios;
    const antigo = lista2.find((u) => u.id === carlao.id);
    assert.equal(antigo.ativo, 0, 'registro antigo ficou inativo');
    assert.match(antigo.nome, /\(excluído/, 'nome antigo identificado como excluído');
    assert.ok(!lista2.some((u) => u.nome === 'Carlao' && u.ativo === 0 && u.id !== carlao.id), 'sem duplicidade');

    // Anti-bloqueio: ninguém exclui a própria conta
    const dono = lista2.find((u) => u.nome === 'Dono');
    assert.equal(
      (await s.adminCli.post(`/admin/dev/usuarios/${dono.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' })).status,
      422, 'não exclui a si mesmo',
    );

    // Admin continua podendo excluir outra conta Administrador (com step-up)
    const admin2 = lista2.find((u) => u.nome === 'Admin2');
    assert.equal(
      (await s.adminCli.post(`/admin/dev/usuarios/${admin2.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' })).status,
      200, 'admin exclui admin',
    );
    assert.equal((await cliente(sv.porta).post('/auth/login', { usuario: 'Admin2', senha: 'OutraSenha999' })).status, 401);
  } finally { await sv.fechar(); }
});

test('EV-010: excluído sai de Pessoas → Usuários e o painel dev pode reativá-lo', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const antes = await s.adminCli.get('/usuarios');
    const carlao = antes.corpo.find((u) => u.nome === 'Carlao');
    assert.ok(carlao, 'caixa ativo listado em Pessoas → Usuários');

    // Excluir no painel dev tira o registro da tela de usuários…
    assert.equal(
      (await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' })).status,
      200,
    );
    const depois = await s.adminCli.get('/usuarios');
    assert.ok(!depois.corpo.some((u) => u.id === carlao.id), 'excluído não aparece mais em /usuarios');
    // …mas o painel dev continua com o histórico dele.
    const dev = (await s.adminCli.get('/admin/dev/usuarios')).corpo.usuarios;
    assert.ok(dev.some((u) => u.id === carlao.id && u.ativo === 0), 'painel dev mantém o registro do excluído');

    // Desativar por Credenciais (Pessoas → Usuários) também tira da lista.
    const joana = depois.corpo.find((u) => u.nome === 'Joana');
    assert.equal((await s.adminCli.post(`/usuarios/${joana.id}/credenciais`, { ativo: 0 })).status, 200);
    assert.ok(!(await s.adminCli.get('/usuarios')).corpo.some((u) => u.id === joana.id), 'desativado sai da lista');

    // Reativar exige step-up de gestor e devolve o acesso com o nome original.
    assert.equal((await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/restaurar`, {})).status, 403, 'step-up obrigatório');
    const rest = await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/restaurar`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(rest.status, 200);
    assert.equal(rest.corpo.nome, 'Carlao', 'nome original de volta');
    assert.equal((await cliente(sv.porta).post('/auth/login', { usuario: 'Carlao', pin: '2222' })).status, 200, 'volta a logar');
    assert.ok((await s.adminCli.get('/usuarios')).corpo.some((u) => u.id === carlao.id), 'volta para a lista de ativos');

    // Se o nome foi recadastrado, restaurar avisa (não duplica login).
    assert.equal(
      (await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/excluir`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' })).status,
      200,
    );
    assert.equal((await s.adminCli.post('/usuarios', { nome: 'Carlao', cargo: 'garcom', pin: '1111' })).status, 201, 'nome liberado é reutilizável');
    const conflito = await s.adminCli.post(`/admin/dev/usuarios/${carlao.id}/restaurar`, { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(conflito.status, 409, 'nome em uso → conflito');
    assert.match(conflito.corpo.erro, /já está em uso/i);
  } finally { await sv.fechar(); }
});
