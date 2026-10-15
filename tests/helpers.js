// Infraestrutura de teste: servidor real em porta efêmera com banco temporário.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

export async function iniciarServidorTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
  const dbPath = path.join(dir, 'teste.sqlite');
  const configMod = await import('../server/src/config.js');
  configMod.config.dbPath = dbPath;
  configMod.config.backupsDir = path.join(dir, 'backups');
  configMod.config.logsDir = path.join(dir, 'logs');
  configMod.config.backupIntervaloHoras = 0;
  configMod.config.sessaoInatividadeMin = 30;

  const { abrirBanco } = await import('../server/src/db/connection.js');
  const { migrar } = await import('../server/src/db/migrations.js');
  const { _resetLimitadores } = await import('../server/src/auth/ratelimit.js');
  _resetLimitadores(); // isolamento entre servidores de teste no mesmo processo
  const { HubWS } = await import('../server/src/ws/hub.js');
  const { criarRouter } = await import('../server/src/routes/api.js');
  const { validarSessao } = await import('../server/src/auth/sessions.js');
  const crypto = await import('../server/src/auth/crypto.js');

  const donoBanco = { db: null };
  donoBanco.db = abrirBanco(dbPath);
  donoBanco.db && migrar(donoBanco.db);
  const hub = new HubWS(donoBanco.db, { info: () => {}, erro: (m) => console.error('[ws]', m) });
  hub.setValidador((t) => validarSessao(donoBanco.db, t));
  const app = express();
  app.use('/api', criarRouter({ db: donoBanco.db, hub, crypto, pepper: configMod.config.pepper, configApp: configMod.config, logger: { info: () => {}, erro: (m) => console.error('[log]', m) } }));
  const server = http.createServer(app);
  hub.anexar(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  return {
    get db() { return donoBanco.db; },
    hub, server, porta, dir, dbPath,
    fechar: async () => {
      hub.fechar();
      await new Promise((r) => server.close(r));
      try { donoBanco.db.close(); } catch { /* já fechado no teste de restart */ }
    },
    // reinicia o processo do banco simulando restart do servidor (persistência)
    reabrirBanco: () => {
      donoBanco.db.close();
      donoBanco.db = abrirBanco(dbPath);
      return donoBanco.db;
    },
  };
}

export function cliente(porta) {
  let cookie = null;
  const base = `http://127.0.0.1:${porta}/api`;
  async function req(metodo, caminho, corpo, { headers = {}, idem, semCsrf = false } = {}) {
    const h = { ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers };
    if (!semCsrf) h['X-Requested-With'] = 'XMLHttpRequest';
    if (cookie) h['Cookie'] = cookie;
    if (idem) h['Idempotency-Key'] = idem;
    const res = await fetch(base + caminho, {
      method: metodo, headers: h,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* corpo vazio */ }
    return { status: res.status, corpo: json };
  }
  return {
    get: (c, o) => req('GET', c, undefined, o),
    post: (c, b, o) => req('POST', c, b, o),
    put: (c, b, o) => req('PUT', c, b, o),
    delete: (c, o) => req('DELETE', c, undefined, o),
    trocarUsuario: () => { cookie = null; },
    _cookie: () => cookie,
  };
}

// Semeia usuários e sessões por cargo. Retorna clientes por papel.
export async function semear(sv) {
  const setup = cliente(sv.porta);
  await setup.post('/auth/setup', { nome: 'Dono', senha: 'SenhaForte123', pin: '1234' });

  const adminCli = cliente(sv.porta);
  await adminCli.post('/auth/login', { usuario: 'Dono', pin: '1234' });

  // usuários por cargo
  await adminCli.post('/usuarios', { nome: 'Carlao', cargo: 'caixa', pin: '2222' });
  await adminCli.post('/usuarios', { nome: 'Joana', cargo: 'garcom', pin: '3333' });
  await adminCli.post('/usuarios', { nome: 'Chef', cargo: 'cozinha', pin: '4444' });
  await adminCli.post('/usuarios', { nome: 'Admin2', cargo: 'admin', senha: 'OutraSenha999' });

  const caixaCli = cliente(sv.porta);
  await caixaCli.post('/auth/login', { usuario: 'Carlao', pin: '2222' });
  const garcomCli = cliente(sv.porta);
  await garcomCli.post('/auth/login', { usuario: 'Joana', pin: '3333' });
  const cozinhaCli = cliente(sv.porta);
  await cozinhaCli.post('/auth/login', { usuario: 'Chef', pin: '4444' });

  // catálogo base
  const cat = await adminCli.post('/categorias', { nome: 'Lanches', ordem: 1 });
  const bebidas = await adminCli.post('/categorias', { nome: 'Bebidas', ordem: 2 });
  const pX = await adminCli.post('/produtos', { nome: 'X-Burger', categoria_id: cat.corpo.id, preco_centavos: 2500, custo_centavos: 1000, area: 'cozinha', tempo_preparo_min: 10 });
  const pBatata = await adminCli.post('/produtos', { nome: 'Batata Frita', categoria_id: cat.corpo.id, preco_centavos: 1500, area: 'cozinha', tempo_preparo_min: 7 });
  const pRefri = await adminCli.post('/produtos', { nome: 'Refrigerante Lata', categoria_id: bebidas.corpo.id, preco_centavos: 600, area: 'bar', tempo_preparo_min: 1 });
  const adBacon = await adminCli.post('/adicionais', { nome: 'Bacon Extra', preco_centavos: 500 });
  await adminCli.put(`/produtos/${pX.corpo.id}/adicionais`, { adicional_ids: [adBacon.corpo.id] });

  // mesas
  const m1 = await adminCli.post('/mesas', { numero: 1, setor: 'salao' });
  const m2 = await adminCli.post('/mesas', { numero: 2, setor: 'salao' });

  return {
    adminCli, caixaCli, garcomCli, cozinhaCli,
    produtos: { xburger: pX.corpo, batata: pBatata.corpo, refri: pRefri.corpo },
    adicionalBacon: adBacon.corpo,
    mesas: { m1: m1.corpo, m2: m2.corpo },
  };
}

export function tokenDe(clienteObj) {
  const c = clienteObj._cookie?.() ?? null;
  if (!c) return null;
  return decodeURIComponent(c.replace(/^lp_session=/, ''));
}
