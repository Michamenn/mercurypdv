// Testes 1.3.1: sino de notificações (pedidos prontos), KDS inteligente
// (tempo estimado), presença de dispositivos via WebSocket e painel Dev.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { iniciarServidorTeste, semear, tokenDe } from './helpers.js';

function conectarWS(porta, token, dispositivo = null) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`);
    const eventos = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token, dispositivo })));
    ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
    ws.on('error', reject);
    ws.on('open', () => resolve({ ws, eventos }));
    setTimeout(() => reject(new Error('ws timeout')), 3000);
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test('NOTIF-001: pedido pronto gera notificação no sino (fluxo completo da cozinha)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    const comanda = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'João' });
    assert.equal(comanda.status, 201);
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 1 }, { idem: 'n-i1' });
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 2 }, { idem: 'n-i2' });
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/encaminhar`, {});

    // sem notificações antes de pronto
    const antes = await s.garcomCli.get('/notificacoes');
    assert.equal(antes.status, 200);
    assert.equal(antes.corpo.nao_lidas, 0);

    // pendente → preparando NÃO notifica
    await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
    const meio = await s.garcomCli.get('/notificacoes');
    assert.equal(meio.corpo.nao_lidas, 0, 'iniciar preparo não toca o sino');

    // preparando → PRONTO notifica garçons e atendentes
    const pronto = await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
    assert.equal(pronto.corpo.kds_status, 'pronto');
    const notif = await s.garcomCli.get('/notificacoes');
    assert.equal(notif.corpo.nao_lidas, 1);
    const n = notif.corpo.itens[0];
    assert.equal(n.tipo, 'pedido_pronto');
    assert.equal(n.pedido_id, comanda.corpo.id);
    assert.equal(n.mesa_numero, s.mesas.m1.numero);
    assert.match(n.titulo, new RegExp(`Pedido #${comanda.corpo.id} pronto`));
    assert.match(n.detalhes, /Mesa 1/);

    // evento de negócio persistido com seq (sincronização entre dispositivos)
    const ev = sv.db.prepare(`SELECT tipo, payload FROM eventos WHERE tipo = 'notificacao.nova'`).all();
    assert.equal(ev.length, 1);
    assert.equal(JSON.parse(ev[0].payload).pedido_id, comanda.corpo.id);

    // marcar todas como lidas zera a contagem
    const lidas = await s.garcomCli.post('/notificacoes/ler-todas', {});
    assert.equal(lidas.status, 200);
    assert.equal(lidas.corpo.nao_lidas, 0);
    assert.equal(lidas.corpo.itens[0].lida, 1);

    // segunda notificação continua acumulando (contagem de não lidas)
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const balcao = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.refri.id, quantidade: 1 }] }, { idem: 'n-b1' });
    assert.equal(balcao.status, 201);
    const enc = await s.caixaCli.post(`/pedidos/${balcao.corpo.id}/encaminhar`, {});
    assert.equal(enc.status, 200);
    const av1 = await s.cozinhaCli.post(`/pedidos/${balcao.corpo.id}/kds-avancar`, {});
    assert.equal(av1.status, 200);
    const av2 = await s.cozinhaCli.post(`/pedidos/${balcao.corpo.id}/kds-avancar`, {});
    assert.equal(av2.status, 200);
    assert.equal(av2.corpo.kds_status, 'pronto');
    const duas = await s.garcomCli.get('/notificacoes');
    assert.equal(duas.corpo.nao_lidas, 1, 'nova notificação não lida soma ao sino');

    // limpar tudo (opção de limpeza)
    const limpo = await s.garcomCli.post('/notificacoes/limpar', {});
    assert.equal(limpo.status, 200);
    assert.equal(limpo.corpo.nao_lidas, 0);
    assert.equal(limpo.corpo.itens.length, 0);
    const depois = await s.garcomCli.get('/notificacoes');
    assert.equal(depois.corpo.itens.length, 0);
  } finally { await sv.fechar(); }
});

test('NOTIF-002: mutações do sino exigem header anti-CSRF', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const semCsrf = await s.garcomCli.post('/notificacoes/ler-todas', {}, { semCsrf: true });
    assert.equal(semCsrf.status, 403);
    const naoAutenticado = await sv.db.prepare('SELECT COUNT(*) AS n FROM notificacoes').get();
    assert.equal(naoAutenticado.n, 0);
  } finally { await sv.fechar(); }
});

test('KDS-010: fila do KDS traz tempo estimado (maior tempo de preparo dos itens)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    const comanda = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Ana' });
    // X-Burger (10 min) + 2 refrigerantes (1 min) → estimativa do pedido = 10
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.xburger.id, quantidade: 1 }, { idem: 'k10-a' });
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 2 }, { idem: 'k10-b' });
    await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/encaminhar`, {});

    const fila = await s.cozinhaCli.get('/kds');
    assert.equal(fila.status, 200);
    const p = fila.corpo.pedidos.find((x) => x.id === comanda.corpo.id);
    assert.ok(p, 'pedido na fila do KDS');
    assert.equal(p.tempo_estimado_min, 10, 'estimativa = item mais demorado');
    const burger = p.itens.find((i) => i.nome_produto === 'X-Burger');
    const refri = p.itens.find((i) => i.nome_produto === 'Refrigerante Lata');
    assert.equal(burger.tempo_preparo_min, 10, 'tempo de preparo por item (KDS inteligente)');
    assert.equal(refri.tempo_preparo_min, 1);

    // só cozinha vê a fila (garçom 403)
    const negado = await s.garcomCli.get('/kds');
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('WS-PRES/NOTIF-003: presença, dispositivo de origem e evento do sino via WebSocket', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const cli = conectarWS(sv.porta, tokenDe(s.garcomCli), 'celular-web');
    const { ws, eventos } = await cli;
    try {
      await dormir(300);
      const auth = eventos.find((e) => e.type === 'auth_ok');
      assert.ok(auth, 'autenticou por token no corpo');
      const presenca = eventos.find((e) => e.type === 'presenca');
      assert.ok(presenca, 'evento de presenca transmitido sem poluir o log de eventos');

      // admin vê o dispositivo conectado com a origem identificada
      const disp = await s.adminCli.get('/dispositivos');
      const eu = disp.corpo.itens.find((c) => c.usuario === 'Joana');
      assert.ok(eu, 'garçom conectado aparece para o admin');
      assert.equal(eu.dispositivo, 'celular-web');
      assert.equal(eu.cargo, 'garcom');

      // pedido pronto → evento notificacao.nova chega no socket do garçom
      const comanda = await s.garcomCli.post(`/mesas/${s.mesas.m1.id}/comanda`, { cliente: 'Léo' });
      await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/itens`, { produto_id: s.produtos.refri.id, quantidade: 1 }, { idem: 'wsp-a' });
      await s.garcomCli.post(`/pedidos/${comanda.corpo.id}/encaminhar`, {});
      await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
      await s.cozinhaCli.post(`/pedidos/${comanda.corpo.id}/kds-avancar`, {});
      await dormir(300);
      const evNotif = eventos.find((e) => e.type === 'evento' && e.tipo === 'notificacao.nova');
      assert.ok(evNotif, 'sino disparou evento em tempo real');
      assert.equal(evNotif.payload.pedido_id, comanda.corpo.id);
      // seq monotônico presente (sincronização de dispositivos)
      assert.ok(evNotif.seq > 0);
    } finally {
      try { ws.close(); } catch { /* noop */ }
    }
  } finally { await sv.fechar(); }
});

test('DEV-010: painel dev traz dispositivos conectados, endereço online e versão', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.adminCli.put('/config', { url_publica: 'https://pdv.minhalanchonete.com.br' });
    const r = await s.adminCli.post('/admin/dev', { admin_usuario: 'Dono', admin_senha: 'SenhaForte123' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.diagnostico.versao, '1.3.1');
    assert.equal(typeof r.corpo.diagnostico.dispositivos_conectados, 'number');
    assert.equal(r.corpo.diagnostico.url_publica, 'https://pdv.minhalanchonete.com.br');
    // sem step-up → 403
    const sem = await s.adminCli.post('/admin/dev', {});
    assert.equal(sem.status, 403);
  } finally { await sv.fechar(); }
});
